#!/usr/bin/env node

/**
 * ClaudeAtlas Scraper
 *
 * Discovers SKILL.md files across GitHub using:
 * 1. Code search with size-range partitioning (exceeds 1000-result cap)
 * 2. GitHub Topics API for tagged repos
 * 3. Seed repos (anthropics/skills, etc.)
 *
 * Outputs: data/skills.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseSkill } from './parse-skill.js';
import { scoreSkill } from './score.js';
import { categorizeSkill } from './categorize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const SKILLS_PATH = join(DATA_DIR, 'skills-raw.json');  // Scraper writes raw data; filter produces skills.json
const ETAG_PATH = join(DATA_DIR, 'etag-cache.json');
const STATS_PATH = join(DATA_DIR, 'pipeline-stats.json');

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('ERROR: GITHUB_TOKEN environment variable required.');
  console.error('Create a fine-grained PAT at https://github.com/settings/tokens?type=beta');
  console.error('Required scope: Public Repositories (read-only)');
  process.exit(1);
}

// --- Rate limiting ---

const HEADERS = {
  'Authorization': `Bearer ${TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

let searchRequestsThisMinute = 0;
let searchMinuteStart = Date.now();
let generalRequestsThisHour = 0;
let generalHourStart = Date.now();

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function rateLimitedFetch(url, isSearch = false, retries = 3) {
  const now = Date.now();

  if (isSearch) {
    // Code search: 10 req/min
    if (now - searchMinuteStart > 60000) {
      searchRequestsThisMinute = 0;
      searchMinuteStart = now;
    }
    if (searchRequestsThisMinute >= 9) {
      const waitMs = 60000 - (now - searchMinuteStart) + 1000;
      console.log(`  [rate-limit] Code search limit reached, waiting ${Math.ceil(waitMs / 1000)}s...`);
      await sleep(waitMs);
      searchRequestsThisMinute = 0;
      searchMinuteStart = Date.now();
    }
    searchRequestsThisMinute++;
  } else {
    // General API: 5000 req/hr
    if (now - generalHourStart > 3600000) {
      generalRequestsThisHour = 0;
      generalHourStart = now;
    }
    if (generalRequestsThisHour >= 4800) {
      const waitMs = 3600000 - (now - generalHourStart) + 1000;
      console.log(`  [rate-limit] General API limit approaching, waiting ${Math.ceil(waitMs / 1000)}s...`);
      await sleep(waitMs);
      generalRequestsThisHour = 0;
      generalHourStart = Date.now();
    }
    generalRequestsThisHour++;
  }

  let res;
  try {
    res = await fetch(url, { headers: HEADERS });
  } catch (err) {
    if (retries > 0) {
      console.log(`  [retry] Network error (${err.cause?.code || err.message}), retrying in 5s... (${retries} left)`);
      await sleep(5000);
      return rateLimitedFetch(url, isSearch, retries - 1);
    }
    throw err;
  }

  // Handle rate limit errors
  if (res.status === 403 || res.status === 429) {
    const resetHeader = res.headers.get('x-ratelimit-reset');
    if (resetHeader) {
      const resetTime = parseInt(resetHeader) * 1000;
      const waitMs = Math.max(resetTime - Date.now() + 1000, 5000);
      console.log(`  [rate-limit] 403/429 hit, waiting ${Math.ceil(waitMs / 1000)}s until reset...`);
      await sleep(waitMs);
      return rateLimitedFetch(url, isSearch, retries); // retry
    }
    // Fallback: wait 60s
    console.log('  [rate-limit] 403/429 hit (no reset header), waiting 60s...');
    await sleep(60000);
    return rateLimitedFetch(url, isSearch, retries);
  }

  return res;
}

// --- ETag cache ---

let etagCache = {};
if (existsSync(ETAG_PATH)) {
  try {
    etagCache = JSON.parse(readFileSync(ETAG_PATH, 'utf-8'));
  } catch {
    etagCache = {};
  }
}

async function fetchWithETag(url, retries = 3) {
  const cached = etagCache[url];
  const headers = { ...HEADERS };
  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag;
  }

  const now = Date.now();
  if (now - generalHourStart > 3600000) {
    generalRequestsThisHour = 0;
    generalHourStart = now;
  }
  if (generalRequestsThisHour >= 4800) {
    const waitMs = 3600000 - (now - generalHourStart) + 1000;
    await sleep(waitMs);
    generalRequestsThisHour = 0;
    generalHourStart = Date.now();
  }
  generalRequestsThisHour++;

  let res;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    if (retries > 0) {
      console.log(`  [retry] Network error (${err.cause?.code || err.message}), retrying in 5s... (${retries} left)`);
      await sleep(5000);
      return fetchWithETag(url, retries - 1);
    }
    return { data: null, cached: false, status: 0 };
  }

  if (res.status === 304 && cached?.data) {
    return { data: cached.data, cached: true };
  }

  if (res.status === 403 || res.status === 429) {
    const resetHeader = res.headers.get('x-ratelimit-reset');
    if (resetHeader) {
      const resetTime = parseInt(resetHeader) * 1000;
      const waitMs = Math.max(resetTime - Date.now() + 1000, 5000);
      console.log(`  [rate-limit] ETag fetch 403/429, waiting ${Math.ceil(waitMs / 1000)}s...`);
      await sleep(waitMs);
      return fetchWithETag(url, retries);
    }
    await sleep(60000);
    return fetchWithETag(url, retries);
  }

  if (!res.ok) {
    return { data: null, cached: false, status: res.status };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return { data: null, cached: false, status: res.status };
  }
  const etag = res.headers.get('etag');
  if (etag) {
    etagCache[url] = { etag, data };
  }

  return { data, cached: false };
}

function saveETagCache() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(ETAG_PATH, JSON.stringify(etagCache), 'utf-8');
}

// --- Code search with size-range partitioning ---

const SIZE_BUCKETS = [
  'size:<500',
  'size:500..1000',
  'size:1000..2000',
  'size:2000..5000',
  'size:5000..10000',
  'size:>10000',
];

async function searchCodeBySize() {
  const allItems = [];
  const seenKeys = new Set();

  for (const sizeBucket of SIZE_BUCKETS) {
    const query = encodeURIComponent(`filename:SKILL.md ${sizeBucket}`);
    let page = 1;
    let totalForBucket = 0;

    while (page <= 10) {
      const url = `https://api.github.com/search/code?q=${query}&per_page=100&page=${page}`;
      console.log(`  [code-search] ${sizeBucket} page ${page}...`);

      const res = await rateLimitedFetch(url, true);

      if (!res.ok) {
        console.log(`  [code-search] HTTP ${res.status} for ${sizeBucket} page ${page}, skipping`);
        break;
      }

      const data = await res.json();
      const items = data.items || [];

      if (items.length === 0) break;

      for (const item of items) {
        const key = `${item.repository.full_name}/${item.path}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          allItems.push(item);
        }
      }

      totalForBucket += items.length;
      console.log(`  [code-search] ${sizeBucket} page ${page}: ${items.length} results (${totalForBucket} total for bucket, ${allItems.length} unique overall)`);

      if (items.length < 100) break;
      page++;

      // Small delay between pages
      await sleep(200);
    }
  }

  console.log(`[code-search] Total unique SKILL.md files found: ${allItems.length}`);
  return allItems;
}

// --- Topics search ---

async function searchByTopics() {
  const topics = ['claude-skills', 'agent-skills', 'anthropic-skills', 'claude-code-skills', 'claude-code'];
  const repos = [];
  const seenRepos = new Set();

  for (const topic of topics) {
    const url = `https://api.github.com/search/repositories?q=topic:${topic}&per_page=100&sort=stars&order=desc`;
    console.log(`  [topics] Searching topic: ${topic}...`);

    const res = await rateLimitedFetch(url, true);
    if (!res.ok) {
      console.log(`  [topics] HTTP ${res.status} for topic ${topic}, skipping`);
      continue;
    }

    const data = await res.json();
    for (const repo of (data.items || [])) {
      if (!seenRepos.has(repo.full_name)) {
        seenRepos.add(repo.full_name);
        repos.push(repo);
      }
    }
    console.log(`  [topics] ${topic}: ${(data.items || []).length} repos (${repos.length} unique total)`);
  }

  return repos;
}

// --- Seed repos ---

const SEED_REPOS = [
  'anthropics/skills',
  'anthropics/claude-code-skills',
  'microsoft/skills',
  'openai/skills',
  'vercel-labs/skills',
];

async function discoverFromSeedRepos() {
  const items = [];

  for (const repoName of SEED_REPOS) {
    console.log(`  [seed] Scanning ${repoName}...`);

    // Try to get the repo tree to find SKILL.md files
    const treeUrl = `https://api.github.com/repos/${repoName}/git/trees/main?recursive=1`;
    const { data } = await fetchWithETag(treeUrl);

    if (!data || !data.tree) {
      // Try 'master' branch
      const masterUrl = `https://api.github.com/repos/${repoName}/git/trees/master?recursive=1`;
      const masterResult = await fetchWithETag(masterUrl);
      if (!masterResult.data?.tree) {
        console.log(`  [seed] Could not access ${repoName} tree, skipping`);
        continue;
      }
      const skillFiles = masterResult.data.tree.filter(f => f.path.endsWith('SKILL.md'));
      for (const f of skillFiles) {
        items.push({ repo: repoName, path: f.path });
      }
      console.log(`  [seed] ${repoName}: found ${skillFiles.length} SKILL.md files`);
      continue;
    }

    const skillFiles = data.tree.filter(f => f.path.endsWith('SKILL.md'));
    for (const f of skillFiles) {
      items.push({ repo: repoName, path: f.path });
    }
    console.log(`  [seed] ${repoName}: found ${skillFiles.length} SKILL.md files`);
  }

  return items;
}

// --- Discover SKILL.md from topic repos ---

async function discoverSkillsInRepos(repos) {
  const items = [];

  for (const repo of repos) {
    const defaultBranch = repo.default_branch || 'main';
    const treeUrl = `https://api.github.com/repos/${repo.full_name}/git/trees/${defaultBranch}?recursive=1`;
    const { data } = await fetchWithETag(treeUrl);

    if (!data?.tree) continue;

    const skillFiles = data.tree.filter(f => f.path.endsWith('SKILL.md'));
    for (const f of skillFiles) {
      items.push({ repo: repo.full_name, path: f.path });
    }

    if (skillFiles.length > 0) {
      console.log(`  [topics-discover] ${repo.full_name}: ${skillFiles.length} SKILL.md files`);
    }
  }

  return items;
}

// --- Fetch repo metadata ---

async function fetchRepoMetadata(repoFullName) {
  const url = `https://api.github.com/repos/${repoFullName}`;
  const { data, status } = await fetchWithETag(url);

  if (!data) {
    return null;
  }

  return {
    repo_full_name: data.full_name,
    repo_url: data.html_url,
    repo_stars: data.stargazers_count || 0,
    repo_forks: data.forks_count || 0,
    repo_open_issues: data.open_issues_count || 0,
    repo_topics: data.topics || [],
    repo_license: data.license?.spdx_id || null,
    repo_language: data.language || null,
    repo_created_at: data.created_at,
    repo_updated_at: data.updated_at,
    repo_pushed_at: data.pushed_at,
    repo_owner_type: data.owner?.type || 'User',
    repo_owner_avatar: data.owner?.avatar_url || '',
    repo_archived: data.archived || false,
    repo_is_fork: data.fork || false,
    repo_description: data.description || null,
    repo_default_branch: data.default_branch || 'main',
  };
}

// --- Fetch SKILL.md content ---

async function fetchSkillContent(repoFullName, path) {
  const url = `https://api.github.com/repos/${repoFullName}/contents/${path}`;
  const { data, status } = await fetchWithETag(url);

  if (!data) return null;

  // Decode content from base64
  if (data.content) {
    const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
    return {
      content: decoded,
      sha: data.sha,
      size: data.size,
      html_url: data.html_url,
    };
  }

  // If content is too large, try raw endpoint
  if (data.size > 1000000) {
    console.log(`  [content] ${repoFullName}/${path} too large (${data.size} bytes), skipping`);
    return null;
  }

  return null;
}

// --- Main pipeline ---

async function main() {
  const startTime = Date.now();
  console.log('=== ClaudeAtlas Scraper ===');
  console.log(`Started at ${new Date().toISOString()}\n`);

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  // --- Step 1: Discover SKILL.md files ---
  console.log('[1/5] Discovering SKILL.md files...\n');

  // 1a. Code search with size partitioning
  console.log('[1a] Code search (size-range partitioned)...');
  const codeSearchItems = await searchCodeBySize();

  // 1b. Topics-based repo search
  console.log('\n[1b] Topics-based repo search...');
  const topicRepos = await searchByTopics();

  // 1c. Discover SKILL.md in topic repos
  console.log('\n[1c] Scanning topic repos for SKILL.md files...');
  const topicSkills = await discoverSkillsInRepos(topicRepos);

  // 1d. Seed repos
  console.log('\n[1d] Scanning seed repos...');
  const seedSkills = await discoverFromSeedRepos();

  // --- Merge all discoveries ---
  const allDiscoveries = new Map(); // key: repo/path -> { repo, path }

  for (const item of codeSearchItems) {
    const key = `${item.repository.full_name}/${item.path}`;
    allDiscoveries.set(key, {
      repo: item.repository.full_name,
      path: item.path,
      source: 'code-search',
    });
  }

  for (const item of topicSkills) {
    const key = `${item.repo}/${item.path}`;
    if (!allDiscoveries.has(key)) {
      allDiscoveries.set(key, { ...item, source: 'topics' });
    }
  }

  for (const item of seedSkills) {
    const key = `${item.repo}/${item.path}`;
    if (!allDiscoveries.has(key)) {
      allDiscoveries.set(key, { ...item, source: 'seed' });
    }
  }

  console.log(`\n[discovery] Total unique SKILL.md files: ${allDiscoveries.size}`);
  console.log(`  - Code search: ${codeSearchItems.length}`);
  console.log(`  - Topics: ${topicSkills.length}`);
  console.log(`  - Seed repos: ${seedSkills.length}`);

  // --- Step 2: Fetch repo metadata ---
  console.log('\n[2/5] Fetching repo metadata...');
  const uniqueRepos = new Set([...allDiscoveries.values()].map(d => d.repo));
  const repoMetadataCache = new Map();
  let repoCount = 0;

  for (const repoName of uniqueRepos) {
    repoCount++;
    if (repoCount % 50 === 0) {
      console.log(`  [metadata] ${repoCount}/${uniqueRepos.size} repos...`);
    }

    const metadata = await fetchRepoMetadata(repoName);
    if (metadata) {
      repoMetadataCache.set(repoName, metadata);
    }

    // Small delay to avoid hammering
    if (repoCount % 100 === 0) await sleep(500);
  }

  console.log(`[metadata] Fetched metadata for ${repoMetadataCache.size}/${uniqueRepos.size} repos`);

  // --- Step 3: Fetch and parse SKILL.md content ---
  console.log('\n[3/5] Fetching and parsing SKILL.md content...');
  const skills = [];
  let fetchCount = 0;
  let parseErrors = 0;

  for (const [key, discovery] of allDiscoveries) {
    fetchCount++;
    if (fetchCount % 50 === 0) {
      console.log(`  [parse] ${fetchCount}/${allDiscoveries.size} skills... (${skills.length} valid so far)`);
    }

    const repoMeta = repoMetadataCache.get(discovery.repo);
    if (!repoMeta) continue;

    // Skip archived, forked repos
    if (repoMeta.repo_archived) continue;
    if (repoMeta.repo_is_fork) continue;

    try {
      const content = await fetchSkillContent(discovery.repo, discovery.path);
      if (!content) {
        parseErrors++;
        continue;
      }

      const parsed = parseSkill(content.content, discovery.path);
      if (!parsed) {
        parseErrors++;
        continue;
      }

      // Build skill record
      const skillName = parsed.name || extractSkillName(discovery.path);
      const slug = `${discovery.repo.split('/')[0]}/${skillName}`;

      const skill = {
        id: key,
        name: skillName,
        slug,
        description: parsed.description || repoMeta.repo_description || '',
        ...repoMeta,
        skill_path: discovery.path,
        frontmatter: parsed.frontmatter,
        body_markdown: parsed.body,
        body_length: parsed.body.length,
        has_name: !!parsed.frontmatter.name,
        has_description: !!parsed.frontmatter.description,
        scraped_at: new Date().toISOString(),
        content_sha: content.sha,
        consecutive_404s: 0,
        source: discovery.source,
      };

      // Score and categorize
      skill.quality_score = scoreSkill(skill);
      skill.quality_tier = skill.quality_score >= 80 ? 'featured'
        : skill.quality_score >= 50 ? 'solid' : 'listed';
      skill.category = categorizeSkill(skill);
      skill.tags = extractTags(skill);

      skills.push(skill);
    } catch (err) {
      console.log(`  [error] Failed to process ${key}: ${err.message}`);
      parseErrors++;
    }

    // Pace ourselves
    if (fetchCount % 100 === 0) await sleep(500);

    // Save progress every 1000 skills
    if (skills.length > 0 && skills.length % 1000 === 0) {
      console.log(`  [checkpoint] Saving progress: ${skills.length} skills...`);
      writeFileSync(SKILLS_PATH + '.partial', JSON.stringify(skills), 'utf-8');
      saveETagCache();
    }
  }

  const parseErrorRate = allDiscoveries.size > 0
    ? ((parseErrors / allDiscoveries.size) * 100).toFixed(1)
    : 0;

  console.log(`[parse] Parsed ${skills.length} skills (${parseErrors} errors, ${parseErrorRate}% error rate)`);

  // --- Step 4: Sort and deduplicate ---
  console.log('\n[4/5] Sorting and deduplicating...');

  // Deduplicate by skill name within same owner (keep highest scored)
  const deduped = new Map();
  for (const skill of skills) {
    const dedupKey = `${skill.slug}`;
    const existing = deduped.get(dedupKey);
    if (!existing || skill.quality_score > existing.quality_score) {
      deduped.set(dedupKey, skill);
    }
  }

  const finalSkills = [...deduped.values()]
    .sort((a, b) => b.quality_score - a.quality_score);

  console.log(`[dedup] ${skills.length} -> ${finalSkills.length} after deduplication`);

  // --- Step 5: Output ---
  console.log('\n[5/5] Writing output...');

  // Remove body_markdown from output to save space (keep it for detail pages)
  const outputSkills = finalSkills.map(s => ({
    ...s,
    body_markdown: s.body_markdown.substring(0, 5000), // Truncate to 5KB max
  }));

  writeFileSync(SKILLS_PATH, JSON.stringify(outputSkills, null, 2), 'utf-8');
  saveETagCache();

  // --- Stats ---
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const tierCounts = {
    featured: finalSkills.filter(s => s.quality_tier === 'featured').length,
    solid: finalSkills.filter(s => s.quality_tier === 'solid').length,
    listed: finalSkills.filter(s => s.quality_tier === 'listed').length,
  };

  const categoryCounts = {};
  for (const s of finalSkills) {
    categoryCounts[s.category] = (categoryCounts[s.category] || 0) + 1;
  }

  const stats = {
    timestamp: new Date().toISOString(),
    total_discovered: allDiscoveries.size,
    total_skills: finalSkills.length,
    parse_errors: parseErrors,
    parse_error_rate: parseErrorRate,
    tiers: tierCounts,
    categories: categoryCounts,
    elapsed_seconds: parseInt(elapsed),
    sources: {
      code_search: codeSearchItems.length,
      topics: topicSkills.length,
      seeds: seedSkills.length,
    },
  };

  writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2), 'utf-8');

  console.log('\n=== Pipeline Complete ===');
  console.log(`Total skills: ${finalSkills.length}`);
  console.log(`Tiers: ${tierCounts.featured} Featured, ${tierCounts.solid} Solid, ${tierCounts.listed} Listed`);
  console.log(`Categories: ${Object.entries(categoryCounts).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
  console.log(`Parse errors: ${parseErrors} (${parseErrorRate}%)`);
  console.log(`Elapsed: ${elapsed}s`);
  console.log(`Output: ${SKILLS_PATH}`);

  // --- Regression guard ---
  if (existsSync(SKILLS_PATH)) {
    // Check previous count if we had one
    const prevStats = existsSync(STATS_PATH) ? JSON.parse(readFileSync(STATS_PATH, 'utf-8')) : null;
    if (prevStats && prevStats.total_skills > 0) {
      const drop = ((prevStats.total_skills - finalSkills.length) / prevStats.total_skills) * 100;
      if (drop > 20) {
        console.error(`\n!!! REGRESSION: Skills count dropped ${drop.toFixed(1)}% (${prevStats.total_skills} -> ${finalSkills.length})`);
        process.exit(1);
      }
    }
  }
}

function extractSkillName(path) {
  // Extract name from path like "skills/my-skill/SKILL.md" -> "my-skill"
  const parts = path.split('/');
  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }
  return path.replace(/\/SKILL\.md$/i, '').replace(/\//g, '-');
}

function extractTags(skill) {
  const tags = new Set();

  // From frontmatter
  if (skill.frontmatter.tags) {
    const fmTags = Array.isArray(skill.frontmatter.tags) ? skill.frontmatter.tags : [skill.frontmatter.tags];
    fmTags.forEach(t => tags.add(String(t).toLowerCase()));
  }

  // From repo topics
  if (skill.repo_topics) {
    skill.repo_topics.forEach(t => tags.add(t.toLowerCase()));
  }

  return [...tags];
}

main().catch(err => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});

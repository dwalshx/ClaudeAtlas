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
import {
  rateLimitedFetch,
  fetchWithETag,
  getETagCache,
  saveETagCache,
  sleep,
} from './lib/github-fetch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const HISTORY_DIR = join(DATA_DIR, 'history');
const SKILLS_PATH = join(DATA_DIR, 'skills-raw.json');  // Scraper writes raw data; filter produces skills.json
const STATS_PATH = join(DATA_DIR, 'pipeline-stats.json');

// --- Daily history snapshot ---
//
// Writes a tiny per-day JSON file with the star/fork/issues/pushed_at state
// of every repo we have metadata for. These snapshots compound over time into
// a full time-series of the Claude skills ecosystem — the basis for star history
// charts, momentum detection, and "trending this week" views.
//
// Snapshot files are small (~100-200 KB) and live in data/history/ — committed
// to the repo so daily GitHub Actions runs append to the series automatically.
// A new snapshot is only written if one doesn't already exist for today's date.
function writeHistorySnapshot(repoMetadataCache) {
  if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const snapshotPath = join(HISTORY_DIR, `${today}.json`);

  // Skip if today's snapshot already exists (scrape re-run on same day)
  if (existsSync(snapshotPath)) {
    console.log(`[history] Snapshot for ${today} already exists, skipping`);
    return;
  }

  const repos = {};
  for (const [repoName, meta] of repoMetadataCache.entries()) {
    // Skip archived/forked repos — they're noise in the time series
    if (meta.repo_archived || meta.repo_is_fork) continue;

    repos[repoName] = {
      s: meta.repo_stars,          // stars (short keys to keep file size tiny)
      f: meta.repo_forks,
      i: meta.repo_open_issues,
      p: meta.repo_pushed_at,      // ISO timestamp of last push
    };
  }

  const snapshot = {
    date: today,
    timestamp: new Date().toISOString(),
    repo_count: Object.keys(repos).length,
    repos,
  };

  writeFileSync(snapshotPath, JSON.stringify(snapshot), 'utf-8');
  console.log(`[history] Wrote snapshot: ${snapshotPath} (${Object.keys(repos).length} repos)`);
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

async function searchCodeBySize(pushedFilter = '') {
  const allItems = [];
  const seenKeys = new Set();

  for (const sizeBucket of SIZE_BUCKETS) {
    const queryParts = `filename:SKILL.md ${sizeBucket}${pushedFilter ? ' ' + pushedFilter : ''}`;
    const query = encodeURIComponent(queryParts);
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

async function searchByTopics(pushedFilter = '') {
  const topics = ['claude-skills', 'agent-skills', 'anthropic-skills', 'claude-code-skills', 'claude-code'];
  const repos = [];
  const seenRepos = new Set();

  for (const topic of topics) {
    // Note: applying pushed:> here filters topic-tagged repos by recent push activity —
    // semantically valid for the incremental intent (we only care about recently active repos).
    const q = encodeURIComponent(`topic:${topic}${pushedFilter ? ' ' + pushedFilter : ''}`);
    const url = `https://api.github.com/search/repositories?q=${q}&per_page=100&sort=stars&order=desc`;
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

  // --- Parse --mode={incremental,full} ---
  let mode = 'full';
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length);
    }
  }
  if (mode !== 'incremental' && mode !== 'full') {
    console.error(`[discover] Invalid --mode=${mode}. Must be 'incremental' or 'full'.`);
    process.exit(1);
  }

  // Compute pushed:> cutoff once at startup (3 days ago)
  let pushedFilter = '';
  if (mode === 'incremental') {
    const cutoff = new Date(Date.now() - 3 * 86400 * 1000).toISOString().slice(0, 10);
    pushedFilter = `pushed:>${cutoff}`;
    console.log(`[discover] mode=incremental, ${pushedFilter}`);
  } else {
    console.log('[discover] mode=full, no pushed filter');
  }

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  // --- Step 1: Discover SKILL.md files ---
  console.log('[1/5] Discovering SKILL.md files...\n');

  // 1a. Code search with size partitioning
  console.log('[1a] Code search (size-range partitioned)...');
  const codeSearchItems = await searchCodeBySize(pushedFilter);

  // 1b. Topics-based repo search
  console.log('\n[1b] Topics-based repo search...');
  const topicRepos = await searchByTopics(pushedFilter);

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

  // --- Step 2b: Write daily history snapshot (for star trajectory charts) ---
  // Tiny per-day file with {repo_full_name: {stars, forks, open_issues, pushed_at}}
  // Compounds forever — the longer we run this, the deeper the time-series moat.
  writeHistorySnapshot(repoMetadataCache);

  // --- Step 3: Fetch and parse SKILL.md content ---
  console.log('\n[3/5] Fetching and parsing SKILL.md content...');

  // Incremental optimization: skip parse for already-known IDs.
  // Track 1 keeps engagement fields fresh on existing entries; the weekly
  // full sweep refreshes content. We only need to discover genuinely NEW
  // SKILL.md files in incremental mode.
  let knownIds = null;
  if (mode === 'incremental' && existsSync(SKILLS_PATH)) {
    try {
      const existingRaw = JSON.parse(readFileSync(SKILLS_PATH, 'utf-8'));
      knownIds = new Set(existingRaw.map(s => s.id));
      console.log(`[discover] incremental: ${knownIds.size} known IDs will be skipped in parse step`);
    } catch (err) {
      console.log(`[discover] incremental: could not load existing skills-raw.json (${err.message}); parsing all discoveries`);
    }
  }

  const skills = [];
  let fetchCount = 0;
  let parseErrors = 0;
  let skippedKnown = 0;

  for (const [key, discovery] of allDiscoveries) {
    fetchCount++;

    // id is set to `key` below (line ~450); allDiscoveries key format is
    // `${repo}/${path}` (line ~358), so this matches exactly.
    if (knownIds && knownIds.has(key)) {
      skippedKnown++;
      continue;
    }

    if (fetchCount % 50 === 0) {
      console.log(`  [parse] ${fetchCount}/${allDiscoveries.size} skills... (${skills.length} valid so far, ${skippedKnown} known skipped)`);
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
      saveETagCache(getETagCache());
    }
  }

  const parseErrorRate = allDiscoveries.size > 0
    ? ((parseErrors / allDiscoveries.size) * 100).toFixed(1)
    : 0;

  console.log(`[parse] Parsed ${skills.length} skills (${parseErrors} errors, ${parseErrorRate}% error rate)`);
  if (knownIds) {
    console.log(`[discover] incremental: skipped ${skippedKnown} known IDs, parsed ${fetchCount - skippedKnown} new candidates`);
  }

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

  // In incremental mode, MERGE with existing skills-raw.json by id.
  // New entries from this run overwrite same-id entries; untouched entries are preserved.
  // If skills-raw.json doesn't exist, fall back to write-from-scratch.
  let writeSkills = outputSkills;
  if (mode === 'incremental' && existsSync(SKILLS_PATH)) {
    try {
      const existing = JSON.parse(readFileSync(SKILLS_PATH, 'utf-8'));
      const merged = new Map();
      for (const s of existing) merged.set(s.id, s);
      for (const s of outputSkills) merged.set(s.id, s);
      writeSkills = [...merged.values()].sort((a, b) => b.quality_score - a.quality_score);
      console.log(`[discover] incremental merge: ${existing.length} existing + ${outputSkills.length} new -> ${writeSkills.length} total`);
    } catch (err) {
      console.log(`[discover] incremental merge failed (${err.message}), writing from scratch`);
    }
  }

  writeFileSync(SKILLS_PATH, JSON.stringify(writeSkills, null, 2), 'utf-8');
  saveETagCache(getETagCache());

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

  // --- Regression guard (full mode only) ---
  // Incremental days can legitimately return 0 valid skills on quiet days, so the
  // "skills count too low" guard would false-positive there. Only enforce in full mode.
  if (mode === 'full' && existsSync(SKILLS_PATH)) {
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

#!/usr/bin/env node
/**
 * ClaudeAtlas Track 2 — Repository Discovery (correct shape, post-3.0.0).
 *
 * Discovers NEW SKILL.md files in topic-tagged repos that have been pushed
 * within the recency window. Architecturally distinct from the legacy
 * scripts/scrape.js code-search path: repository search supports `pushed:>`
 * (code search does NOT — verified via GitHub's searching-code docs), so
 * this is the path that actually narrows the daily candidate set.
 *
 * Pipeline:
 *   1. For each topic in TOPICS, GET /search/repositories?q=topic:X+pushed:>{cutoff}
 *      paginated (per_page=100, up to 10 pages = 1000 repos / topic).
 *   2. Build a deduped repo list. Skip already-fully-indexed repos via
 *      knownIds set (built from current skills-raw.json).
 *   3. For each candidate, fetchWithETag the tree
 *      (/repos/{owner}/{repo}/git/trees/{branch}?recursive=1).
 *      304 = cheap (zero rate-limit cost); 200 = scan tree.path for SKILL.md.
 *   4. For each new SKILL.md path, fetchWithETag /contents/{path}, parse,
 *      score, categorize, build record.
 *   5. Atomic merge into data/skills-raw.json (write to .partial, rename).
 *
 * CLI:
 *   --since=YYYY-MM-DD   Override the default 3-day-ago cutoff (backfill).
 *
 * Tag prefix: [discover] for all console output.
 * Inputs:  data/skills-raw.json (read for skip-known-IDs), data/etag-cache.json
 * Outputs: data/skills-raw.json (atomic merge), data/etag-cache.json (mutated)
 * Cost:   up to MAX_PAGES_PER_TOPIC × 100 results per topic (paginated repo search)
 *         + ~100–500 candidate trees + ~50–200 new content fetches = well under
 *         5000/hr general budget.
 * Resumable: writes data/skills-raw.json.partial every CHECKPOINT_EVERY repos.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
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
import { readNdjsonRecords, writeNdjsonStreaming } from './lib/ndjson.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
// T4: NDJSON format (chunked I/O). Legacy .json path kept for graceful migration.
const RAW_PATH = join(DATA_DIR, 'skills-raw.ndjson');
const RAW_PARTIAL_PATH = join(DATA_DIR, 'skills-raw.ndjson.partial');
const LEGACY_RAW_PATH = join(DATA_DIR, 'skills-raw.json');

const TOPICS = [
  // Ordered by signal strength (highest community-usage first). Order
  // matters only for log readability; results are deduped.
  'claude-skills',
  'claude-skill',
  'claude-code',
  'claude-code-skills',
  'agent-skills',
  'anthropic-skills',
  'claude-plugin',
];

const CONFIG = {
  DEFAULT_SINCE_DAYS: 3,        // pushed:> cutoff if --since not provided
  MAX_PAGES_PER_TOPIC: 10,      // /search/repositories caps at 1000 results
  MAX_CANDIDATE_REPOS: 1500,    // FLAG #4 guardrail: cap deduped candidate set; weekly sweep catches the tail
  MAX_FILES_PER_REPO: 50,       // 3.0.2 Bug 2: per-repo SKILL.md cap. Filter caps each repo to 2 skills (filter.js CONFIG.MAX_PER_REPO=2); fetching >50 is wasted budget.
  CHECKPOINT_EVERY: 50,         // partial-save cadence (repos)
  LOG_EVERY_REPOS: 25,          // progress log cadence
  MAX_BODY_KB: 1000,            // skip SKILL.md > 1 MB (matches scrape.js:296)
  INTER_PAGE_SLEEP_MS: 200,     // mirror scrape.js code-search pacing
};

function log(msg) { console.log(`[discover] ${msg}`); }
function warn(msg) { console.warn(`[discover] WARN: ${msg}`); }
function fatal(msg) { console.error(`[discover] FATAL: ${msg}`); process.exit(1); }

function parseArgs() {
  const since = process.argv.find(a => a.startsWith('--since='));
  if (since) {
    const value = since.slice('--since='.length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      fatal(`--since must be YYYY-MM-DD, got '${value}'`);
    }
    return { cutoff: value };
  }
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - CONFIG.DEFAULT_SINCE_DAYS);
  return { cutoff: d.toISOString().slice(0, 10) };
}

/**
 * Returns Array<RepoMetadata>. Dedup of repos across topics is done by caller.
 * Uses search rate-limit budget (10 req/min). Pages until either the API
 * returns < 100 items OR MAX_PAGES_PER_TOPIC. Yields up to
 * MAX_PAGES_PER_TOPIC × 100 results per topic.
 */
export async function searchTopic(topic, cutoff) {
  const repos = [];
  let page = 0;
  let lastPageItemCount = 0;
  let pagesFetched = 0;
  for (page = 1; page <= CONFIG.MAX_PAGES_PER_TOPIC; page++) {
    const q = encodeURIComponent(`topic:${topic} pushed:>${cutoff}`);
    const url = `https://api.github.com/search/repositories?q=${q}&per_page=100&page=${page}&sort=updated&order=desc`;
    log(`searching topic=${topic} page=${page} cutoff=${cutoff}`);
    const res = await rateLimitedFetch(url, /*isSearch=*/true);
    if (!res.ok) {
      warn(`HTTP ${res.status} on topic=${topic} page=${page}; skipping rest of topic`);
      break;
    }
    const data = await res.json();
    const items = data.items || [];
    lastPageItemCount = items.length;
    pagesFetched = page;
    for (const r of items) repos.push(r);
    if (items.length < 100) break;
    await sleep(CONFIG.INTER_PAGE_SLEEP_MS);
  }
  // R9 (BLOCKER): saturation warning. If we hit the page cap with full pages,
  // the topic returned >= MAX_PAGES_PER_TOPIC * 100 results — likely capped at
  // GitHub's 1000-result search ceiling. Long-tail untagged repos won't be
  // discovered today; the weekly Sunday code-search sweep catches them.
  if (pagesFetched >= CONFIG.MAX_PAGES_PER_TOPIC && lastPageItemCount === 100) {
    warn(`topic:${topic} saturated at ${CONFIG.MAX_PAGES_PER_TOPIC * 100} results — consider narrowing window or splitting`);
  }
  log(`topic=${topic}: ${repos.length} repos pushed since ${cutoff}`);
  return repos;
}

/**
 * Returns Array<{path: string, sha: string}> of SKILL.md blob entries
 * within the repo. Empty array if the tree fetch failed, the repo has no
 * SKILL.md, or the response was 304 with no cached body.
 *
 * The per-blob `sha` is git's blob SHA-1 of the file content. It is stable
 * across pushes when the file body is unchanged, which lets per-skill
 * callers skip a contents fetch when the blob sha matches the cached
 * record's content_sha. (Phase 3.0.2: cuts ~95% of warm-run content
 * fetches; replaces the prior 24h scraped_at heuristic.)
 *
 * Uses general rate-limit budget. ETag-supported — warm runs return 304 and
 * cost ZERO rate-limit budget per GitHub's best-practices docs.
 */
export async function listSkillPaths(repo) {
  const branch = repo.default_branch || 'main';
  const url = `https://api.github.com/repos/${repo.full_name}/git/trees/${branch}?recursive=1`;
  const { data, status } = await fetchWithETag(url);
  if (!data?.tree) {
    if (status && status !== 304) {
      warn(`tree fetch returned ${status} for ${repo.full_name}; skipping`);
    }
    return [];
  }
  if (data.truncated) {
    warn(`tree truncated for ${repo.full_name} (large monorepo); weekly code-search will pick up missed paths`);
  }
  return data.tree
    .filter(f => f && f.type === 'blob' && typeof f.path === 'string' && f.path.endsWith('SKILL.md'))
    .map(f => ({ path: f.path, sha: f.sha }));
}

/**
 * Returns a fully-formed skill record (matches scrape.js:474–490 shape) or null.
 * Reuses parseSkill, scoreSkill, categorizeSkill — single source of truth.
 */
export async function fetchAndBuildRecord(repo, skillPath) {
  const url = `https://api.github.com/repos/${repo.full_name}/contents/${skillPath}`;
  const { data } = await fetchWithETag(url);
  if (!data || !data.content) return null;
  if (data.size > CONFIG.MAX_BODY_KB * 1000) {
    warn(`${repo.full_name}/${skillPath} too large (${data.size} bytes); skipping`);
    return null;
  }
  const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
  const parsed = parseSkill(decoded, skillPath);
  if (!parsed) return null;

  const skillName = parsed.name || extractSkillName(skillPath);
  const slug = `${repo.full_name.split('/')[0]}/${skillName}`;
  const id = `${repo.full_name}/${skillPath}`;

  const skill = {
    id,
    name: skillName,
    slug,
    description: parsed.description || repo.description || '',
    repo_full_name: repo.full_name,
    repo_url: repo.html_url,
    repo_stars: repo.stargazers_count || 0,
    repo_forks: repo.forks_count || 0,
    repo_open_issues: repo.open_issues_count || 0,
    repo_topics: repo.topics || [],
    repo_license: repo.license?.spdx_id || repo.license?.key || null,
    repo_language: repo.language || null,
    repo_created_at: repo.created_at,
    repo_updated_at: repo.updated_at,
    repo_pushed_at: repo.pushed_at,
    repo_owner_type: repo.owner?.type || 'User',
    repo_owner_avatar: repo.owner?.avatar_url || '',
    repo_archived: repo.archived || false,
    repo_is_fork: repo.fork || false,
    repo_description: repo.description || null,
    repo_default_branch: repo.default_branch || 'main',
    skill_path: skillPath,
    frontmatter: parsed.frontmatter,
    body_markdown: parsed.body.substring(0, 5000),  // match scrape.js:549 truncation
    body_length: parsed.body.length,
    has_name: !!parsed.frontmatter?.name,
    has_description: !!parsed.frontmatter?.description,
    scraped_at: new Date().toISOString(),
    content_sha: data.sha,
    consecutive_404s: 0,
    source: 'discover',
  };
  skill.quality_score = scoreSkill(skill);
  // FLAG #16: leave quality_tier null — filter.js re-tiers on output using
  // the canonical 90/70 thresholds (filter.js:254-256). Hardcoding 80/50 here
  // would drift from the source of truth. Make staleness explicit.
  skill.quality_tier = null;
  skill.category = categorizeSkill(skill);
  return skill;
}

export function extractSkillName(p) {
  const parts = p.split('/');
  if (parts.length >= 2) return parts[parts.length - 2];
  return p.replace(/\/SKILL\.md$/i, '').replace(/\//g, '-');
}

/**
 * Append-or-update by id. New records win on collision. Writes to
 * RAW_PARTIAL_PATH first, then renames to RAW_PATH — no torn writes.
 * Caller passes the full merged Map (we don't re-read RAW_PATH each call).
 */
function writeMergedAtomic(byId) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const merged = [...byId.values()].sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
  // T4: streaming write — V8-string-limit safe. writeNdjsonStreaming handles
  // tmp+rename internally.
  writeNdjsonStreaming(RAW_PATH, merged);
}

function loadExistingById() {
  // T4: prefer NDJSON; fall back to legacy JSON-array path during migration window.
  if (existsSync(RAW_PATH)) {
    return readNdjsonRecords(RAW_PATH, { keyFn: r => r.id });
  }
  if (existsSync(LEGACY_RAW_PATH)) {
    warn(`${RAW_PATH} not found; reading LEGACY ${LEGACY_RAW_PATH}.`);
    warn(`Run \`node scripts/migrate-raw-to-ndjson.js\` to convert.`);
    try {
      const arr = JSON.parse(readFileSync(LEGACY_RAW_PATH, 'utf-8'));
      if (!Array.isArray(arr)) {
        warn(`${LEGACY_RAW_PATH} is not an array; starting empty`);
        return new Map();
      }
      return new Map(arr.map(s => [s.id, s]));
    } catch (err) {
      // V8 string limit on the legacy file — exactly the bug T4 fixes.
      warn(`Failed to parse legacy ${LEGACY_RAW_PATH}: ${err.message}`);
      warn(`This is the V8 ~536 MB string-limit failure. Run scripts/migrate-raw-to-ndjson.js to convert.`);
      return new Map();
    }
  }
  warn(`${RAW_PATH} not found — first run? Starting from empty.`);
  return new Map();
}

async function main() {
  const startTime = Date.now();
  const { cutoff } = parseArgs();
  log('=== ClaudeAtlas Track 2 (Discovery) ===');
  log(`Started ${new Date().toISOString()}, cutoff=${cutoff}, topics=${TOPICS.length}`);

  // 1. Load existing corpus for skip-known-IDs.
  //    Skip granularity is per skill_id (= repo + skill_path), NOT per repo,
  //    because a repo can host multiple SKILL.md files and we want to detect
  //    NEW ones in already-known repos.
  const byId = loadExistingById();
  log(`existing corpus: ${byId.size} skill ids`);

  // 2. Run topic search across all topics; dedup repos by full_name.
  const reposByName = new Map();
  for (const topic of TOPICS) {
    const repos = await searchTopic(topic, cutoff);
    for (const r of repos) {
      if (!reposByName.has(r.full_name)) reposByName.set(r.full_name, r);
    }
  }
  log(`unique candidate repos: ${reposByName.size}`);

  // FLAG #4: candidate-repo guardrail. If pathological topic growth pushes
  // the deduped candidate set past MAX_CANDIDATE_REPOS, log a warning and
  // truncate. The weekly Sunday code-search sweep catches the tail.
  if (reposByName.size > CONFIG.MAX_CANDIDATE_REPOS) {
    warn(`candidate repos (${reposByName.size}) exceed MAX_CANDIDATE_REPOS (${CONFIG.MAX_CANDIDATE_REPOS}); truncating — weekly sweep catches the tail`);
    const truncated = new Map();
    let i = 0;
    for (const [k, v] of reposByName) {
      if (i++ >= CONFIG.MAX_CANDIDATE_REPOS) break;
      truncated.set(k, v);
    }
    reposByName.clear();
    for (const [k, v] of truncated) reposByName.set(k, v);
  }

  // 3. For each repo, list SKILL.md paths via tree fetch (ETag-friendly).
  //    Tree fetches are ETag-cheap (304 free) so we don't pre-skip at the
  //    repo level — per-skill freshness is checked below.
  let processedRepos = 0;
  let newSkills = 0;
  let updatedSkills = 0;
  let treeMisses = 0;
  let skippedUnchanged = 0;   // 3.0.2: blob-sha matched existing.content_sha; no contents fetch

  for (const [repoName, repo] of reposByName) {
    processedRepos++;
    if (repo.archived || repo.fork) continue;   // matches scrape.js:454–455 policy

    let paths = await listSkillPaths(repo);
    if (paths.length === 0) {
      treeMisses++;
      if (processedRepos % CONFIG.LOG_EVERY_REPOS === 0) {
        log(`progress: ${processedRepos}/${reposByName.size} repos (${newSkills} new, ${updatedSkills} updated, ${skippedUnchanged} skipped-unchanged, ${treeMisses} no-skill)`);
      }
      continue;
    }

    // 3.0.2 Bug 2 fix: per-repo SKILL.md cap. Mega-repos with hundreds of
    // SKILL.md files exhaust rate budget for skills the filter will cap to
    // 2 anyway. Sort by path for determinism, slice to first 50. Applied
    // AFTER listSkillPaths' data.truncated warning so the policy is
    // "deterministic top 50 of whatever the tree returned" (R3).
    if (paths.length > CONFIG.MAX_FILES_PER_REPO) {
      warn(`repo ${repo.full_name} has ${paths.length} SKILL.md files; processing first ${CONFIG.MAX_FILES_PER_REPO} (filter caps at 2 per repo anyway)`);
      paths = paths
        .slice()
        .sort((a, b) => a.path.localeCompare(b.path))
        .slice(0, CONFIG.MAX_FILES_PER_REPO);
    }

    // 4. For each path, fetch + parse + build record. Skip via blob-sha
    //    equality (3.0.2 Bug 1 fix): the trees endpoint blob sha is git's
    //    blob SHA-1 of the file body — identical to the contents API sha
    //    we stored as content_sha at initial fetch. If they match, the
    //    file is byte-for-byte unchanged; no contents fetch needed.
    //
    //    Fall-through cases (existing absent, content_sha undefined on
    //    legacy record, sha mismatch) all go to the contents fetch — same
    //    path as the original logic. Net behavior: zero false skips,
    //    ~95% fewer fetches on warm runs.
    for (const entry of paths) {
      const skillPath = entry.path;
      const blobSha = entry.sha;
      const id = `${repoName}/${skillPath}`;
      const existing = byId.get(id);

      if (existing && existing.content_sha && existing.content_sha === blobSha) {
        skippedUnchanged++;
        continue;
      }

      const record = await fetchAndBuildRecord(repo, skillPath);
      if (!record) continue;
      if (existing) updatedSkills++; else newSkills++;
      byId.set(id, record);
    }

    // Checkpoint
    if (processedRepos % CONFIG.CHECKPOINT_EVERY === 0) {
      writeMergedAtomic(byId);
      saveETagCache(getETagCache());
      log(`checkpoint: ${processedRepos}/${reposByName.size} (${newSkills} new, ${updatedSkills} updated, ${skippedUnchanged} skipped-unchanged)`);
    }
  }

  // 5. Final atomic write + ETag persist.
  writeMergedAtomic(byId);
  saveETagCache(getETagCache());

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  log(`=== Track 2 complete in ${elapsed}s — ${newSkills} new, ${updatedSkills} updated, ${skippedUnchanged} skipped-unchanged, total ${byId.size} ===`);
}

// BLOCKER 1: isMain guard. Only run main() when invoked as a script
// (process.argv[1] points at this file), NOT when imported by the smoke
// harness or tests. Compares URL form of argv[1] against import.meta.url
// for cross-platform safety (Windows path handling).
const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    const argvUrl = new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
    if (import.meta.url === argvUrl) return true;
    return process.argv[1].endsWith('scrape-discover-repos.js');
  } catch { return false; }
})();

if (isMain) {
  main().catch(err => {
    console.error('[discover] fatal:', err);
    // Best-effort partial-save: if RAW_PARTIAL_PATH exists, leave it for the
    // next run to inspect. Don't promote it to RAW_PATH on error.
    process.exit(1);
  });
}

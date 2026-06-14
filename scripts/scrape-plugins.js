#!/usr/bin/env node

/**
 * ClaudeAtlas Plugin Discovery Scraper
 *
 * Deep scan of the Claude plugin ecosystem. Discovers repos with
 * .claude-plugin/plugin.json or .claude-plugin/marketplace.json files,
 * fetches manifests, walks directory trees for component inventories.
 *
 * Output: data/plugins-raw.json — raw discovery data for strategic
 * planning. No site integration, no scoring, no pages. That happens
 * in a separate decision session with the human.
 *
 * Three phases:
 *   1. Discovery — GitHub code search with size-range partitioning
 *   2. Metadata — fetch repo info + plugin.json manifest for each repo
 *   3. Component walk — list skills/, agents/, commands/, hooks/,
 *      mcp-servers/ directories to build a component inventory
 *
 * Rate limiting: conservative, same pattern as scrape.js.
 * Checkpoints every 50 repos to data/plugins-raw.json.partial.
 * Resumable from checkpoint.
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeNdjsonStreaming, readNdjsonRecords } from './lib/ndjson.js';
import { fetchRepoBatchGraphql } from './lib/github-graphql.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
// T6: NDJSON format for the per-repo records. Metadata (scraped_at, stats)
// lives in a separate small JSON sidecar — bounded by structure, fine to
// keep as JSON.
const OUTPUT_PATH = join(DATA_DIR, 'plugins-raw.ndjson');
const META_PATH = join(DATA_DIR, 'plugins-meta.json');
const PARTIAL_PATH = join(DATA_DIR, 'plugins-raw.ndjson.partial');

// NOTE: the missing-token check lives at the top of main(), NOT here at
// module level — importing this module (e.g. from the test suite) must be
// side-effect free. See the invoked-as-script guard at the bottom.
const TOKEN = process.env.GITHUB_TOKEN;

const HEADERS = {
  'Authorization': `Bearer ${TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'ClaudeAtlas-PluginScraper/1.0',
};

const CHECKPOINT_EVERY = 50;

// Phase 3.4 / Change B (RESEARCH §2): GraphQL engagement-refresh batch sizing,
// mirroring scrape-pulse.js (BATCH_SIZE=50, BATCH_DELAY_MS=100). 50 repos/query
// via aliases at ~1 GraphQL point/batch; the small inter-batch delay keeps the
// sweep far under the 2,000-pts/min secondary GraphQL limit. ~146 batches for
// ~7,300 repos ≈ ~2-4 min on GraphQL's SEPARATE 5,000-pts/hr budget.
const REFRESH_BATCH_SIZE = 50;
const REFRESH_BATCH_DELAY_MS = 100;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Rate-limited fetch (same pattern as scrape.js) ---

let searchRequestsThisMinute = 0;
let searchMinuteStart = Date.now();
let generalRequestsThisHour = 0;
let generalHourStart = Date.now();

async function rateLimitedFetch(url, isSearch = false, retries = 3) {
  const now = Date.now();

  if (isSearch) {
    if (now - searchMinuteStart > 60000) {
      searchRequestsThisMinute = 0;
      searchMinuteStart = now;
    }
    if (searchRequestsThisMinute >= 9) {
      const waitMs = 60000 - (now - searchMinuteStart) + 1000;
      log(`  [rate-limit] Code search limit reached, waiting ${Math.ceil(waitMs / 1000)}s...`);
      await sleep(waitMs);
      searchRequestsThisMinute = 0;
      searchMinuteStart = Date.now();
    }
    searchRequestsThisMinute++;
  } else {
    if (now - generalHourStart > 3600000) {
      generalRequestsThisHour = 0;
      generalHourStart = now;
    }
    if (generalRequestsThisHour >= 4800) {
      const waitMs = 3600000 - (now - generalHourStart) + 1000;
      log(`  [rate-limit] General API limit approaching, waiting ${Math.ceil(waitMs / 1000)}s...`);
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
      log(`  [retry] Network error (${err.cause?.code || err.message}), retrying in 5s... (${retries} left)`);
      await sleep(5000);
      return rateLimitedFetch(url, isSearch, retries - 1);
    }
    throw err;
  }

  if (res.status === 403 || res.status === 429) {
    const resetHeader = res.headers.get('x-ratelimit-reset');
    if (resetHeader) {
      const resetTime = parseInt(resetHeader) * 1000;
      const waitMs = Math.max(resetTime - Date.now() + 2000, 5000);
      log(`  [rate-limit] ${res.status} hit, waiting ${Math.ceil(waitMs / 1000)}s until reset...`);
      await sleep(waitMs);
      return rateLimitedFetch(url, isSearch, retries);
    }
    log(`  [rate-limit] ${res.status} hit (no reset header), waiting 60s...`);
    await sleep(60000);
    return rateLimitedFetch(url, isSearch, retries);
  }

  return res;
}

// --- Phase 1: Discovery via code search ---

const SIZE_BUCKETS = [
  'size:<500',
  'size:500..1000',
  'size:1000..2000',
  'size:2000..5000',
  'size:5000..10000',
  'size:>10000',
];

async function discoverPluginRepos() {
  const repoSet = new Map(); // repo_full_name → { paths: Set, source: string }

  // Search for plugin.json files
  for (const fileQuery of [
    { filename: 'plugin.json', path: '.claude-plugin', label: 'plugin' },
    { filename: 'marketplace.json', path: '.claude-plugin', label: 'marketplace' },
  ]) {
    log(`=== Discovering ${fileQuery.label} files ===`);

    for (const sizeBucket of SIZE_BUCKETS) {
      const query = encodeURIComponent(`filename:${fileQuery.filename} path:${fileQuery.path} ${sizeBucket}`);
      let page = 1;

      while (page <= 10) {
        const url = `https://api.github.com/search/code?q=${query}&per_page=100&page=${page}`;
        log(`  [search] ${fileQuery.label} ${sizeBucket} page ${page}...`);

        const res = await rateLimitedFetch(url, true);
        if (!res.ok) {
          log(`  [search] HTTP ${res.status}, skipping`);
          break;
        }

        const data = await res.json();
        const items = data.items || [];
        if (items.length === 0) break;

        for (const item of items) {
          const repoName = item.repository.full_name;
          if (!repoSet.has(repoName)) {
            repoSet.set(repoName, {
              repo_full_name: repoName,
              paths: new Set(),
              sources: new Set(),
            });
          }
          const entry = repoSet.get(repoName);
          entry.paths.add(item.path);
          entry.sources.add(fileQuery.label);
        }

        log(`  [search] ${fileQuery.label} ${sizeBucket} page ${page}: ${items.length} results (${repoSet.size} unique repos)`);

        if (items.length < 100) break;
        page++;
        await sleep(200);
      }
    }
  }

  log(`[discovery] Total unique repos with plugin/marketplace files: ${repoSet.size}`);

  // Convert Sets to arrays for JSON serialization
  return [...repoSet.values()].map(r => ({
    ...r,
    paths: [...r.paths],
    sources: [...r.sources],
  }));
}

// --- Phase 2: Fetch repo metadata + plugin manifest ---

async function fetchRepoMetadata(repoFullName) {
  const url = `https://api.github.com/repos/${repoFullName}`;
  const res = await rateLimitedFetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return {
    stars: data.stargazers_count || 0,
    forks: data.forks_count || 0,
    open_issues: data.open_issues_count || 0,
    description: data.description || null,
    topics: data.topics || [],
    language: data.language || null,
    license: data.license?.spdx_id || null,
    created_at: data.created_at || null,
    pushed_at: data.pushed_at || null,
    archived: data.archived || false,
    is_fork: data.fork || false,
    owner_type: data.owner?.type || 'User',
    owner_avatar: data.owner?.avatar_url || null,
    default_branch: data.default_branch || 'main',
  };
}

async function fetchFileContent(repoFullName, path, branch = 'main') {
  const url = `https://api.github.com/repos/${repoFullName}/contents/${path}?ref=${branch}`;
  const res = await rateLimitedFetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.encoding === 'base64' && data.content) {
    try {
      return JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
    } catch {
      return null;
    }
  }
  return null;
}

// --- Phase 3: Component inventory via directory listing ---

const COMPONENT_DIRS = ['skills', 'agents', 'commands', 'hooks', 'mcp-servers', 'lsp-servers'];

/**
 * Phase 3.4 / Change C (RESEARCH §C / §3, Q3): fetch the FULL repo tree in ONE
 * recursive call and derive the component inventory from it, replacing the prior
 * COMPONENT_DIRS × 3-variants × contents-API loop (~6-18 REST calls/repo) with a
 * SINGLE `git/trees?recursive=1` GET. This mirrors Track 2's listSkillPaths
 * (scrape-discover-repos.js:152-168) and is strictly cheaper (ETag-cacheable,
 * 304-free on warm), which matters now that Change C re-walks the daily delta.
 *
 * CRITICAL (Pitfall 6 / R-5): the emitted shape is IDENTICAL to the old code —
 * `inventory[dir] = { path, count, entries }` with
 * `entries[] = { name, type:'dir'|'file', path, size }`. The `mcp-servers`
 * component MUST keep producing entries because filter-mcps.js derives EVERY
 * mcp_server record from `components['mcp-servers'].entries[]` +
 * `component_summary.mcp_servers` (MIN_MCP_REPOS=10 pre-flight FATALs otherwise).
 * git/trees `type` is 'tree'|'blob' → mapped to 'dir'|'file' to match the
 * contents-API shape the downstream consumers expect.
 *
 * Semantics preserved from the old walk:
 *   - variant precedence [`<dir>`, `.claude-plugin/<dir>`, `.claude/<dir>`];
 *     first NON-EMPTY variant wins (the old `break`).
 *   - IMMEDIATE entries only (one level deep): a tree path is an entry of the
 *     variant prefix iff its dirname === the prefix (matches the contents-API
 *     single-level listing — RESEARCH §4 caveat).
 *   - count = entries that are a dir OR end `.md`/`.json`.
 */
async function walkComponentDirs(repoFullName, branch = 'main') {
  const inventory = {};

  const url = `https://api.github.com/repos/${repoFullName}/git/trees/${branch}?recursive=1`;
  const res = await rateLimitedFetch(url);
  if (!res.ok) return inventory; // tree fetch failed → no components (same as all-404)

  const data = await res.json();
  const tree = Array.isArray(data.tree) ? data.tree : [];
  if (data.truncated) {
    log(`    [tree-truncated] ${repoFullName} — large repo, component inventory may be partial`);
  }

  // Immediate children of a given directory prefix, mapped to the old
  // contents-API entry shape (tree→dir, blob→file).
  const childrenOf = (prefix) => {
    const depth = prefix.split('/').length; // prefix is e.g. "skills" or ".claude/skills"
    return tree
      .filter((f) => {
        if (!f || typeof f.path !== 'string') return false;
        if (f.type !== 'tree' && f.type !== 'blob') return false;
        if (!f.path.startsWith(`${prefix}/`)) return false;
        // one level deep only: exactly one path segment past the prefix
        return f.path.split('/').length === depth + 1;
      })
      .map((f) => ({
        name: f.path.split('/').pop(),
        type: f.type === 'tree' ? 'dir' : 'file',
        path: f.path,
        size: f.size || 0,
      }));
  };

  for (const dir of COMPONENT_DIRS) {
    // Try multiple possible locations; first non-empty variant wins.
    const variants = [
      dir, // repo root: skills/
      `.claude-plugin/${dir}`, // inside .claude-plugin/
      `.claude/${dir}`, // legacy location
    ];

    for (const path of variants) {
      const entries = childrenOf(path);
      if (entries.length > 0) {
        inventory[dir] = {
          path,
          count: entries.filter(
            (e) => e.type === 'dir' || e.name.endsWith('.md') || e.name.endsWith('.json'),
          ).length,
          entries,
        };
        break; // found the directory, skip other path variants
      }
    }
  }

  return inventory;
}

// --- Resume support ---

/**
 * Phase 3.3 / D-02: streaming NDJSON checkpoint read. The pre-3.3 version
 * used the F1-banned whole-file parse-after-read pattern AND read a JSON
 * object's `.repos` key that saveCheckpoint (NDJSON array-of-records) never wrote —
 * the try/catch swallowed the mismatch, so `processedSet` resume never
 * worked. readNdjsonRecords matches the writer's shape and is
 * V8-string-limit safe.
 *
 * Path-injectable variant exported for unit tests
 * (scripts/__tests__/scrape-plugins.test.js).
 *
 * @param {string} path
 * @returns {{ repos: any[], processedSet: Set<string> }}
 */
export function loadCheckpointFrom(path) {
  if (!existsSync(path)) return { repos: [], processedSet: new Set() };
  try {
    const repos = [...readNdjsonRecords(path, { keyFn: r => r.repo_full_name }).values()];
    const processedSet = new Set(repos.map(r => r.repo_full_name));
    return { repos, processedSet };
  } catch {
    return { repos: [], processedSet: new Set() };
  }
}

/**
 * Phase 3.4 / Change A (RESEARCH §A / Pitfall 1): seed processedSet from the
 * cached OUTPUT corpus, merging the same-job .partial checkpoint.
 *
 * THE BUG this fixes: loadCheckpoint() read ONLY PARTIAL_PATH
 * (data/plugins-raw.ndjson.partial), but the GHA cache + bootstrap release
 * persist ONLY the OUTPUT data/plugins-raw.ndjson. The .partial never survives
 * between runs, so processedSet started empty every run, the line-363 skip
 * never fired, and all ~7,300 repos were re-walked from cold (~24h → timeout).
 *
 * Fix: union OUTPUT (the cached, completed corpus) with PARTIAL (a mid-run,
 * same-job checkpoint), keyed by repo_full_name. .partial wins per-repo because
 * it is the fresher within-run write. processedSet = union of both files' names.
 *
 * Path-injectable + exported for unit tests
 * (scripts/__tests__/scrape-plugins.test.js).
 *
 * @param {string} outputPath  cached + bootstrapped completed corpus
 * @param {string} partialPath same-job mid-run checkpoint (may be absent)
 * @returns {{ repos: any[], processedSet: Set<string> }}
 */
export function buildProcessedSeedFrom(outputPath, partialPath) {
  const fromOutput = loadCheckpointFrom(outputPath);   // cached + bootstrapped corpus
  const fromPartial = loadCheckpointFrom(partialPath); // same-job checkpoint, may be empty
  const byName = new Map();
  for (const r of fromOutput.repos) byName.set(r.repo_full_name, r);
  for (const r of fromPartial.repos) byName.set(r.repo_full_name, r); // partial wins (newer)
  const repos = [...byName.values()];
  return { repos, processedSet: new Set(repos.map(r => r.repo_full_name)) };
}

function loadCheckpoint() {
  return buildProcessedSeedFrom(OUTPUT_PATH, PARTIAL_PATH);
}

/**
 * Phase 3.4 / Change C (RESEARCH §C / Code Examples §3): the repo-level
 * completeness gate. Skip-fix (Change A) + GraphQL refresh (Change B) still
 * won't catch a KNOWN repo that ADDS a component (new skill/command/agent/MCP) —
 * no new repo ID, so the bare processedSet skip misses it. shouldRewalk decides
 * whether a KNOWN repo's component dirs need re-walking, by comparing the FRESH
 * pushed_at (from Change B's GraphQL refresh) against the pushed_at captured at
 * the LAST walk (record.walked_pushed_at). This mirrors Track 2's blob-sha
 * change-detection skip (scrape-discover-repos.js) at repo granularity.
 *
 * ISO 8601 timestamps compare lexicographically === chronologically, so a plain
 * string `>` is correct (and avoids Date parsing of possibly-null inputs).
 *
 * Decision table (KNOWN repo only — a brand-new repo is not in processedSet and
 * never reaches this helper):
 *   - opts.periodicFull          → TRUE  (safety-net full re-walk shard, Task 4)
 *   - no walked_pushed_at stamp   → TRUE  (never stamped → walk once to backfill)
 *   - no fresh pushed_at signal   → FALSE (refresh casualty → keep cached, don't
 *                                          churn a re-walk every run with no signal)
 *   - freshPushedAt > stamp       → TRUE  (pushed since last walk → component may
 *                                          have been added → re-walk)
 *   - freshPushedAt <= stamp      → FALSE (unchanged → keep cached for free)
 *
 * Pure + network-free; exported for unit tests
 * (scripts/__tests__/scrape-plugins.test.js R-4).
 *
 * @param {{ walked_pushed_at?: string|null }} known   the cached corpus record
 * @param {string|null|undefined} freshPushedAt         fresh pushed_at (Change B)
 * @param {{ periodicFull?: boolean }} [opts]
 * @returns {boolean} true → re-walk this repo's components
 */
export function shouldRewalk(known, freshPushedAt, opts = {}) {
  if (opts.periodicFull) return true;            // safety-net full re-walk shard
  if (!known.walked_pushed_at) return true;      // never stamped → walk to backfill
  if (!freshPushedAt) return false;              // no fresh signal → keep cached
  return freshPushedAt > known.walked_pushed_at; // ISO lexicographic = chronological
}

/**
 * Path-injectable checkpoint writer (T6: streaming NDJSON — V8-string-limit
 * safe). Exported for unit tests.
 *
 * @param {string} path
 * @param {any[]} repos
 */
export function saveCheckpointTo(path, repos) {
  writeNdjsonStreaming(path, repos);
}

function saveCheckpoint(repos) {
  saveCheckpointTo(PARTIAL_PATH, repos);
}

// --- Phase 3.4 / Change B: GraphQL engagement-refresh of known plugin repos ---

/**
 * Pure: map fetchRepoBatchGraphql's repo_*-PREFIXED fields onto the BARE
 * plugins-raw record shape (the fetchRepoMetadata keys: stars/forks/open_issues/
 * pushed_at/...), IN-PLACE, for every record whose repo_full_name has an entry
 * in freshByRepo.
 *
 * Miss = no-op: a record with no freshByRepo entry is left byte-for-byte
 * unchanged (graceful staleness — a repo the GraphQL batch couldn't resolve
 * keeps its prior cached values rather than being blanked). default_branch uses
 * `?? existing` so a null/undefined fresh branch keeps the prior branch.
 *
 * NOTE: created_at, owner_type, owner_avatar, is_fork are NOT in the GraphQL
 * freshness set (see github-graphql.js mapGraphqlRepoToFields) — left untouched.
 *
 * Exported (pure, network-free) for unit tests.
 *
 * @param {any[]} records — cached plugins-raw corpus (mutated in-place).
 * @param {Map<string, object>} freshByRepo — repo_full_name → repo_*-prefixed fields.
 */
export function applyFreshFields(records, freshByRepo) {
  for (const r of records) {
    const f = freshByRepo.get(r.repo_full_name);
    if (!f) continue; // miss = no-op (graceful staleness)
    r.stars = f.repo_stars;
    r.forks = f.repo_forks;
    r.open_issues = f.repo_open_issues;
    r.pushed_at = f.repo_pushed_at;
    r.topics = f.repo_topics;
    r.archived = f.repo_archived;
    r.license = f.repo_license;
    r.language = f.repo_language;
    r.description = f.repo_description;
    r.default_branch = f.repo_default_branch ?? r.default_branch;
  }
}

/**
 * Refresh known plugin repos' engagement signals via batched GraphQL, mirroring
 * scrape-pulse.js's Track 1 sweep (RESEARCH §2). Runs on GraphQL's SEPARATE
 * 5,000-pts/hr budget so skipping known repos' REST walk (Change A) doesn't
 * freeze their stars/forks/issues/pushed_at. Operates on the in-memory `records`
 * array (already loaded by loadCheckpoint) — does NOT re-read plugins-raw.ndjson
 * (banned-pattern discipline). The fresh fields are applied in-place; the
 * returned Map is consumed by Plan 03's pushed_at re-walk gate.
 *
 * AUTH (mirrors scrape-pulse.js): fetchRepoBatchGraphql reads
 * process.env.GITHUB_TOKEN, which MUST be a CLASSIC PAT — the fine-grained
 * SCRAPE_PAT is 403'd by GitHub's GraphQL API. The same process's REST
 * discovery/walk needs the fine-grained SCRAPE_PAT, so we swap GITHUB_TOKEN to
 * SCRAPE_PAT_CLASSIC for the GraphQL batch loop ONLY and restore the REST PAT
 * in a finally. The workflow step passes both secrets.
 *
 * Graceful staleness (RESEARCH §Environment / Pitfall): a refresh failure does
 * NOT throw — fetchRepoBatchGraphql returns failures as tolerated casualties
 * (no throw on partial data), and applyFreshFields no-ops on missing repos.
 *
 * @param {any[]} records — cached plugins-raw corpus (mutated in-place).
 * @returns {Promise<Map<string, object>>} repo_full_name → repo_*-prefixed fresh fields.
 */
async function refreshKnownRepos(records) {
  const names = [...new Set(records.map(r => r.repo_full_name).filter(Boolean))];
  const fresh = new Map();

  // Swap to the CLASSIC PAT for GraphQL; restore the fine-grained REST PAT after.
  const restPat = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = process.env.SCRAPE_PAT_CLASSIC || restPat;
  try {
    const totalBatches = Math.ceil(names.length / REFRESH_BATCH_SIZE);
    let bi = 0;
    for (let i = 0; i < names.length; i += REFRESH_BATCH_SIZE) {
      bi++;
      const { freshByRepo } = await fetchRepoBatchGraphql(
        names.slice(i, i + REFRESH_BATCH_SIZE),
      );
      for (const [n, f] of freshByRepo) fresh.set(n, f);
      if (bi % 10 === 0 || bi === totalBatches) {
        log(`  [refresh] batch ${bi}/${totalBatches} (${fresh.size} ok)`);
      }
      await sleep(REFRESH_BATCH_DELAY_MS); // stay under 2000 pts/min secondary cap
    }
  } finally {
    process.env.GITHUB_TOKEN = restPat; // restore the fine-grained REST PAT
  }

  applyFreshFields(records, fresh);
  return fresh; // returned so Plan 03's pushed_at re-walk gate can read fresh pushed_at
}

// --- Main ---

async function main() {
  if (!TOKEN) {
    console.error('ERROR: GITHUB_TOKEN environment variable required.');
    process.exit(1);
  }

  log('=== plugin scraper start ===');

  // Phase 1: Discovery
  log('--- Phase 1: Discovery ---');
  const discovered = await discoverPluginRepos();
  log(`Discovered ${discovered.length} repos with plugin/marketplace files`);

  // Phase 2 & 3: Metadata + manifest + component walk
  log('--- Phase 2 & 3: Metadata + Components ---');

  const { repos: existingRepos, processedSet } = loadCheckpoint();
  const allRepos = [...existingRepos];
  let newCount = 0;
  let rewalkCount = 0;

  // Phase 3.4 / Change C: index the cached corpus by name so the discovery loop
  // can look up a KNOWN repo's record (its walked_pushed_at stamp) and its
  // position in allRepos to OVERWRITE on re-walk rather than append a duplicate.
  const byName = new Map();
  const indexByName = new Map();
  for (let i = 0; i < allRepos.length; i++) {
    const r = allRepos[i];
    byName.set(r.repo_full_name, r);
    indexByName.set(r.repo_full_name, i);
  }

  // Phase 3.4 / Change C: periodic FULL re-walk safety net (RESEARCH §Q2,
  // CONTEXT "periodic full re-walk = Claude's discretion → weekly shard").
  // The pushed_at gate (shouldRewalk) is the PRIMARY mechanism; this is
  // belt-and-suspenders for the rare case where a repo's components changed but
  // its pushed_at somehow didn't advance. Cadence: re-walk the ENTIRE known
  // corpus once per week, gated on UTC day-of-week (Sundays = getUTCDay() === 0),
  // matching the skills weekly-sweep convention (scrape-discover-repos.js). On
  // the other 6 days only the pushed_at-changed delta walks, so steady-state
  // cost stays single-digit minutes. Now that each re-walk is ONE recursive-tree
  // call (Task 3), even the Sunday full sweep is bounded by the GraphQL refresh
  // budget, not the old N-contents-calls blowup.
  //
  // PLUGINS_FULL_REWALK=1 forces the full re-walk regardless of day so Plan 04's
  // branch measurement can take the worst-case full-sweep number on demand (and
  // the cheap steady-state number on a non-Sunday).
  const periodicFull = process.env.PLUGINS_FULL_REWALK === '1' || new Date().getUTCDay() === 0;
  log(`[gate] periodicFull=${periodicFull} (UTC day ${new Date().getUTCDay()})`);

  // Phase 3.4 / Change A: on a warm run this should print near the full known
  // corpus (~7,300), NOT 0. A count near 0 is the Pitfall-1 warning sign that
  // the cached OUTPUT was not seeded (the original 24h-sweep bug). Plan 04's
  // branch measurement reads this line to confirm the skip is wired.
  log(`resume: ${processedSet.size} known repos seeded from OUTPUT+partial`);

  // Phase 3.4 / Change B (RESEARCH §2): refresh known repos' engagement signals
  // via batched GraphQL BEFORE the discovery walk. Seeding processedSet from
  // OUTPUT (Change A) skips known repos' REST walk, which would otherwise freeze
  // their stars/forks/issues/pushed_at — this pass keeps them fresh on GraphQL's
  // separate budget. `fresh` stays in scope: Plan 03's pushed_at re-walk gate
  // reads it to decide which known repos changed since last walk.
  let fresh = new Map();
  if (existingRepos.length) {
    log(`[refresh] refreshing ${existingRepos.length} known repos via GraphQL...`);
    fresh = await refreshKnownRepos(existingRepos);
    log(`[refresh] done: ${fresh.size}/${existingRepos.length} repos refreshed`);
  } else {
    log('[refresh] no known repos yet, skipping');
  }

  for (let i = 0; i < discovered.length; i++) {
    const disc = discovered[i];
    const repoName = disc.repo_full_name;

    // Phase 3.4 / Change C (RESEARCH §3): a KNOWN repo is skipped UNLESS its
    // components may have changed. shouldRewalk gates on the fresh pushed_at
    // (Change B) advancing past the stored walked_pushed_at, the periodicFull
    // safety-net shard, or a missing stamp (backfill). A brand-new repo
    // (`known === undefined`) is NOT in processedSet, so it falls through to the
    // walk via the existing new-repo path.
    const known = byName.get(repoName);
    const isRewalk = known ? shouldRewalk(known, fresh.get(repoName)?.repo_pushed_at, { periodicFull }) : false;
    if (processedSet.has(repoName) && !isRewalk) {
      continue; // unchanged known repo — keep cached components for free
    }

    log(`  [${(isRewalk ? rewalkCount : newCount) + 1}/?] ${isRewalk ? 'Re-walking' : 'Processing'} ${repoName}...`);

    const startTime = Date.now();

    // Fetch repo metadata
    const meta = await fetchRepoMetadata(repoName);
    if (!meta) {
      log(`    [skip] Could not fetch repo metadata (deleted/private?)`);
      continue;
    }

    // Skip archived and forked repos
    if (meta.archived) {
      log(`    [skip] Archived`);
      continue;
    }

    // Fetch plugin.json manifest
    let pluginManifest = null;
    for (const path of disc.paths) {
      if (path.endsWith('plugin.json')) {
        pluginManifest = await fetchFileContent(repoName, path, meta.default_branch);
        if (pluginManifest) break;
      }
    }

    // Fetch marketplace.json if present
    let marketplaceManifest = null;
    for (const path of disc.paths) {
      if (path.endsWith('marketplace.json')) {
        marketplaceManifest = await fetchFileContent(repoName, path, meta.default_branch);
        if (marketplaceManifest) break;
      }
    }

    // Walk component directories
    const components = await walkComponentDirs(repoName, meta.default_branch);

    const record = {
      repo_full_name: repoName,
      discovery_paths: disc.paths,
      discovery_sources: disc.sources,
      ...meta,
      plugin_manifest: pluginManifest,
      marketplace_manifest: marketplaceManifest ? (() => {
        const pluginsList = Array.isArray(marketplaceManifest.plugins) ? marketplaceManifest.plugins : [];
        return {
          name: marketplaceManifest.name,
          owner: marketplaceManifest.owner,
          plugin_count: pluginsList.length,
          plugins: pluginsList.map(p => ({
            name: p?.name || null,
            description: p?.description || null,
            version: p?.version || null,
            source: typeof p?.source === 'string' ? p.source : p?.source?.repo || null,
          })),
        };
      })() : null,
      components,
      component_summary: {
        skills: components.skills?.count || 0,
        agents: components.agents?.count || 0,
        commands: components.commands?.count || 0,
        hooks: components.hooks?.count || 0,
        mcp_servers: components['mcp-servers']?.count || 0,
        lsp_servers: components['lsp-servers']?.count || 0,
        total: Object.values(components).reduce((sum, c) => sum + (c.count || 0), 0),
      },
      scraped_at: new Date().toISOString(),
      processing_time_ms: Date.now() - startTime,
      // Phase 3.4 / Change C: stamp the pushed_at captured at THIS walk so the
      // next run's shouldRewalk gate can detect a later push (new component).
      walked_pushed_at: meta.pushed_at,
    };

    if (isRewalk && indexByName.has(repoName)) {
      // Re-walked KNOWN repo: OVERWRITE its prior record in place so the OUTPUT
      // stays free of duplicate repo_full_names (a dupe would inflate the next
      // run's processedSet and skew component-summary stats).
      allRepos[indexByName.get(repoName)] = record;
      rewalkCount++;
    } else {
      allRepos.push(record);
      indexByName.set(repoName, allRepos.length - 1);
      newCount++;
    }
    byName.set(repoName, record);
    processedSet.add(repoName);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const compSummary = Object.entries(record.component_summary)
      .filter(([k, v]) => k !== 'total' && v > 0)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ') || 'no components found';
    log(`    ${meta.stars} stars | ${compSummary} | ${elapsed}s${isRewalk ? ' (re-walk)' : ''}`);

    // Checkpoint
    if ((newCount + rewalkCount) % CHECKPOINT_EVERY === 0) {
      saveCheckpoint(allRepos);
      log(`  [checkpoint] ${allRepos.length} repos saved`);
    }

    await sleep(200); // Polite pause
  }

  // T6: split into NDJSON records file + small JSON metadata sidecar.
  // The repos array can grow large (currently ~34 MB JSON-array; would
  // crash at V8 string limit eventually). NDJSON streams writes per
  // record. The stats summary is bounded by structure (~1 KB at any
  // catalog size) — JSON is fine for it.
  const meta = {
    scraped_at: new Date().toISOString(),
    total_discovered: discovered.length,
    total_processed: allRepos.length,
    stats: {
      with_plugin_json: allRepos.filter(r => r.plugin_manifest).length,
      with_marketplace: allRepos.filter(r => r.marketplace_manifest).length,
      with_skills: allRepos.filter(r => r.component_summary.skills > 0).length,
      with_agents: allRepos.filter(r => r.component_summary.agents > 0).length,
      with_commands: allRepos.filter(r => r.component_summary.commands > 0).length,
      with_hooks: allRepos.filter(r => r.component_summary.hooks > 0).length,
      with_mcp_servers: allRepos.filter(r => r.component_summary.mcp_servers > 0).length,
      avg_stars: Math.round(allRepos.reduce((s, r) => s + (r.stars || 0), 0) / Math.max(1, allRepos.length)),
      total_components: allRepos.reduce((s, r) => s + (r.component_summary.total || 0), 0),
    },
  };
  const output = { ...meta };  // legacy `output` reference preserved for log lines below

  writeNdjsonStreaming(OUTPUT_PATH, allRepos);
  writeFileSync(META_PATH, JSON.stringify(meta, null, 2), 'utf-8');
  log(`wrote ${OUTPUT_PATH} (${allRepos.length} records) + ${META_PATH} (metadata)`);

  log('');
  log('=== summary ===');
  log(`discovered: ${discovered.length} repos`);
  log(`processed:  ${allRepos.length} repos (${newCount} new + ${rewalkCount} re-walked this run)`);
  log(`with plugin.json:   ${output.stats.with_plugin_json}`);
  log(`with marketplace:   ${output.stats.with_marketplace}`);
  log(`with skills:        ${output.stats.with_skills}`);
  log(`with agents:        ${output.stats.with_agents}`);
  log(`with commands:      ${output.stats.with_commands}`);
  log(`with hooks:         ${output.stats.with_hooks}`);
  log(`with MCP servers:   ${output.stats.with_mcp_servers}`);
  log(`avg stars:          ${output.stats.avg_stars}`);
  log(`total components:   ${output.stats.total_components}`);
  log('=== plugin scraper complete ===');
}

// Invoked-as-script guard (mirrors filter-plugins.js): importing this module
// (unit tests) must NOT start the scraper.
const invokedAsScript = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  main().catch(err => {
    console.error(`FATAL: ${err.stack || err.message}`);
    process.exit(1);
  });
}

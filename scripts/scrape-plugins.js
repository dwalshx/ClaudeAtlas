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

async function walkComponentDirs(repoFullName, branch = 'main') {
  const inventory = {};

  for (const dir of COMPONENT_DIRS) {
    // Try multiple possible locations
    const paths = [
      dir,                          // repo root: skills/
      `.claude-plugin/${dir}`,      // inside .claude-plugin/
      `.claude/${dir}`,             // legacy location
    ];

    for (const path of paths) {
      const url = `https://api.github.com/repos/${repoFullName}/contents/${path}?ref=${branch}`;
      const res = await rateLimitedFetch(url);

      if (res.status === 404) continue;
      if (!res.ok) continue;

      const data = await res.json();
      if (!Array.isArray(data)) continue;

      const entries = data
        .filter(item => item.type === 'dir' || item.type === 'file')
        .map(item => ({
          name: item.name,
          type: item.type,
          path: item.path,
          size: item.size || 0,
        }));

      if (entries.length > 0) {
        inventory[dir] = {
          path,
          count: entries.filter(e => e.type === 'dir' || e.name.endsWith('.md') || e.name.endsWith('.json')).length,
          entries,
        };
        break; // found the directory, skip other path variants
      }
    }

    await sleep(100); // Be gentle between directory listings
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

  // Phase 3.4 / Change A: on a warm run this should print near the full known
  // corpus (~7,300), NOT 0. A count near 0 is the Pitfall-1 warning sign that
  // the cached OUTPUT was not seeded (the original 24h-sweep bug). Plan 04's
  // branch measurement reads this line to confirm the skip is wired.
  log(`resume: ${processedSet.size} known repos seeded from OUTPUT+partial`);

  for (let i = 0; i < discovered.length; i++) {
    const disc = discovered[i];
    const repoName = disc.repo_full_name;

    if (processedSet.has(repoName)) {
      continue; // Already processed in a prior run
    }

    log(`  [${newCount + 1}/?] Processing ${repoName}...`);

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
    };

    allRepos.push(record);
    processedSet.add(repoName);
    newCount++;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const compSummary = Object.entries(record.component_summary)
      .filter(([k, v]) => k !== 'total' && v > 0)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ') || 'no components found';
    log(`    ${meta.stars} stars | ${compSummary} | ${elapsed}s`);

    // Checkpoint
    if (newCount % CHECKPOINT_EVERY === 0) {
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
  log(`processed:  ${allRepos.length} repos (${newCount} new this run)`);
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

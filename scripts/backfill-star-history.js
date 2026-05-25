#!/usr/bin/env node

/**
 * ClaudeAtlas Star History Backfill
 *
 * One-time backfill of the full star-growth trajectory for every unique repo
 * that contains a Featured skill. Used to power embeddable star-history charts
 * (DIST-02) and to feed the time-series moat that daily snapshots extend from
 * 2026-04-11 onward.
 *
 * How it works:
 *   1. Read data/skills.json, collect unique `repo_full_name` values where
 *      quality_tier === 'featured'.
 *   2. For each repo, GET /repos/{owner}/{repo}/stargazers with the v3.star+json
 *      Accept header. Paginate 100 per page until fewer than 100 items come back.
 *   3. Convert stargazer events into running-total points:
 *      [{ timestamp, star_count }, ...] where star_count is the cumulative
 *      position of that star event.
 *   4. Checkpoint to data/star-history.json.partial every 10 repos.
 *   5. On completion, rename .partial to data/star-history.json.
 *
 * Resumable: if data/star-history.json.partial exists at start, repos already
 * present are skipped. Safe to re-run.
 *
 * Rate limiting: authenticated core limit is 5000 req/hr. This script is
 * conservative — sleeps 300ms between requests and honors X-RateLimit-Reset
 * on 403/429.
 *
 * GitHub stargazer API caps pagination at 40,000 stars per repo. For repos
 * above that, we capture the first 40k only and log a warning.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadSkillsArray } from './lib/skills-stream.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
// T5: NDJSON. Reads use loadSkillsArray() (handles legacy fallback).
const SKILLS_PATH = join(DATA_DIR, 'skills.ndjson');
const OUTPUT_PATH = join(DATA_DIR, 'star-history.json');
const PARTIAL_PATH = join(DATA_DIR, 'star-history.json.partial');

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('ERROR: GITHUB_TOKEN environment variable required.');
  process.exit(1);
}

const HEADERS = {
  'Authorization': `Bearer ${TOKEN}`,
  'Accept': 'application/vnd.github.v3.star+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'ClaudeAtlas-StarHistoryBackfill/1.0',
};

const PER_PAGE = 100;
const MAX_PAGES = 400;           // GitHub caps stargazer pagination at 40k stars
const POLITE_DELAY_MS = 300;     // sleep between requests — well under the 5000/hr limit
const CHECKPOINT_EVERY = 10;     // save .partial after every N repos
const MAX_RETRIES = 4;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ts() {
  return new Date().toISOString();
}

function log(msg) {
  console.log(`[${ts()}] ${msg}`);
}

async function rateLimitedFetch(url, attempt = 1) {
  let res;
  try {
    res = await fetch(url, { headers: HEADERS });
  } catch (err) {
    if (attempt >= MAX_RETRIES) throw err;
    const waitMs = 2000 * attempt;
    log(`  [retry] network error (${err.cause?.code || err.message}), waiting ${waitMs}ms (attempt ${attempt}/${MAX_RETRIES})`);
    await sleep(waitMs);
    return rateLimitedFetch(url, attempt + 1);
  }

  if (res.status === 403 || res.status === 429) {
    const resetHeader = res.headers.get('x-ratelimit-reset');
    if (resetHeader) {
      const resetTime = parseInt(resetHeader) * 1000;
      const waitMs = Math.max(resetTime - Date.now() + 2000, 5000);
      log(`  [rate-limit] ${res.status} hit, waiting ${Math.ceil(waitMs / 1000)}s until reset...`);
      await sleep(waitMs);
      return rateLimitedFetch(url, attempt);
    }
    log(`  [rate-limit] ${res.status} hit (no reset header), waiting 60s...`);
    await sleep(60000);
    return rateLimitedFetch(url, attempt);
  }

  return res;
}

async function fetchStarHistoryForRepo(repoFullName) {
  const [owner, repo] = repoFullName.split('/');
  if (!owner || !repo) {
    log(`  [skip] invalid repo name: ${repoFullName}`);
    return { status: 'invalid', history: [] };
  }

  const history = [];
  let cumulative = 0;
  let hitCap = false;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/repos/${owner}/${repo}/stargazers?per_page=${PER_PAGE}&page=${page}`;
    const res = await rateLimitedFetch(url);

    if (res.status === 404) {
      log(`  [404] ${repoFullName} not found (renamed/deleted?), skipping`);
      return { status: 'not_found', history: [] };
    }

    if (res.status === 451) {
      log(`  [451] ${repoFullName} unavailable for legal reasons, skipping`);
      return { status: 'unavailable', history: [] };
    }

    if (!res.ok) {
      log(`  [error] ${repoFullName} page ${page} HTTP ${res.status}, aborting repo`);
      return { status: `http_${res.status}`, history };
    }

    let items;
    try {
      items = await res.json();
    } catch (err) {
      log(`  [error] ${repoFullName} page ${page} JSON parse error: ${err.message}`);
      return { status: 'parse_error', history };
    }

    if (!Array.isArray(items) || items.length === 0) {
      break;
    }

    for (const item of items) {
      const starredAt = item && item.starred_at;
      if (!starredAt) continue;
      cumulative += 1;
      history.push({ t: starredAt, c: cumulative });
    }

    if (items.length < PER_PAGE) {
      break;
    }

    if (page === MAX_PAGES) {
      hitCap = true;
      log(`  [cap] ${repoFullName} exceeded ${MAX_PAGES * PER_PAGE} stars (GitHub API cap), truncating`);
    }

    await sleep(POLITE_DELAY_MS);
  }

  return { status: hitCap ? 'ok_truncated' : 'ok', history };
}

function loadExisting() {
  if (existsSync(PARTIAL_PATH)) {
    try {
      return JSON.parse(readFileSync(PARTIAL_PATH, 'utf-8'));
    } catch (err) {
      log(`  [warn] could not parse existing .partial: ${err.message} — starting fresh`);
      return { generated_at: null, repos: {}, meta: { stats: {} } };
    }
  }
  return { generated_at: null, repos: {}, meta: { stats: {} } };
}

function saveCheckpoint(data) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  data.generated_at = ts();
  writeFileSync(PARTIAL_PATH, JSON.stringify(data), 'utf-8');
}

async function main() {
  log('=== star-history backfill start ===');

  // T5: loadSkillsArray() handles NDJSON + legacy fallback.
  let skills;
  try {
    skills = loadSkillsArray();
  } catch (err) {
    console.error(`ERROR: ${err.message}. Run the pipeline first.`);
    process.exit(1);
  }
  const featured = skills.filter(s => s.quality_tier === 'featured');
  const uniqueRepos = [...new Set(featured.map(s => s.repo_full_name))].sort();

  log(`found ${featured.length} featured skills across ${uniqueRepos.length} unique repos`);

  const existing = loadExisting();
  const alreadyDone = new Set(Object.keys(existing.repos));
  if (alreadyDone.size > 0) {
    log(`resuming: ${alreadyDone.size} repos already captured in .partial`);
  }

  const pending = uniqueRepos.filter(r => !alreadyDone.has(r));
  log(`${pending.length} repos to fetch this run`);

  let completed = alreadyDone.size;
  let errorCount = 0;
  const stats = existing.meta?.stats || {};

  for (let i = 0; i < pending.length; i++) {
    const repo = pending[i];
    const startedAt = Date.now();

    try {
      const { status, history } = await fetchStarHistoryForRepo(repo);
      existing.repos[repo] = {
        status,
        count: history.length,
        fetched_at: ts(),
        events: history,
      };
      stats[status] = (stats[status] || 0) + 1;

      const durationMs = Date.now() - startedAt;
      completed++;
      log(`  [${completed}/${uniqueRepos.length}] ${repo} → ${status} (${history.length} events, ${durationMs}ms)`);
    } catch (err) {
      errorCount++;
      existing.repos[repo] = {
        status: 'exception',
        count: 0,
        fetched_at: ts(),
        error: err.message,
        events: [],
      };
      stats.exception = (stats.exception || 0) + 1;
      log(`  [ERROR] ${repo}: ${err.message}`);
    }

    existing.meta = { stats, last_repo: repo };

    if ((i + 1) % CHECKPOINT_EVERY === 0 || i === pending.length - 1) {
      saveCheckpoint(existing);
      log(`  [checkpoint] saved ${PARTIAL_PATH} (${Object.keys(existing.repos).length} repos)`);
    }
  }

  // Final save
  saveCheckpoint(existing);

  // Promote .partial → final
  const finalOutput = {
    generated_at: ts(),
    repo_count: Object.keys(existing.repos).length,
    meta: { stats },
    repos: existing.repos,
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(finalOutput), 'utf-8');
  log(`wrote ${OUTPUT_PATH} (${finalOutput.repo_count} repos)`);

  log('=== summary ===');
  for (const [k, v] of Object.entries(stats)) {
    log(`  ${k}: ${v}`);
  }
  log(`errors (exceptions): ${errorCount}`);
  log('=== star-history backfill complete ===');
}

main().catch(err => {
  console.error(`FATAL: ${err.stack || err.message}`);
  process.exit(1);
});

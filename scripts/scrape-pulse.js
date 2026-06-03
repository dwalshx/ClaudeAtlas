#!/usr/bin/env node
/**
 * ClaudeAtlas Track 1 — Star Pulse
 *
 * Daily refresh of engagement signals on every repo in data/skills.ndjson.
 * Refreshes via batched GraphQL repository(...) queries (50 repos/query via
 * aliases, ~88 serial queries for ~4,351 repos). This replaces the prior
 * per-repo REST GET loop, which fired ~4,351 back-to-back requests and tripped
 * GitHub's secondary (abuse) rate limit — RESEARCH §2.
 * Updates in-place: all 11 TRACK1_FRESHNESS_FIELDS (stars, forks, open_issues,
 * pushed_at, updated_at, archived, topics, license, language, description,
 * default_branch). Does NOT touch content fields.
 *
 * Side effect: writes today's data/history/YYYY-MM-DD.json snapshot from the
 * fresh metadata (the moat-feeder).
 *
 * Inputs:  data/skills.ndjson (current corpus). The GraphQL pulse path does
 *          NOT use data/etag-cache.json (that's Track 2's REST content fetch).
 * Outputs: data/skills.ndjson (mutated in-place), data/history/YYYY-MM-DD.json
 * Cost:    ~88 GraphQL queries (50 repos/query) at ~1 point each for ~4,351
 *          repos, well within the 5000 GraphQL-points/hr SCRAPE_PAT budget.
 * Resumable: No checkpoint — script is fast enough that failure = re-run from start.
 *            Tolerates partial failures (404/451) up to 10% of repos.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sleep } from './lib/github-fetch.js';
import { fetchRepoBatchGraphql } from './lib/github-graphql.js';
import { TRACK1_FRESHNESS_FIELDS } from './lib/skill-fields.js';
import { writeNdjsonStreaming } from './lib/ndjson.js';
import { loadSkillsArray } from './lib/skills-stream.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const HISTORY_DIR = join(DATA_DIR, 'history');
// T5: NDJSON format. Reader uses loadSkillsArray() which resolves the path
// and handles the legacy JSON fallback; writer targets the NDJSON path.
const SKILLS_PATH = join(DATA_DIR, 'skills.ndjson');

const CONFIG = {
  // RESEARCH §5: bumped 0.10 → 0.15 so a partial secondary-limit blip does not
  // drop the unreplayable daily-history snapshot. A 15% casualty rate is still
  // well inside the deleted/private/DMCA noise band for ~4,351 repos.
  MAX_FAIL_RATIO: 0.15,   // workflow-fatal threshold
  LOG_EVERY: 5,           // progress cadence (now in BATCHES, not repos)
};

// GraphQL batch sizing (RESEARCH §2). 50 repos/query × ~88 serial batches for
// ~4,351 repos; a small inter-batch delay keeps the sweep far under the
// 2,000-pts/min secondary GraphQL limit. ~88 batches cannot trip the abuse
// heuristic the way ~4,351 back-to-back REST GETs did.
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 100;

function log(msg) { console.log(`[pulse] ${msg}`); }

// --- History snapshot (copied from scripts/scrape.js writeHistorySnapshot) ---
// Reads repo_archived (refreshed by pulse) and repo_is_fork (sourced from the
// existing skill record — pulse does not refresh it; the weekly Track 2 full
// sweep catches changes).

function writeHistorySnapshot(skills) {
  if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const snapshotPath = join(HISTORY_DIR, `${today}.json`);
  if (existsSync(snapshotPath)) {
    log(`[history] snapshot for ${today} already exists, skipping`);
    return;
  }

  const repos = {};
  const seen = new Set();
  for (const skill of skills) {
    const name = skill.repo_full_name;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (skill.repo_archived || skill.repo_is_fork) continue;
    repos[name] = {
      s: skill.repo_stars,
      f: skill.repo_forks,
      i: skill.repo_open_issues,
      p: skill.repo_pushed_at,
    };
  }

  const snapshot = {
    date: today,
    timestamp: new Date().toISOString(),
    repo_count: Object.keys(repos).length,
    repos,
  };
  writeFileSync(snapshotPath, JSON.stringify(snapshot), 'utf-8');
  log(`[history] wrote ${snapshotPath} (${Object.keys(repos).length} repos)`);
}

// --- Main orchestrator ---

async function main() {
  const startTime = Date.now();
  log('=== ClaudeAtlas Track 1 (Star Pulse) ===');
  log(`Started ${new Date().toISOString()}`);

  // T5: loadSkillsArray() resolves the NDJSON path (with legacy .json fallback)
  // and reads via chunked I/O — V8-string-limit safe.
  let skills;
  try {
    skills = loadSkillsArray();
  } catch (err) {
    console.error(`[pulse] FATAL: could not load skills: ${err.message}`);
    process.exit(1);
  }
  log(`Loaded ${skills.length} skills`);

  // Dedup by repo_full_name
  const uniqueRepos = new Set(skills.map(s => s.repo_full_name).filter(Boolean));
  log(`Unique repos to refresh: ${uniqueRepos.size}`);

  // Refresh in batched GraphQL queries (RESEARCH §2). GraphQL has no 304/ETag
  // path — every batch is a fresh fetch (no cached-count tracking).
  const freshByRepo = new Map();    // repoFullName -> { fields }
  const failures = [];              // { repoFullName, status }
  const repoList = [...uniqueRepos];
  const totalBatches = Math.ceil(repoList.length / BATCH_SIZE);
  let batchIdx = 0;

  for (let i = 0; i < repoList.length; i += BATCH_SIZE) {
    batchIdx++;
    const slice = repoList.slice(i, i + BATCH_SIZE);
    const { freshByRepo: batchFresh, failures: batchFailures } =
      await fetchRepoBatchGraphql(slice);
    for (const [repoFullName, fields] of batchFresh) {
      freshByRepo.set(repoFullName, fields);
    }
    for (const f of batchFailures) failures.push(f);
    if (batchIdx % CONFIG.LOG_EVERY === 0 || batchIdx === totalBatches) {
      log(`progress: batch ${batchIdx}/${totalBatches} (${freshByRepo.size} ok, ${failures.length} failed)`);
    }
    await sleep(BATCH_DELAY_MS);
  }

  log(`refresh done: ${freshByRepo.size}/${uniqueRepos.size} ok, ${failures.length} failed`);

  // Fail-loud only if too many failures
  const failRatio = failures.length / Math.max(uniqueRepos.size, 1);
  if (failRatio > CONFIG.MAX_FAIL_RATIO) {
    console.error(`[pulse] FATAL: failure ratio ${(failRatio * 100).toFixed(1)}% > ${CONFIG.MAX_FAIL_RATIO * 100}%`);
    for (const f of failures.slice(0, 20)) console.error(`  ${f.repoFullName}: HTTP ${f.status}`);
    process.exit(1);
  }
  if (failures.length > 0) {
    log(`tolerated ${failures.length} casualties (deleted/private/DMCA): ${failures.slice(0, 5).map(f => f.repoFullName).join(', ')}${failures.length > 5 ? ', ...' : ''}`);
  }

  // Apply fresh fields IN-PLACE on every matching skill record.
  // Iterate TRACK1_FRESHNESS_FIELDS so this stays in sync with skill-fields.js.
  let updated = 0;
  for (const skill of skills) {
    const fresh = freshByRepo.get(skill.repo_full_name);
    if (!fresh) continue;
    for (const field of TRACK1_FRESHNESS_FIELDS) {
      if (fresh[field] !== undefined) {
        skill[field] = fresh[field];
      }
    }
    updated++;
  }
  log(`updated ${updated} skill records in memory (${TRACK1_FRESHNESS_FIELDS.length} fields each)`);

  // Write skills.json BEFORE history (so a history-write failure doesn't lose the freshness)
  // T5: streaming NDJSON write — V8-string-limit safe.
  writeNdjsonStreaming(SKILLS_PATH, skills);
  log(`wrote ${SKILLS_PATH}`);

  // Build snapshot map (use fresh fields where available, fall back to existing for is_fork)
  writeHistorySnapshot(skills);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  log(`=== Track 1 complete in ${elapsed}s ===`);
}

main().catch(err => { console.error('[pulse] fatal:', err); process.exit(1); });

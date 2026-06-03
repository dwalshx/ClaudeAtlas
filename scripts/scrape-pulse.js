#!/usr/bin/env node
/**
 * ClaudeAtlas Track 1 — Star Pulse
 *
 * Daily refresh of engagement signals on every repo in data/skills.json.
 * Hits GET /repos/{owner}/{name} per unique repo (ETag-supported, 304s free).
 * Updates in-place: all 11 TRACK1_FRESHNESS_FIELDS (stars, forks, open_issues,
 * pushed_at, updated_at, archived, topics, license, language, description,
 * default_branch). Does NOT touch content fields.
 *
 * Side effect: writes today's data/history/YYYY-MM-DD.json snapshot from the
 * fresh metadata (the moat-feeder).
 *
 * Inputs:  data/skills.json (current corpus), data/etag-cache.json
 * Outputs: data/skills.json (mutated in-place), data/history/YYYY-MM-DD.json
 * Cost:    ~826 requests today, fits in 5000/hr general API budget.
 * Resumable: No checkpoint — script is fast enough that failure = re-run from start.
 *            Tolerates partial failures (404/451) up to 10% of repos.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchWithETag, getETagCache, saveETagCache, sleep } from './lib/github-fetch.js';
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
  LOG_EVERY: 50,          // progress cadence
};

// Stopgap inter-request delay (RESEARCH §5). Stays well under the secondary
// 900-pts/min limit; ~7-8 min added at 4,351 repos — fine under the 330-min
// ceiling. NOTE: Task 2 replaces the REST loop with the GraphQL batch loop,
// which re-applies a smaller inter-BATCH delay instead.
const PULSE_DELAY_MS = 100;

function log(msg) { console.log(`[pulse] ${msg}`); }

// --- Refresh one repo ---

async function refreshRepo(repoFullName) {
  const url = `https://api.github.com/repos/${repoFullName}`;
  const { data, status, cached } = await fetchWithETag(url);
  if (!data) {
    // 404 (repo deleted), 451 (DMCA), 0 (network), or non-200
    return { ok: false, status: status ?? 0, repoFullName };
  }
  return {
    ok: true,
    cached: !!cached,
    repoFullName,
    fields: {
      repo_stars: data.stargazers_count || 0,
      repo_forks: data.forks_count || 0,
      repo_open_issues: data.open_issues_count || 0,
      repo_pushed_at: data.pushed_at,
      repo_updated_at: data.updated_at,
      repo_archived: data.archived || false,
      // C11: expanded fields — same response, zero extra cost
      repo_topics: data.topics || [],
      repo_license: data.license?.spdx_id || data.license?.key || null,
      repo_language: data.language || null,
      repo_description: data.description || null,
      repo_default_branch: data.default_branch || null,
    },
  };
}

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

  // Refresh each repo
  const freshByRepo = new Map();    // repoFullName -> { fields }
  const failures = [];              // { repoFullName, status }
  let cachedCount = 0;
  let processed = 0;

  for (const repoFullName of uniqueRepos) {
    processed++;
    const result = await refreshRepo(repoFullName);
    if (!result.ok) {
      failures.push({ repoFullName, status: result.status });
    } else {
      freshByRepo.set(repoFullName, result.fields);
      if (result.cached) cachedCount++;
    }
    if (processed % CONFIG.LOG_EVERY === 0) {
      log(`progress: ${processed}/${uniqueRepos.size} (${cachedCount} cached, ${failures.length} failed)`);
    }
    await sleep(PULSE_DELAY_MS);
  }

  // Persist ETag cache mid-run safety
  saveETagCache(getETagCache());
  log(`refresh done: ${freshByRepo.size}/${uniqueRepos.size} ok, ${failures.length} failed, ${cachedCount} from cache`);

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

  // Final ETag persist
  saveETagCache(getETagCache());

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  log(`=== Track 1 complete in ${elapsed}s ===`);
}

main().catch(err => { console.error('[pulse] fatal:', err); process.exit(1); });

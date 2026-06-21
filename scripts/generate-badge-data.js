#!/usr/bin/env node

/**
 * ClaudeAtlas Badge Star-History Bundle Generator (quick-260621-cvm)
 *
 * Build-time script (invoked via `prebuild`) that writes a compact,
 * pre-downsampled star-history map for the Worker badge route to bundle.
 *
 * Replaces the static-file generator (scripts/generate-badges.js, deleted):
 * instead of emitting ~18k SVG files into public/badge/, the Worker now
 * generates /badge/{slug}.svg and /badge/{slug}-history.svg per request.
 * Tier data already lives in SKILLS_KV; the only data the Worker lacks is
 * the per-repo star-history series — that's what this script bundles.
 *
 * Output:
 *   data/badge-star-history.json   — { "<repo_full_name>": [[tsMs, count], ...] }
 *
 * The series is PRE-DOWNSAMPLED here (≤~61 points/repo) using the SAME
 * normalize/sort/sample logic as buildStarHistoryChartSvg in worker/badge.js.
 * Feeding an already-≤60-point series back through that builder is idempotent,
 * so the Worker reproduces the byte-identical SVG the old static generator
 * wrote. (Verified by the diff harness in the migration's Task 3.)
 *
 * Reads:
 *   data/skills.ndjson         — curated catalog (streaming reader; required)
 *   data/star-history.json     — star-history backfill (optional)
 *   data/history/*.json        — daily snapshots (optional)
 *
 * The 9,218 featured/top/solid skills span only ~158 unique repos, so the
 * bundle is ~177 KB — a bounded sidecar (allowlisted in
 * scripts/check-banned-patterns.js).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readNdjsonRecords } from './lib/ndjson.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const HISTORY_DIR = join(DATA_DIR, 'history');
const SKILLS_NDJSON_PATH = join(DATA_DIR, 'skills.ndjson');
const STAR_HISTORY_PATH = join(DATA_DIR, 'star-history.json');
const OUTPUT_PATH = join(DATA_DIR, 'badge-star-history.json');

// Mirror generate-badges.js BADGE_TIERS — the only tiers that get badges.
const BADGE_TIERS = new Set(['featured', 'top', 'solid']);

function log(msg) {
  console.log(`[badge-data] ${msg}`);
}

// Ported VERBATIM from generate-badges.js:72-78 — keep the slug guard
// identical so this script scopes exactly the same skill set the old
// generator (and the Worker) treats as valid.
function validateSlug(slug) {
  if (!slug || typeof slug !== 'string') return false;
  if (slug.includes('..')) return false;
  if (slug.startsWith('/')) return false;
  if (slug.includes('\\')) return false;
  return true;
}

// --- History snapshot loader (ported VERBATIM from generate-badges.js:211-227) ---

function loadHistorySnapshotsForRepo(repoFullName) {
  if (!existsSync(HISTORY_DIR)) return [];
  const out = [];
  for (const file of readdirSync(HISTORY_DIR).sort()) {
    if (!file.endsWith('.json')) continue;
    try {
      const snap = JSON.parse(readFileSync(join(HISTORY_DIR, file), 'utf-8'));
      const entry = snap.repos?.[repoFullName];
      if (entry && typeof entry.s === 'number') {
        out.push({ t: snap.timestamp || new Date(snap.date + 'T00:00:00Z').toISOString(), c: entry.s });
      }
    } catch {
      // skip malformed snapshots
    }
  }
  return out;
}

// Normalize + downsample an {t, c} event series to ~60 points using the
// EXACT same parse/filter/sort/sample logic as buildStarHistoryChartSvg
// (generate-badges.js:149-174). Returns [[tsMs, count], ...].
//
// CRITICAL: this MUST reproduce the build-time sampling so the Worker's
// buildStarHistoryChartSvg (which re-runs the same downsample, idempotent on
// already-≤60-point input) yields byte-identical output.
function normalizeAndDownsample(events) {
  // Normalize to {t, c} where t is ms, c is star count (verbatim shape).
  const pts = events
    .map(e => {
      const t = Date.parse(e.t || e.timestamp || e.starred_at);
      const c = typeof e.c === 'number' ? e.c : (typeof e.star_count === 'number' ? e.star_count : null);
      return { t, c };
    })
    .filter(p => !isNaN(p.t) && p.c !== null)
    .sort((a, b) => a.t - b.t);

  // < 5 points renders the "Not enough history yet" placeholder in the
  // builder regardless of the series, so emit it as-is (the Worker's
  // builder short-circuits before downsampling). Keeping the raw pairs is
  // harmless and lets the Worker decide.
  // Downsample to ~60 points (verbatim from buildStarHistoryChartSvg).
  const TARGET = 60;
  let sampled = pts;
  if (pts.length > TARGET) {
    const step = pts.length / TARGET;
    sampled = [];
    for (let i = 0; i < TARGET; i++) {
      sampled.push(pts[Math.floor(i * step)]);
    }
    // Always include the last point
    if (sampled[sampled.length - 1] !== pts[pts.length - 1]) {
      sampled.push(pts[pts.length - 1]);
    }
  }

  return sampled.map(p => [p.t, p.c]);
}

function main() {
  log('=== badge star-history bundle generator start ===');

  // Load skills via the streaming NDJSON reader (NOT readFileSync on data/).
  const skillMap = readNdjsonRecords(SKILLS_NDJSON_PATH, { keyFn: (r) => r.slug });
  log(`loaded ${skillMap.size} skills from skills.ndjson`);

  // Collect the in-scope repo set: featured/top/solid skills with a valid slug.
  const inScopeRepos = new Set();
  for (const skill of skillMap.values()) {
    if (!validateSlug(skill.slug)) continue;
    if (!BADGE_TIERS.has(skill.quality_tier)) continue;
    if (skill.repo_full_name) inScopeRepos.add(skill.repo_full_name);
  }
  log(`${inScopeRepos.size} in-scope repos (featured/top/solid)`);

  // Optionally load the star-history backfill (bounded sidecar — allowlisted).
  let starHistory = null;
  if (existsSync(STAR_HISTORY_PATH)) {
    try {
      starHistory = JSON.parse(readFileSync(STAR_HISTORY_PATH, 'utf-8'));
      const repoCount = Object.keys(starHistory.repos || {}).length;
      log(`loaded star-history backfill for ${repoCount} repos`);
    } catch (err) {
      log(`WARN: could not parse ${STAR_HISTORY_PATH}: ${err.message}`);
      starHistory = null;
    }
  } else {
    log('no star-history.json found — relying on daily snapshots only');
  }

  // Build the per-repo merged + downsampled series, REUSING the exact merge
  // order from generate-badges.js:313-325 (backfill events first, then
  // chronological daily snapshots).
  const map = {};
  let withSeries = 0;
  for (const repo of inScopeRepos) {
    let events = [];
    if (starHistory && starHistory.repos && starHistory.repos[repo]) {
      const entry = starHistory.repos[repo];
      if (entry.events && Array.isArray(entry.events)) {
        events = entry.events;
      }
    }
    const snapshotEvents = loadHistorySnapshotsForRepo(repo);
    if (snapshotEvents.length > 0) {
      events = [...events, ...snapshotEvents];
    }

    const series = normalizeAndDownsample(events);
    map[repo] = series;
    if (series.length > 0) withSeries++;
  }

  log(`built series for ${Object.keys(map).length} repos (${withSeries} with ≥1 point)`);

  // Bounded sidecar (~177 KB at 158 repos × ≤61 pts) — safe to pretty-print.
  // Allowlisted in scripts/check-banned-patterns.js.
  writeFileSync(OUTPUT_PATH, JSON.stringify(map, null, 2), 'utf-8');
  log(`wrote ${OUTPUT_PATH}`);
  log('=== badge star-history bundle generator complete ===');
}

main();

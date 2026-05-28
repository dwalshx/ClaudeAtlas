#!/usr/bin/env node

/**
 * scripts/migrate-to-entities.js — one-shot v1 → v2 NDJSON migrator.
 *
 * Phase 3.1.2 (F2) — Polymorphic Entity Envelope, Task 9.
 *
 * Reads `data/skills.ndjson` (and `data/skills-raw.ndjson` if present),
 * upcasts every record to EntityRecord<SkillExtra> via
 * `scripts/lib/legacy-skill-reader.js::upcastRecord`, and writes a v2
 * NDJSON file with the canonical `_header` sentinel as line 1
 * (per F1 Rev 3's `writeNdjsonStreaming({ header })`).
 *
 * Atomic via `.tmp` + rename. Original v1 file kept as `.v1.bak` (30-day
 * retention; matches the rollback window documented in
 * `.planning/phases/03.1.2-polymorphic-envelope/3.1.2-CUTOVER.md`).
 *
 * Usage:
 *   node scripts/migrate-to-entities.js --dry-run
 *   node scripts/migrate-to-entities.js                  # commits in place
 *   node scripts/migrate-to-entities.js --only skills    # skip skills-raw
 *
 * Lifecycle: deleted in the D+7 cutover commit (one-shot — done once).
 *
 * Note on production cutover (F2 ordering, B6):
 *   For a brownfield runner (existing data/skills.ndjson on disk in v1
 *   shape) this script performs the in-place migration. In ClaudeAtlas's
 *   actual operational flow, however, `data/skills.ndjson` is gitignored
 *   and produced fresh by the daily-scrape's Filter step from
 *   skills-raw.ndjson + the published `skills-latest` release asset.
 *   The first post-merge daily-scrape (with F2 code on main) will
 *   therefore produce v2 records natively — no separate migration run
 *   is required to flip production. See 3.1.2-CUTOVER.md for the
 *   post-merge schedule.
 *
 *   This script remains useful for:
 *     - Local-dev runners that retain a v1 on-disk copy
 *     - Manual migration of release-asset snapshots prior to upload
 *     - The T9 verification flow (dry-run shows the upcaster operates
 *       end-to-end against the real on-disk dataset)
 */

import { existsSync, openSync, readSync, closeSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeNdjsonStreaming } from './lib/ndjson.js';
import { upcastRecord } from './lib/legacy-skill-reader.js';
import { buildHeader, isHeaderRecord, CURRENT_SCHEMA_VERSION } from './lib/entity-version.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const READ_CHUNK = 64 * 1024;

const TARGETS = [
  { path: join(ROOT, 'data', 'skills.ndjson'),     label: 'skills'     },
  { path: join(ROOT, 'data', 'skills-raw.ndjson'), label: 'skills-raw' },
];

function parseArgs(argv) {
  const args = { dryRun: false, only: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '-n') args.dryRun = true;
    else if (a === '--only') args.only = argv[++i];
    else if (a.startsWith('--only=')) args.only = a.slice('--only='.length);
  }
  return args;
}

/**
 * Stream an NDJSON file line-by-line via chunked readSync (V8-string-limit
 * safe — same primitive as scripts/lib/ndjson.js but yielding raw records,
 * including any leading `_header`). Generator form keeps memory bounded.
 *
 * @param {string} path
 * @returns {Generator<any>}
 */
function* iterRecords(path) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(READ_CHUNK);
    let leftover = '';
    let pos = 0;
    while (true) {
      const n = readSync(fd, buf, 0, READ_CHUNK, pos);
      if (n === 0) break;
      pos += n;
      const text = leftover + buf.slice(0, n).toString('utf-8');
      const lines = text.split('\n');
      leftover = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        try { yield JSON.parse(line); } catch { /* skip malformed */ }
      }
    }
    if (leftover) {
      try { yield JSON.parse(leftover); } catch { /* skip */ }
    }
  } finally {
    closeSync(fd);
  }
}

function classifyHeader(path) {
  if (!existsSync(path)) return { exists: false };
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(1024);
    const n = readSync(fd, buf, 0, 1024, 0);
    const firstLine = buf.slice(0, n).toString('utf-8').split('\n')[0];
    let parsed = null;
    try { parsed = JSON.parse(firstLine); } catch { /* not JSON */ }
    return {
      exists: true,
      hasHeader: Boolean(parsed && parsed._header === true),
      schemaVersion: parsed && parsed._header === true ? parsed.schema_version : null,
    };
  } finally {
    closeSync(fd);
  }
}

function summarizeTags(record, counts) {
  if (!Array.isArray(record.tags)) return;
  for (const t of record.tags) {
    if (typeof t !== 'string') continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
}

function migrateOne({ path, label }, { dryRun }) {
  const status = classifyHeader(path);
  if (!status.exists) {
    console.log(`[migrate] ${label}: SKIP (not present at ${path})`);
    return { label, skipped: true };
  }
  if (status.hasHeader && status.schemaVersion === CURRENT_SCHEMA_VERSION) {
    console.log(`[migrate] ${label}: SKIP (already v${CURRENT_SCHEMA_VERSION}, header present)`);
    return { label, alreadyV2: true };
  }
  if (status.hasHeader && status.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `[migrate] ${label}: header present but schema_version=${status.schemaVersion} ` +
      `(expected ${CURRENT_SCHEMA_VERSION}). Refusing to overwrite — manual review required.`
    );
  }

  console.log(`[migrate] ${label}: scanning v1 NDJSON at ${path}`);
  const tagCounts = new Map();
  let total = 0;
  let upcasted = 0;
  let headers = 0;

  // First pass: stats only (cheap; generator yields, no materialization).
  for (const rec of iterRecords(path)) {
    if (isHeaderRecord(rec)) { headers++; continue; }
    total++;
    const v2 = upcastRecord(rec);
    summarizeTags(v2, tagCounts);
    if (rec.schema_version !== CURRENT_SCHEMA_VERSION) upcasted++;
  }

  console.log(`[migrate] ${label}: ${total} records, ${upcasted} to upcast, ${headers} stray header lines`);
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  console.log(`[migrate] ${label}: top tags after upcast:`);
  for (const [tag, count] of topTags) {
    console.log(`  ${tag}: ${count}`);
  }

  if (dryRun) {
    console.log(`[migrate] ${label}: DRY-RUN — Would upcast ${upcasted} records and write v${CURRENT_SCHEMA_VERSION} header`);
    return { label, total, upcasted, dryRun: true };
  }

  // Second pass: write v2 via writeNdjsonStreaming with canonical header.
  // Generator form keeps memory bounded; writer's tmp+rename gives atomicity.
  function* v2Records() {
    for (const rec of iterRecords(path)) {
      if (isHeaderRecord(rec)) continue;
      yield upcastRecord(rec);
    }
  }

  const bakPath = path + '.v1.bak';
  console.log(`[migrate] ${label}: writing v${CURRENT_SCHEMA_VERSION} NDJSON via streaming writer`);
  // writeNdjsonStreaming writes to <path>.tmp then atomic-renames to <path>.
  // We want to preserve the v1 file as .v1.bak first, so: pre-rename v1 → bak,
  // then call writer which renames .tmp → path. If the writer fails, the bak
  // remains and the operator can restore manually.
  renameSync(path, bakPath);
  console.log(`[migrate] ${label}: preserved v1 as ${bakPath}`);
  try {
    writeNdjsonStreaming(path, v2Records(), {
      header: buildHeader(label === 'skills-raw' ? null : 'skill'),
    });
  } catch (err) {
    // Restore on failure — leave the original v1 file intact.
    try { renameSync(bakPath, path); } catch { /* leave bak in place */ }
    throw err;
  }
  console.log(`[migrate] ${label}: DONE (wrote v${CURRENT_SCHEMA_VERSION} to ${path})`);
  return { label, total, upcasted, written: true, bak: bakPath };
}

function main() {
  const args = parseArgs(process.argv);
  console.log(`[migrate] mode=${args.dryRun ? 'dry-run' : 'live'} only=${args.only ?? 'all'}`);
  const targets = args.only
    ? TARGETS.filter((t) => t.label === args.only)
    : TARGETS;
  if (targets.length === 0) {
    console.error(`[migrate] --only=${args.only} matched no targets (valid: ${TARGETS.map((t) => t.label).join(', ')})`);
    process.exit(2);
  }
  const results = [];
  for (const t of targets) results.push(migrateOne(t, args));
  console.log(`[migrate] complete — ${results.length} target(s) processed`);
  return results;
}

const invokedAsScript = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (invokedAsScript) {
  try {
    main();
  } catch (err) {
    console.error(`[migrate] FATAL: ${err.stack || err.message}`);
    process.exit(1);
  }
}

export { migrateOne, iterRecords, classifyHeader };

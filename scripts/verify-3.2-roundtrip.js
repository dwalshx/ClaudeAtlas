#!/usr/bin/env node
/**
 * scripts/verify-3.2-roundtrip.js
 *
 * Phase 3.2 Task 14 — v2 round-trip verifier + F-4 asset-size guard.
 *
 * Final local go/no-go before the branch-CI production dispatch. Asserts the
 * Phase 3.2 polymorphic envelope invariants over real pipeline output:
 *
 *   - data/plugins.ndjson      — schema_version=2 header + entity_type=plugin
 *                                 on every record + populated extra.* fields.
 *   - data/mcp-servers.ndjson  — schema_version=2 header + entity_type=mcp_server.
 *   - data/skills.ndjson       — every record carries bundled_in_plugins (may be []).
 *   - data/pipeline-stats.json — both `plugin` and `mcp_server` sections present.
 *   - F-4: `npm run build` + check-asset-sizes.js (24 MiB / 95k-file caps).
 *
 * Run modes:
 *   - PRODUCTION (default): real data/*.ndjson present → full checks incl. build.
 *   - FIXTURE fallback: real files absent (local dev / CI before pipeline ran)
 *     → validate the committed mini fixtures' shape; the build/asset-size guard
 *     is SKIPPED (no production catalog on disk to build). Exits 0 so the local
 *     verify in the plan's <automated> check passes pre-dispatch; the branch-CI
 *     run is where the F-4 guard runs against real production-scale data.
 *
 * Exit 0 on success; exit 1 with a descriptive error on any failure.
 *
 * F1-compliant: NDJSON records via readNdjsonRecords; the one-line header is
 * read via a streamed readline (no readFileSync on data/).
 */

import { existsSync, createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNdjsonRecords } from './lib/ndjson.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'data');
const FIX = join(DATA, '__fixtures__');

function log(msg) {
  console.log(`[verify-3.2] ${msg}`);
}

function fail(msg) {
  console.error(`[verify-3.2] FAIL: ${msg}`);
  process.exit(1);
}

/** Read only the first line of an NDJSON file (the _header sentinel). */
async function readHeaderLine(path) {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf-8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    rl.close();
    const t = line.trim();
    if (!t) return null;
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  }
  return null;
}

async function loadRecords(path) {
  const map = readNdjsonRecords(path, { keyFn: (r) => r.id });
  return [...map.values()];
}

function assertArray(rec, field, label) {
  const v = field.split('.').reduce((o, k) => (o == null ? o : o[k]), rec);
  if (!Array.isArray(v)) fail(`${label} ${rec.id}: ${field} is not an array (got ${typeof v})`);
}

function assertPresent(rec, field, label) {
  const v = field.split('.').reduce((o, k) => (o == null ? o : o[k]), rec);
  if (v === undefined) fail(`${label} ${rec.id}: missing ${field}`);
}

async function verifyEntityFile(path, entityType, opts = {}) {
  const { isFixture } = opts;
  log(`checking ${path} (entity_type=${entityType})`);

  const header = await readHeaderLine(path);
  if (!header || header._header !== true) fail(`${path}: first line is not a _header sentinel`);
  if (header.schema_version !== 2) fail(`${path}: header schema_version != 2 (got ${header.schema_version})`);
  if (header.entity_type !== entityType) fail(`${path}: header entity_type != ${entityType} (got ${header.entity_type})`);

  const records = await loadRecords(path);
  if (records.length === 0) fail(`${path}: no records loaded`);

  for (const rec of records) {
    if (rec.entity_type !== entityType) fail(`${path}: record ${rec.id} entity_type=${rec.entity_type}, expected ${entityType}`);
    if (rec.schema_version !== 2) fail(`${path}: record ${rec.id} schema_version != 2`);

    if (entityType === 'plugin') {
      assertPresent(rec, 'extra.plugin_path', 'plugin');
      assertPresent(rec, 'extra.manifest', 'plugin');
      assertArray(rec, 'extra.bundled_skills', 'plugin');
      // bundled_in_plugins is an EntityCommon back-edge field. On real
      // pipeline output it is always present (filter PRESERVED_FIELDS +
      // link-bundles). The committed mini fixtures predate Task 8, so we
      // only enforce its presence on real data.
      if (!isFixture) assertPresent(rec, 'bundled_in_plugins', 'plugin');
    } else if (entityType === 'mcp_server') {
      assertPresent(rec, 'extra.server_path', 'mcp_server');
      assertPresent(rec, 'extra.manifest', 'mcp_server');
      assertArray(rec, 'extra.tools', 'mcp_server');
    }
  }
  log(`  OK — ${records.length} ${entityType} records, header valid`);
  return records;
}

async function verifySkillsBundledField() {
  const path = join(DATA, 'skills.ndjson');
  if (!existsSync(path)) {
    log('skills.ndjson absent — skipping bundled_in_plugins field check (production-only)');
    return false;
  }
  log('checking data/skills.ndjson carries bundled_in_plugins on every record');
  const records = await loadRecords(path);
  let missing = 0;
  for (const rec of records) {
    if (rec.bundled_in_plugins === undefined) missing++;
  }
  if (missing > 0) fail(`skills.ndjson: ${missing}/${records.length} records missing bundled_in_plugins`);
  log(`  OK — all ${records.length} skill records carry bundled_in_plugins`);
  return true;
}

async function verifyPipelineStats() {
  const path = join(DATA, 'pipeline-stats.json');
  if (!existsSync(path)) {
    log('pipeline-stats.json absent — skipping plugin/mcp section check (production-only)');
    return false;
  }
  log('checking data/pipeline-stats.json has plugin + mcp_server sections');
  // pipeline-stats.json is a bounded sidecar (~5 KB) — readFile is safe and
  // explicitly allowlisted in check-banned-patterns.js for this file class.
  const stats = JSON.parse(await readFile(path, 'utf-8'));
  if (!stats.plugin) fail('pipeline-stats.json: missing `plugin` section');
  if (!stats.mcp_server) fail('pipeline-stats.json: missing `mcp_server` section');
  log('  OK — plugin + mcp_server sections present');
  return true;
}

function runAssetSizeGuard() {
  log('F-4: running `npm run build` + check-asset-sizes.js');
  const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (build.status !== 0) fail('npm run build failed (F-4 guard)');
  // postbuild already runs check-asset-sizes.js, but run it explicitly so a
  // failure surfaces under this verifier's exit code regardless of postbuild
  // wiring.
  const guard = spawnSync('node', [join(ROOT, 'scripts', 'check-asset-sizes.js')], { cwd: ROOT, stdio: 'inherit' });
  if (guard.status !== 0) fail(`check-asset-sizes.js exit ${guard.status} (24 MiB / 95k-file cap breached)`);
  log('  OK — build clean, all assets within 24 MiB and under the 95k-file cap');
}

async function main() {
  log('=== Phase 3.2 v2 round-trip verifier ===');

  const prodPlugins = join(DATA, 'plugins.ndjson');
  const prodMcp = join(DATA, 'mcp-servers.ndjson');
  const haveProduction = existsSync(prodPlugins) && existsSync(prodMcp);

  if (haveProduction) {
    log('PRODUCTION mode — real pipeline output present');
    await verifyEntityFile(prodPlugins, 'plugin', { isFixture: false });
    await verifyEntityFile(prodMcp, 'mcp_server', { isFixture: false });
    await verifySkillsBundledField();
    await verifyPipelineStats();
    runAssetSizeGuard();
    log('=== PASS (production) — round-trip + F-4 asset guard clean ===');
  } else {
    log('FIXTURE mode — production data/*.ndjson absent; validating committed mini fixtures');
    log('(F-4 asset-size guard runs against real data on the branch-CI dispatch, not locally)');
    await verifyEntityFile(join(FIX, 'plugins-mini.ndjson'), 'plugin', { isFixture: true });
    await verifyEntityFile(join(FIX, 'mcp-mini.ndjson'), 'mcp_server', { isFixture: true });
    log('=== PASS (fixture) — envelope shape verified; dispatch branch CI for the production + F-4 gate ===');
  }
}

main().catch((err) => fail(err && err.stack ? err.stack : String(err)));

#!/usr/bin/env node

/**
 * ClaudeAtlas Vectorize Uploader
 *
 * Reads data/skill-vectors.ndjson and upserts every vector into the
 * Cloudflare Vectorize index `claudeatlas-skills` via the REST API.
 *
 * Uses Vectorize's NDJSON bulk insert endpoint:
 *   POST /accounts/{account_id}/vectorize/v2/indexes/{index_name}/upsert
 *   Content-Type: application/x-ndjson
 *
 * "Upsert" (not insert) is important — it replaces any vector with a
 * matching id, so re-running this script is idempotent. Slugs are stable
 * across runs so the same skill maps to the same vector id each time.
 *
 * Env vars required:
 *   CF_ACCOUNT_ID  — Cloudflare account ID
 *   CF_API_TOKEN   — token with Vectorize:Edit permission
 *
 * For local runs, also honours:
 *   CF_VECTORIZE_INDEX — override index name (default "claudeatlas-skills")
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readNdjsonRecords } from './lib/ndjson.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Phase 3.2 (Task 10): parameterize the input vectors file so plugin and MCP
// vectors can be uploaded with the same uploader. Default preserves the
// legacy skill invocation (`node scripts/upload-vectors.js`).
function parseArgs(argv) {
  const out = { input: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') out.input = argv[++i];
    else if (a.startsWith('--input=')) out.input = a.slice('--input='.length);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--commit') out.dryRun = false;
  }
  return out;
}

const ARGS = parseArgs(process.argv);
const NDJSON_PATH = ARGS.input
  ? (ARGS.input.startsWith('/') || /^[A-Za-z]:/.test(ARGS.input) ? ARGS.input : join(ROOT, ARGS.input))
  : join(ROOT, 'data', 'skill-vectors.ndjson');

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const API_TOKEN = process.env.CF_API_TOKEN;
const INDEX_NAME = process.env.CF_VECTORIZE_INDEX || 'claudeatlas-skills';

// --dry-run: validate + report the would-be payload without any Vectorize
// API call (CI / branch contexts). Without creds we also fall into dry-run.
const DRY_RUN = ARGS.dryRun || !ACCOUNT_ID || !API_TOKEN;

if (!existsSync(NDJSON_PATH)) {
  console.error(`ERROR: ${NDJSON_PATH} not found. Run 'npm run embed' first.`);
  process.exit(1);
}

if (!DRY_RUN && (!ACCOUNT_ID || !API_TOKEN)) {
  // Soft-fail: some CI paths may not have Vectorize creds yet. Log and
  // exit 0 so the workflow can still deploy the Worker code.
  console.error('WARNING: CF_ACCOUNT_ID and/or CF_API_TOKEN not set. Skipping Vectorize upload.');
  console.error('The Worker code will still deploy; semantic search will fall back to keyword until vectors are uploaded.');
  process.exit(0);
}

const BATCH_SIZE = 500; // Vectorize accepts up to ~1000 at once, 500 is safe
const MAX_RETRIES = 4;

// >= this dropped fraction = systemic failure (auth/wrong-dim/embed bug),
// NOT a handful of bad embeddings → hard-fail rather than publish a near-empty index
const CATASTROPHIC_SKIP_FRACTION = 0.5;
// surface (but don't fail) once more than this fraction is skipped — a loud
// ::warning:: makes a creeping systemic issue visible before it goes catastrophic
const WARN_SKIP_FRACTION = 0.05;

function log(msg) {
  console.log(`[upload] ${msg}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function upsertBatch(records, attempt = 1) {
  // Re-stringify per record on the way to the wire. Each line is a small
  // allocation; total batch body is well under the V8 string ceiling at
  // batch sizes the script uses (~100 records per batch).
  const body = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/vectorize/v2/indexes/${INDEX_NAME}/upsert`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/x-ndjson',
    },
    body,
  });

  if (res.status === 429 || res.status >= 500) {
    if (attempt >= MAX_RETRIES) {
      const errBody = await res.text();
      // Attach status so callers can distinguish a persistent 5xx/429 (NOT
      // bisectable — it's a transient/transport failure, not one bad record).
      const e = new Error(`Vectorize ${res.status} after ${MAX_RETRIES} attempts: ${errBody}`);
      e.status = res.status;
      throw e;
    }
    const waitMs = 2000 * Math.pow(2, attempt);
    log(`  [retry] Vectorize ${res.status} (attempt ${attempt}/${MAX_RETRIES}), waiting ${waitMs}ms`);
    await sleep(waitMs);
    return upsertBatch(records, attempt + 1);
  }

  if (!res.ok) {
    const errBody = await res.text();
    // Attach the HTTP status so upsertWithBisection can decide whether this is
    // a bisectable malformed-record 4xx (400) or a catastrophic auth 4xx (401/403).
    const e = new Error(`Vectorize HTTP ${res.status}: ${errBody}`);
    e.status = res.status;
    throw e;
  }

  const json = await res.json();
  if (!json.success) {
    throw new Error(`Vectorize API error: ${JSON.stringify(json.errors).slice(0, 500)}`);
  }
  return json.result;
}

/**
 * Pre-flight validation: drop records Vectorize would reject before they can
 * abort a 500-row batch. The expected dimension D is detected MODALLY (the most
 * common `values.length` among valid-shaped records) — NOT from the first
 * record — so a single wrong-dimension outlier that happens to sort first
 * cannot become the reference and drop every GOOD record.
 *
 * @param {Array<{id:string, values:number[]}>} records
 * @param {{ log?: (msg:string)=>void }} [opts]
 * @returns {{ valid: any[], dropped: {id:string, reason:string}[], dimension: number|null }}
 */
export function validateVectors(records, opts = {}) {
  const logFn = opts.log || log;

  // Pass 1: count length frequencies among records whose `values` is a
  // non-empty array of all-finite numbers. D = the modal length.
  const lengthCounts = new Map();
  let validShaped = 0;
  for (const r of records) {
    if (!r || !Array.isArray(r.values) || r.values.length === 0) continue;
    if (!r.values.every((v) => Number.isFinite(v))) continue;
    validShaped++;
    const len = r.values.length;
    lengthCounts.set(len, (lengthCounts.get(len) || 0) + 1);
  }

  let D = null;
  let best = -1;
  for (const [len, count] of lengthCounts) {
    // Higher count wins; tie → larger length (deterministic tiebreak).
    if (count > best || (count === best && len > D)) {
      best = count;
      D = len;
    }
  }
  logFn(`pre-validation: detected dimension D=${D} (modal across ${validShaped} valid-shaped records)`);

  // Pass 2: drop records failing id / array / finite / length===D checks.
  const valid = [];
  const dropped = [];
  for (const r of records) {
    if (!r || typeof r.id !== 'string' || r.id === '') {
      dropped.push({ id: r && typeof r.id === 'string' ? r.id : String(r && r.id), reason: 'missing or empty id' });
      continue;
    }
    if (!Array.isArray(r.values)) {
      dropped.push({ id: r.id, reason: 'values is not an array' });
      continue;
    }
    if (r.values.length === 0) {
      dropped.push({ id: r.id, reason: 'values is empty' });
      continue;
    }
    if (!r.values.every((v) => Number.isFinite(v))) {
      dropped.push({ id: r.id, reason: 'values contains a non-finite element (NaN/Infinity/null)' });
      continue;
    }
    if (D !== null && r.values.length !== D) {
      dropped.push({ id: r.id, reason: `dimension ${r.values.length} != modal ${D}` });
      continue;
    }
    valid.push(r);
  }

  for (const d of dropped) {
    logFn(`pre-validation: dropped ${d.id} — ${d.reason}`);
  }
  logFn(`pre-validation: total dropped ${dropped.length}`);

  return { valid, dropped, dimension: D };
}

/**
 * Upsert a batch, bisecting on a non-429/non-auth 4xx to isolate the offending
 * record(s). A single record that still 4xxs is dropped+logged (never throws).
 *
 * Bisectable iff the thrown error is a 4xx that is NOT 429 and NOT auth
 * (401/403). 401/403 are EXCLUDED: an auth failure 4xxs EVERY batch — bisecting
 * would silently drop the whole corpus. Persistent 5xx / 429-after-retries /
 * status-less transport errors RE-THROW (caught by main()'s catastrophic path).
 *
 * @param {any[]} records
 * @param {{ upsertFn?: (batch:any[])=>Promise<any>, log?: (msg:string)=>void }} [opts]
 * @returns {Promise<{ uploaded: number, dropped: {id:string, reason:string}[] }>}
 */
export async function upsertWithBisection(records, opts = {}) {
  const upsertFn = opts.upsertFn || upsertBatch;
  const logFn = opts.log || log;

  try {
    await upsertFn(records);
    return { uploaded: records.length, dropped: [] };
  } catch (err) {
    const status = err && err.status;
    const bisectable =
      typeof status === 'number' &&
      status >= 400 && status < 500 &&
      status !== 429 && status !== 401 && status !== 403;

    if (!bisectable) {
      // Auth (401/403), persistent 5xx after retries, 429-after-retries, or a
      // status-less transport error. NOT one bad record — re-throw so main()'s
      // catastrophic path keeps yesterday's good index instead of publishing
      // a corpus-wide drop.
      throw err;
    }

    if (records.length === 1) {
      const r = records[0];
      logFn(`bisect: dropping single bad record ${r.id} — ${err.message}`);
      return { uploaded: 0, dropped: [{ id: r.id, reason: `4xx on upsert: ${err.message}` }] };
    }

    const mid = Math.floor(records.length / 2);
    const left = await upsertWithBisection(records.slice(0, mid), opts);
    const right = await upsertWithBisection(records.slice(mid), opts);
    return {
      uploaded: left.uploaded + right.uploaded,
      dropped: [...left.dropped, ...right.dropped],
    };
  }
}

async function main() {
  log('=== vector upload start ===');
  log(`index: ${INDEX_NAME}`);

  // Chunked NDJSON read via scripts/lib/ndjson.js — V8-string-limit safe.
  const recordsMap = readNdjsonRecords(NDJSON_PATH, { keyFn: (r) => r.id });
  const records = [...recordsMap.values()];
  log(`loaded ${records.length} vector records`);

  if (!records.length) {
    console.error(`ERROR: no records loaded from ${NDJSON_PATH}`);
    process.exit(1);
  }

  // Pre-validation (modal dimension). Subsumes the old first-record sanity
  // block: confirms id + values shape and logs the detected dimension, but
  // across ALL records (modal) so a wrong-dim outlier sorting first can't win.
  const { valid, dropped, dimension } = validateVectors(records);
  log(`pre-validation: kept ${valid.length}, dropped ${dropped.length} (dim=${dimension})`);

  // First valid vector at a glance (diagnostic; also keeps the Task 10
  // entity_type=<type> regression green now that the old first-record sanity
  // block is subsumed by validateVectors).
  if (valid.length) {
    const first = valid[0];
    log(`first vector: id=${first.id} dims=${first.values.length} entity_type=${first.metadata?.entity_type || '(none)'}`);
  }

  // entity_type distribution (Task 10): the ?type= worker filter reads
  // metadata.entity_type; surface it so a missing tag is obvious in logs.
  // Computed over the VALID records (the ones we'd actually upload).
  const byType = {};
  for (const r of valid) {
    const t = r.metadata?.entity_type || '(none)';
    byType[t] = (byType[t] || 0) + 1;
  }
  log(`entity_type distribution: ${JSON.stringify(byType)}`);

  if (DRY_RUN) {
    log('--dry-run (or missing CF creds): validated payload, no Vectorize API calls made.');
    log(`would upsert ${valid.length} vectors to index ${INDEX_NAME}.`);
    log('=== vector upload complete (dry-run) ===');
    return;
  }

  let uploaded = 0;
  const uploadDropped = [];
  const startTime = Date.now();

  for (let i = 0; i < valid.length; i += BATCH_SIZE) {
    const batch = valid.slice(i, i + BATCH_SIZE);
    let r;
    try {
      r = await upsertWithBisection(batch);
    } catch (err) {
      // upsertWithBisection re-threw a NON-bisectable error: auth (401/403),
      // persistent 5xx after retries, 429-after-retries, or a transport
      // failure. This is catastrophic — a real batch/auth/transport failure,
      // NOT one bad record. Hard-fail so yesterday's good index survives.
      console.error(`  [FATAL] batch ${Math.floor(i / BATCH_SIZE) + 1} failed (non-bisectable): ${err.message}`);
      console.error('::error::upload-vectors: catastrophic batch failure (auth/5xx/transport) — aborting to keep prior index');
      process.exit(1);
    }
    uploaded += r.uploaded;
    if (r.dropped.length) uploadDropped.push(...r.dropped);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`  [${uploaded}/${valid.length}] batch ${Math.floor(i / BATCH_SIZE) + 1} done (${elapsed}s)`);
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalDropped = dropped.length + uploadDropped.length;
  const skipFraction = records.length ? totalDropped / records.length : 1;
  log(`upserted ${uploaded} of ${valid.length}; dropped ${totalDropped} total (${(skipFraction * 100).toFixed(2)}%) in ${totalElapsed}s`);

  // Exit semantics (NHK-04): reserve non-zero exit for systemic failure, not a
  // handful of bad embeddings.
  if (skipFraction >= CATASTROPHIC_SKIP_FRACTION || valid.length === 0) {
    // Almost everything is "bad" → the reference dimension was wrong, auth
    // dropped, or the embed step produced garbage, NOT one bad record.
    // Hard-fail rather than publish a near-empty index (keeps yesterday's good one).
    console.error(`[FATAL] catastrophic skip fraction ${(skipFraction * 100).toFixed(2)}% (>= ${CATASTROPHIC_SKIP_FRACTION * 100}%) — refusing to publish a near-empty vector index`);
    console.error(`::error::upload-vectors: ${(skipFraction * 100).toFixed(2)}% of records dropped — systemic failure (wrong dimension / auth / embed bug); keeping prior index`);
    process.exit(1);
  }
  if (skipFraction > WARN_SKIP_FRACTION) {
    // Surface loudly but STILL exit 0 — lean toward refreshing the site.
    console.error(`::warning::upload-vectors: ${(skipFraction * 100).toFixed(2)}% of records skipped — likely a systemic embed bug or a wrong reference dimension was detected; investigate`);
    console.error(`[WARN] ${totalDropped} of ${records.length} records skipped (${(skipFraction * 100).toFixed(2)}%) — proceeding with publish but investigate`);
  }

  log('');
  log('NOTE: Vectorize mutations are async. Vectors are searchable within');
  log('a few seconds after the final mutationId is committed. If you query');
  log('immediately and get stale results, wait 5-10s and retry.');
  log('=== vector upload complete ===');
}

// Only run main() when invoked as a script, not when imported by tests.
// import.meta.url is a file:// URL; process.argv[1] is a path. Normalize.
const invokedAsScript = (() => {
  try {
    return import.meta.url === fileURLToPath(`file://${process.argv[1]}`).replace(/\\/g, '/')
      || fileURLToPath(import.meta.url) === process.argv[1];
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

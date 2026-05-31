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
      throw new Error(`Vectorize ${res.status} after ${MAX_RETRIES} attempts: ${errBody}`);
    }
    const waitMs = 2000 * Math.pow(2, attempt);
    log(`  [retry] Vectorize ${res.status} (attempt ${attempt}/${MAX_RETRIES}), waiting ${waitMs}ms`);
    await sleep(waitMs);
    return upsertBatch(records, attempt + 1);
  }

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Vectorize HTTP ${res.status}: ${errBody}`);
  }

  const json = await res.json();
  if (!json.success) {
    throw new Error(`Vectorize API error: ${JSON.stringify(json.errors).slice(0, 500)}`);
  }
  return json.result;
}

async function main() {
  log('=== vector upload start ===');
  log(`index: ${INDEX_NAME}`);

  // Chunked NDJSON read via scripts/lib/ndjson.js — V8-string-limit safe.
  const recordsMap = readNdjsonRecords(NDJSON_PATH, { keyFn: (r) => r.id });
  const records = [...recordsMap.values()];
  log(`loaded ${records.length} vector records`);

  // Quick sanity: confirm first record's shape
  if (!records.length) {
    console.error(`ERROR: no records loaded from ${NDJSON_PATH}`);
    process.exit(1);
  }
  const first = records[0];
  if (!first.id || !Array.isArray(first.values)) {
    console.error('ERROR: first record missing id or values');
    process.exit(1);
  }
  log(`first vector: id=${first.id} dims=${first.values.length} entity_type=${first.metadata?.entity_type || '(none)'}`);

  // entity_type distribution (Task 10): the ?type= worker filter reads
  // metadata.entity_type; surface it so a missing tag is obvious in logs.
  const byType = {};
  for (const r of records) {
    const t = r.metadata?.entity_type || '(none)';
    byType[t] = (byType[t] || 0) + 1;
  }
  log(`entity_type distribution: ${JSON.stringify(byType)}`);

  if (DRY_RUN) {
    log('--dry-run (or missing CF creds): validated payload, no Vectorize API calls made.');
    log(`would upsert ${records.length} vectors to index ${INDEX_NAME}.`);
    log('=== vector upload complete (dry-run) ===');
    return;
  }

  let uploaded = 0;
  const startTime = Date.now();

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    try {
      const result = await upsertBatch(batch);
      uploaded += batch.length;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      log(`  [${uploaded}/${records.length}] batch ${Math.floor(i / BATCH_SIZE) + 1} upserted (${elapsed}s)`);
      if (result && result.mutationId) {
        log(`    mutationId: ${result.mutationId}`);
      }
    } catch (err) {
      console.error(`  [FATAL] batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${err.message}`);
      process.exit(1);
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`upserted ${uploaded} of ${records.length} vectors in ${totalElapsed}s`);
  log('');
  log('NOTE: Vectorize mutations are async. Vectors are searchable within');
  log('a few seconds after the final mutationId is committed. If you query');
  log('immediately and get stale results, wait 5-10s and retry.');
  log('=== vector upload complete ===');
}

main().catch(err => {
  console.error(`FATAL: ${err.stack || err.message}`);
  process.exit(1);
});

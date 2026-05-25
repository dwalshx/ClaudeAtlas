#!/usr/bin/env node
/**
 * Publishes per-slug skill records to Workers KV (Phase 03.1.1 T5d).
 *
 * Streams data/skills.ndjson line-by-line via the chunked reader, computes
 * a content_sha per record, compares against data/kv-published.json (a
 * small slug→sha sidecar tracking what's already in KV), and upserts ONLY
 * the changed records via Cloudflare KV's bulk write API (10,000 keys
 * per request).
 *
 * Why a sidecar instead of querying KV for current state: KV reads are
 * free but slow at scale (one HTTP per slug). The local sidecar lets us
 * compute the delta in-process and only network-call for changed records.
 *
 * KV_PUBLISH_BUDGET env (default 10000) caps writes per invocation —
 * keeps us within the free-tier 1k-writes/day cap during the first
 * bootstrap (~10 days at 10k/run is conservative; shard across 5 days
 * once production traffic settles). After the corpus stabilizes, daily
 * incremental writes are tiny.
 *
 * Env required:
 *   CF_API_TOKEN              — Cloudflare API token with KV write scope
 *   CF_ACCOUNT_ID             — Cloudflare account ID
 *   SKILLS_KV_NAMESPACE_ID    — namespace ID (matches wrangler.toml binding)
 *   KV_PUBLISH_BUDGET (opt)   — max writes this run; default 10000
 *
 * Usage:
 *   node scripts/lib/publish-kv.js  (or `npm run publish:kv`)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNdjsonRecords } from './ndjson.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SKILLS_NDJSON_PATH = join(REPO_ROOT, 'data', 'skills.ndjson');
const SIDECAR_PATH = join(REPO_ROOT, 'data', 'kv-published.json');

const BUDGET_DEFAULT = 10000;
const BULK_BATCH_SIZE = 10000;

function log(msg) {
  console.log(`[publish:kv] ${msg}`);
}

function computeContentSha(record) {
  // Hash only the fields that affect the rendered page. Excludes fields that
  // change daily (repo_stars, repo_pushed_at) — those would invalidate every
  // skill's KV entry every day. Listed-tier pages don't surface real-time
  // stars anyway; they show whatever's in the latest filter output.
  const payload = JSON.stringify({
    id: record.id,
    slug: record.slug,
    name: record.name,
    description: record.description || '',
    repo_full_name: record.repo_full_name,
    repo_url: record.repo_url,
    quality_tier: record.quality_tier,
    quality_score: record.quality_score,
    category: record.category,
    body_markdown: record.body_markdown || '',
  });
  return createHash('sha256').update(payload).digest('hex');
}

function loadSidecar() {
  if (!existsSync(SIDECAR_PATH)) return {};
  try {
    return JSON.parse(readFileSync(SIDECAR_PATH, 'utf-8'));
  } catch (err) {
    log(`WARN: sidecar at ${SIDECAR_PATH} corrupted (${err.message}); starting fresh`);
    return {};
  }
}

function saveSidecar(prior) {
  writeFileSync(SIDECAR_PATH, JSON.stringify(prior, null, 2), 'utf-8');
}

async function bulkUpsert(batch, accountId, namespaceId, apiToken) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(batch),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`KV bulk write failed: HTTP ${res.status} ${errBody.slice(0, 400)}`);
  }
  return res.json();
}

async function main() {
  log('=== KV publish start ===');

  const accountId = process.env.CF_ACCOUNT_ID;
  const namespaceId = process.env.SKILLS_KV_NAMESPACE_ID;
  const apiToken = process.env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) {
    console.error(
      '[publish:kv] FATAL: missing required env var(s). Need CF_ACCOUNT_ID, ' +
        'SKILLS_KV_NAMESPACE_ID, and CF_API_TOKEN.',
    );
    process.exit(1);
  }

  if (!existsSync(SKILLS_NDJSON_PATH)) {
    console.error(`[publish:kv] FATAL: ${SKILLS_NDJSON_PATH} not found`);
    process.exit(1);
  }

  const budget = parseInt(process.env.KV_PUBLISH_BUDGET || String(BUDGET_DEFAULT), 10);
  if (!Number.isFinite(budget) || budget <= 0) {
    console.error(`[publish:kv] FATAL: invalid KV_PUBLISH_BUDGET: ${process.env.KV_PUBLISH_BUDGET}`);
    process.exit(1);
  }
  log(`budget: ${budget} writes per run`);

  const prior = loadSidecar();
  log(`sidecar: ${Object.keys(prior).length} records previously published`);

  // Build the delta (changed + new records) without materializing the full
  // catalog as a single string — chunked reader keeps memory bounded.
  const changed = [];
  let scanned = 0;
  let unchanged = 0;
  const updatedSidecar = { ...prior };

  for (const [slug, record] of readNdjsonRecords(SKILLS_NDJSON_PATH, { keyFn: (r) => r.slug })) {
    scanned++;
    const sha = computeContentSha(record);
    if (prior[slug] === sha) {
      unchanged++;
      continue;
    }
    changed.push({ key: slug, value: JSON.stringify(record) });
    updatedSidecar[slug] = sha;
    if (changed.length >= budget) {
      log(`hit budget cap (${budget}); deferring remaining changes to next run`);
      break;
    }
  }

  log(`scanned: ${scanned}`);
  log(`unchanged (skipped): ${unchanged}`);
  log(`changed (will upsert): ${changed.length}`);

  if (changed.length === 0) {
    log('nothing to upsert; KV state already current');
    return;
  }

  let upserted = 0;
  const startTime = Date.now();
  for (let i = 0; i < changed.length; i += BULK_BATCH_SIZE) {
    const batch = changed.slice(i, i + BULK_BATCH_SIZE);
    try {
      await bulkUpsert(batch, accountId, namespaceId, apiToken);
    } catch (err) {
      log(`FATAL: ${err.message}`);
      // Save sidecar with what we did manage to commit so the next run skips
      // them. Partial-state recovery is the right default for daily-scrape.
      // The slugs in the failed batch will be re-attempted next run.
      const successfulSidecar = { ...prior };
      for (let j = 0; j < i; j++) {
        const sla = changed[j].key;
        successfulSidecar[sla] = updatedSidecar[sla];
      }
      saveSidecar(successfulSidecar);
      log(`partial sidecar saved: ${i} of ${changed.length} confirmed`);
      process.exit(1);
    }
    upserted += batch.length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`  [${upserted}/${changed.length}] batch ${Math.floor(i / BULK_BATCH_SIZE) + 1} upserted (${elapsed}s)`);
  }

  // Save sidecar AFTER all batches succeeded — atomic-ish state.
  saveSidecar(updatedSidecar);
  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`upserted ${upserted} records in ${totalElapsed}s`);
  log(`sidecar updated: ${Object.keys(updatedSidecar).length} total tracked`);
  log('=== KV publish complete ===');
}

main().catch((err) => {
  console.error(`[publish:kv] unhandled: ${err.message}`);
  process.exit(1);
});

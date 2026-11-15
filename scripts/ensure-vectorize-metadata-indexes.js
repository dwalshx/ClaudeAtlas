#!/usr/bin/env node
/**
 * scripts/ensure-vectorize-metadata-indexes.js
 *
 * Makes sure the Vectorize index has a metadata index for every property the
 * worker's /api/v1/search filters on (?type → entity_type, ?tier →
 * quality_tier, ?category → category).
 *
 * Why: Vectorize only filters on properties that have a metadata index, and a
 * vector is only indexed when it is upserted AFTER the metadata index exists.
 * claudeatlas-skills never had any, so every filtered search returned 0
 * matches (found 2026-11-15, when the homepage "APIs" chip came back empty).
 * The daily run calls this right before "Upload vectors to Vectorize", which
 * re-upserts every vector, so one run after the indexes exist makes the
 * filters work.
 *
 * Idempotent: lists the existing metadata indexes and creates only the missing
 * ones. Exits 1 on an API error; the workflow step is continue-on-error so a
 * failure here never blocks the upload or the deploy.
 *
 * Env: CF_ACCOUNT_ID, CF_API_TOKEN (Vectorize Write), CF_VECTORIZE_INDEX
 * (default "claudeatlas-skills"). `--dry-run` lists and prints the plan only.
 */

/** Properties the search worker filters on (worker/index.js filter triad). */
export const REQUIRED_METADATA_INDEXES = [
  { propertyName: 'entity_type', indexType: 'string' },
  { propertyName: 'quality_tier', indexType: 'string' },
  { propertyName: 'category', indexType: 'string' },
];

/** Vectorize allows at most 10 metadata indexes per index. */
export const MAX_METADATA_INDEXES = 10;

/**
 * Pure: which required indexes are missing from `existing`.
 * Throws when a property exists with a different type (needs a human: the
 * index would have to be deleted and recreated) or when creating the missing
 * ones would exceed the 10-index limit.
 * @param {Array<{propertyName: string, indexType: string}>} existing
 * @param {Array<{propertyName: string, indexType: string}>} [required]
 */
export function planMetadataIndexes(existing, required = REQUIRED_METADATA_INDEXES) {
  const byName = new Map((existing || []).map((m) => [m.propertyName, m.indexType]));
  const missing = [];
  for (const r of required) {
    if (!byName.has(r.propertyName)) {
      missing.push(r);
    } else if (String(byName.get(r.propertyName)).toLowerCase() !== r.indexType) {
      throw new Error(
        `metadata index "${r.propertyName}" exists as ${byName.get(r.propertyName)}, expected ${r.indexType}; delete and recreate it by hand`,
      );
    }
  }
  if (byName.size + missing.length > MAX_METADATA_INDEXES) {
    throw new Error(
      `creating ${missing.length} metadata index(es) would exceed the ${MAX_METADATA_INDEXES}-index limit (${byName.size} exist)`,
    );
  }
  return missing;
}

async function cf(path, init = {}) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/vectorize/v2/indexes/${process.env.CF_VECTORIZE_INDEX || 'claudeatlas-skills'}`;
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const errs = JSON.stringify(body.errors || body).slice(0, 300);
    throw new Error(`Vectorize ${init.method || 'GET'} ${path} → HTTP ${res.status}: ${errs}`);
  }
  return body.result;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!process.env.CF_ACCOUNT_ID || !process.env.CF_API_TOKEN) {
    throw new Error('CF_ACCOUNT_ID and CF_API_TOKEN are required');
  }
  const listed = await cf('/metadata_index/list');
  const existing = listed?.metadataIndexes || [];
  console.log(`[metadata-index] existing: ${existing.map((m) => `${m.propertyName}(${m.indexType})`).join(', ') || '(none)'}`);
  const missing = planMetadataIndexes(existing);
  if (missing.length === 0) {
    console.log('[metadata-index] all required metadata indexes exist');
    return;
  }
  for (const m of missing) {
    if (dryRun) {
      console.log(`[metadata-index] would create ${m.propertyName}(${m.indexType})`);
      continue;
    }
    const r = await cf('/metadata_index/create', { method: 'POST', body: JSON.stringify(m) });
    console.log(`[metadata-index] created ${m.propertyName}(${m.indexType}) mutation=${r?.mutationId ?? '?'}`);
  }
  if (!dryRun) {
    console.log('[metadata-index] vectors become filterable on that property once re-upserted (the next upload step does this)');
  }
}

if (process.argv[1]?.endsWith('ensure-vectorize-metadata-indexes.js')) {
  main().catch((err) => {
    console.error(`[metadata-index] FATAL: ${err.message}`);
    process.exit(1);
  });
}

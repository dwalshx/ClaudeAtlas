/**
 * scripts/harvest-apis.js
 *
 * Phase 4.2 (D-01, D-02, 4.2-M04) — daily API harvester. Catalog pass over
 * APIs.guru list.json, data.gouv.fr dataservices (paginated), the co-cddo UK
 * catalogue CSV and the marcelscruz public-apis mirror; spec pass over
 * APIs.guru preferred-version OpenAPI documents (never stored — only a small
 * extract). Output data/apis-raw.ndjson (header sentinel, streaming write).
 *
 * F1 invariants: NDJSON helpers only; prior raw keyed by
 * origin.source + ':' + origin.source_id (Pitfall 4 — ids collide across
 * sources before the merge). Exit 1 when any source returns zero records
 * (D-02: a silent zero is the failure mode we care about).
 *
 * Re-fetch rules (D-02): list.json 304 → every prior apis.guru record is
 * reused unchanged; otherwise a spec is fetched only when the prior raw record
 * is missing, its `raw_source.updated` changed, or its prior failure was
 * transient (fetch_error / 5xx). A 304 on the UK / public-apis files reuses
 * that source's prior records.
 *
 * Usage: node scripts/harvest-apis.js [--mode=catalog-only] [--limit N] [--out <path>]
 *   --mode=catalog-only  skip the spec pass; writes data/apis-raw.catalog-only.ndjson
 *                        (never the real raw path — decision 10)
 *   --limit N            truncate EACH source to N records (smoke; disables floors)
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readNdjsonRecords, writeNdjsonStreaming } from './lib/ndjson.js';
import { buildHeader } from './lib/entity-version.js';
import { mergeAccess } from './lib/access.js';
import { apiRecipe } from './lib/recipes/api.recipe.js';
import { fetchWithRetry, FetchPool, EtagCache } from './lib/feeds/http-fetch.js';
import { extractOpenApi } from './lib/feeds/openapi-extract.js';
import { accessForRecord, accessFromSpec } from './lib/feeds/api-access.js';
import { parseApisGuruList, applySpec, markSpecUnparsed, LIST_URL } from './lib/feeds/sources/apis-guru.js';
import { parseDataGouvPage, nextPageUrl, FIRST_PAGE_URL } from './lib/feeds/sources/data-gouv.js';
import { parseUkCatalogue, CSV_URL } from './lib/feeds/sources/uk-catalogue.js';
import { parsePublicApis, RESOURCES_URL } from './lib/feeds/sources/public-apis.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export const SOURCES = ['apis.guru', 'data.gouv.fr', 'uk-api-catalogue', 'public-apis'];
export const OUT_PATH = join(ROOT, apiRecipe.output_path);
export const CATALOG_ONLY_PATH = join(ROOT, 'data', 'apis-raw.catalog-only.ndjson');
export const PARTIAL_PATH = `${OUT_PATH}.partial`;
export const SIDECAR_PATH = join(ROOT, 'data', 'feeds-etag-cache.ndjson');
export const MIN_GURU = 2000;
export const MIN_TOTAL = 1000;
export const CHECKPOINT_EVERY = 500;
export const SPEC_MAX_BYTES = 5 * 1024 * 1024;

// source_id alone is NOT unique within a source (real data 2026-11-06: 29 UK HMRC APIs share
// one url; 13 public-apis names repeat across categories), so content_sha (stable per-record
// identity hash from the parsers) is part of the key. Keep in sync with filter-apis.js rawKey.
export const rawKey = (rec) => `${rec?.origin?.source}:${rec?.origin?.source_id}:${rec?.content_sha}`;

/** rec.id = apiRecipe.computeId(rec) for every record (after the spec pass). */
export function assignIds(records) {
  for (const r of records) r.id = apiRecipe.computeId(r);
  return records;
}

/** @returns {{ mode: 'full' | 'catalog-only', limit: number, out: string | null, help: boolean }} */
export function parseArgs(argv) {
  const out = { mode: 'full', limit: 0, out: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--mode=')) out.mode = a.slice(7) === 'catalog-only' ? 'catalog-only' : 'full';
    else if (a === '--mode') out.mode = argv[++i] === 'catalog-only' ? 'catalog-only' : 'full';
    else if (a.startsWith('--limit=')) out.limit = Math.max(0, parseInt(a.slice(8), 10) || 0);
    else if (a === '--limit') out.limit = Math.max(0, parseInt(argv[++i], 10) || 0);
    else if (a.startsWith('--out=')) out.out = a.slice(6);
    else if (a === '--out') out.out = argv[++i] ?? null;
  }
  return out;
}

const transient = (reason) => reason === 'fetch_error' || /^http_5/.test(reason ?? '');

function parseJson(body) {
  try { return JSON.parse(body); } catch { return null; }
}

/**
 * @param {{ fetchImpl?: typeof fetch, now?: () => string, outPath?: string, partialPath?: string, sidecarPath?: string,
 *   mode?: 'full' | 'catalog-only', limit?: number, enforceFloors?: boolean, log?: (s: string) => void,
 *   pool?: FetchPool, sleep?: (ms: number) => Promise<void>, checkpointEvery?: number }} [opts]
 */
export async function harvestApis({
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
  outPath = OUT_PATH,
  partialPath,
  sidecarPath = SIDECAR_PATH,
  mode = 'full',
  limit = 0,
  enforceFloors = true,
  log = console.log,
  pool,
  sleep,
  checkpointEvery = CHECKPOINT_EVERY,
} = {}) {
  const t0 = Date.now();
  const catalogOnly = mode === 'catalog-only';
  // Decision 10: catalog-only output NEVER lands on the real raw path.
  const effectiveOut = catalogOnly
    ? (outPath === OUT_PATH ? CATALOG_ONLY_PATH : outPath.replace(/(\.ndjson)?$/, '.catalog-only.ndjson'))
    : outPath;
  const checkpointPath = partialPath ?? `${outPath}.partial`;

  const prior = readNdjsonRecords(outPath, { keyFn: rawKey });
  const priorOf = (source) => [...prior.values()].filter((p) => p?.origin?.source === source);
  const etag = EtagCache.load(sidecarPath);
  const fetchOpts = { fetchImpl, etagCache: etag, now, ...(sleep ? { sleep } : {}) };
  const thePool = pool ?? new FetchPool({ limit: 4, perHostMs: 250, ...(sleep ? { sleep } : {}) });
  const get = (url, extra = {}) => thePool.run(url, () => fetchWithRetry(url, { ...fetchOpts, ...extra }));
  const reused = new Set();   // records carried over from the prior raw (already have access + spec fields)

  /** Fetch a single-file source; on 304 reuse that source's prior records (refetch unconditionally if none). */
  async function singleFile(url, source, parse) {
    let r = await get(url);
    if (r.notModified) {
      const p = priorOf(source);
      if (p.length) {
        for (const rec of p) reused.add(rec);
        return { records: p, reusedAll: true };
      }
      etag.delete(url);   // stale validator without a body to reuse — never FATAL on that
      r = await get(url);
    }
    if (!r.ok || !r.body) return { records: [], reusedAll: false };
    return { records: parse(r.body), reusedAll: false };
  }

  async function harvestGouv() {
    const out = [];
    let url = FIRST_PAGE_URL;
    const seen = new Set();
    while (url && !seen.has(url)) {
      seen.add(url);
      const r = await get(url);
      if (!r.ok || !r.body) break;
      const page = parseJson(r.body);
      if (!page) break;
      out.push(...parseDataGouvPage(page, { now: now() }));
      url = nextPageUrl(page);
    }
    return out;
  }

  const [guruRes, gouvAll, ukRes, pubRes] = await Promise.all([
    singleFile(LIST_URL, 'apis.guru', (body) => parseApisGuruList(parseJson(body) || {}, { now: now() })),
    harvestGouv(),
    singleFile(CSV_URL, 'uk-api-catalogue', (body) => parseUkCatalogue(body, { now: now() })),
    singleFile(RESOURCES_URL, 'public-apis', (body) => parsePublicApis(parseJson(body) || {}, { now: now() })),
  ]);
  const cap = (list) => (limit > 0 ? list.slice(0, limit) : list);
  const guru = cap(guruRes.records);
  const gouv = cap(gouvAll);
  const uk = cap(ukRes.records);
  const pub = cap(pubRes.records);
  const listReused = guruRes.reusedAll;
  const records = [...guru, ...gouv, ...uk, ...pub];
  for (const rec of records) {
    if (!reused.has(rec)) rec.access = accessForRecord(rec, now());
  }

  const bySource = { 'apis.guru': guru.length, 'data.gouv.fr': gouv.length, 'uk-api-catalogue': uk.length, 'public-apis': pub.length };
  const catalogMs = Date.now() - t0;
  log(`[harvest-apis] by_source: apis.guru=${bySource['apis.guru']} data.gouv.fr=${bySource['data.gouv.fr']} uk-api-catalogue=${bySource['uk-api-catalogue']} public-apis=${bySource['public-apis']}`);
  log(`[harvest-apis] catalog pass: ${catalogMs} ms`);

  // Floors run BEFORE any write so a failing harvest produces nothing.
  for (const s of SOURCES) {
    if (bySource[s] === 0) throw new Error(`[harvest-apis] FATAL: source ${s} returned 0 records`);
  }
  if (enforceFloors && !catalogOnly && limit === 0) {
    if (bySource['apis.guru'] < MIN_GURU) {
      throw new Error(`[harvest-apis] FATAL: apis.guru returned ${bySource['apis.guru']} records, below MIN_GURU ${MIN_GURU}`);
    }
    if (records.length < MIN_TOTAL) {
      throw new Error(`[harvest-apis] FATAL: ${records.length} raw records, below MIN_TOTAL ${MIN_TOTAL}`);
    }
  }

  // Spec pass (APIs.guru only).
  const t1 = Date.now();
  const specStats = { fetched: 0, reused: 0, capped: 0, failed: 0, skipped: 0 };
  if (catalogOnly) {
    for (const rec of guru) {
      markSpecUnparsed(rec, 'catalog_only');
      specStats.skipped++;
    }
  } else if (listReused) {
    specStats.reused = guru.length;   // whole-source reuse on 304: prior records already carry spec fields + access
  } else {
    let processed = 0;
    const fetchSpec = async (url) => {
      const opts = { ...fetchOpts, maxBytes: SPEC_MAX_BYTES, headers: { Accept: 'application/json' } };
      let r = await fetchWithRetry(url, opts);
      if (r.notModified) {   // validator without a reusable prior extract — fetch the body
        etag.delete(url);
        r = await fetchWithRetry(url, opts);
      }
      return r;
    };
    await Promise.all(guru.map((rec) => thePool.run(rec.extra.spec_url ?? LIST_URL, async () => {
      const p = prior.get(rawKey(rec));
      if (p && p.extra && p.raw_source?.updated === rec.raw_source.updated && !transient(p.raw_source?.spec_skip_reason)) {
        rec.extra = {
          ...rec.extra,
          base_urls: Array.isArray(p.extra.base_urls) ? p.extra.base_urls : [],
          spec_version: p.extra.spec_version ?? rec.extra.spec_version,
          endpoint_count: p.extra.endpoint_count ?? null,
          endpoint_summaries: Array.isArray(p.extra.endpoint_summaries) ? p.extra.endpoint_summaries : [],
          spec_parsed: p.extra.spec_parsed === true,
        };
        if (p.raw_source?.spec_skip_reason) rec.raw_source.spec_skip_reason = p.raw_source.spec_skip_reason;
        if (p.docs_url && rec.docs_url == null) rec.docs_url = p.docs_url;
        if (p.access) rec.access = structuredClone(p.access);
        specStats.reused++;
      } else if (!rec.extra.spec_url) {
        markSpecUnparsed(rec, 'no_spec_url');
        specStats.skipped++;
      } else {
        try {
          const r = await fetchSpec(rec.extra.spec_url);
          if (r.capped) {
            markSpecUnparsed(rec, 'capped');
            specStats.capped++;
          } else if (!r.ok || !r.body) {
            markSpecUnparsed(rec, `http_${r.status}`);
            specStats.failed++;
          } else {
            const ex = extractOpenApi(parseJson(r.body));
            if (!ex) {
              markSpecUnparsed(rec, 'invalid_json');
              specStats.failed++;
            } else {
              applySpec(rec, ex);
              rec.access = mergeAccess(rec.access, accessFromSpec(ex, rec.extra.spec_url, now()));
              specStats.fetched++;
            }
          }
        } catch {
          markSpecUnparsed(rec, 'fetch_error');
          specStats.failed++;
        }
      }
      processed++;
      if (checkpointEvery > 0 && processed % checkpointEvery === 0) {
        writeNdjsonStreaming(checkpointPath, records, { header: buildHeader('api') });
      }
    })));
  }
  const specMs = Date.now() - t1;
  log(`[harvest-apis] spec pass: fetched=${specStats.fetched} reused=${specStats.reused} capped=${specStats.capped} failed=${specStats.failed} skipped=${specStats.skipped} in ${specMs} ms`);

  assignIds(records);
  writeNdjsonStreaming(effectiveOut, records, { header: buildHeader('api') });
  etag.save(sidecarPath);
  const timings = { catalogMs, specMs, totalMs: Date.now() - t0 };
  log(`[harvest-apis] wrote ${effectiveOut} (${records.length} records) in ${timings.totalMs} ms`);
  return { records, bySource, specStats, timings, outPath: effectiveOut };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/harvest-apis.js [--mode=catalog-only] [--limit N] [--out <path>]');
    return;
  }
  try {
    const r = await harvestApis({ mode: args.mode, limit: args.limit, outPath: args.out ?? OUT_PATH });
    console.log('[harvest-apis] summary', JSON.stringify({ bySource: r.bySource, specStats: r.specStats, timings: r.timings }));
  } catch (err) {
    console.error(err?.message ?? err);
    process.exit(1);
  }
}

const invokedAsScript = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (invokedAsScript) main();

/**
 * ClaudeAtlas — shared GitHub fetch helpers.
 *
 * Extracted from scripts/scrape.js so Track 1 (scrape-pulse.js) and Track 2
 * (scrape.js) share the same rate-limit accounting, ETag cache, and retry
 * semantics. Module-private state (rate counters, HEADERS, _etagCache) is
 * intentionally not exported — each `node` invocation gets its own budget,
 * which is fine because the daily workflow runs the two tracks as separate
 * processes.
 *
 * Exports: rateLimitedFetch, fetchWithETag, loadETagCache, saveETagCache,
 *          getETagCache, sleep.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, writeSync, closeSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DATA_DIR = join(ROOT, 'data');
const ETAG_PATH = join(DATA_DIR, 'etag-cache.json');

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('ERROR: GITHUB_TOKEN environment variable required.');
  console.error('Create a fine-grained PAT at https://github.com/settings/tokens?type=beta');
  console.error('Required scope: Public Repositories (read-only)');
  process.exit(1);
}

const HEADERS = {
  'Authorization': `Bearer ${TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

// --- Rate limiting (module-private state) ---

let searchRequestsThisMinute = 0;
let searchMinuteStart = Date.now();
let generalRequestsThisHour = 0;
let generalHourStart = Date.now();

export async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function rateLimitedFetch(url, isSearch = false, retries = 3) {
  const now = Date.now();

  if (isSearch) {
    // Code search: 10 req/min
    if (now - searchMinuteStart > 60000) {
      searchRequestsThisMinute = 0;
      searchMinuteStart = now;
    }
    if (searchRequestsThisMinute >= 9) {
      const waitMs = 60000 - (now - searchMinuteStart) + 1000;
      console.log(`  [rate-limit] Code search limit reached, waiting ${Math.ceil(waitMs / 1000)}s...`);
      await sleep(waitMs);
      searchRequestsThisMinute = 0;
      searchMinuteStart = Date.now();
    }
    searchRequestsThisMinute++;
  } else {
    // General API: 5000 req/hr
    if (now - generalHourStart > 3600000) {
      generalRequestsThisHour = 0;
      generalHourStart = now;
    }
    if (generalRequestsThisHour >= 4800) {
      const waitMs = 3600000 - (now - generalHourStart) + 1000;
      console.log(`  [rate-limit] General API limit approaching, waiting ${Math.ceil(waitMs / 1000)}s...`);
      await sleep(waitMs);
      generalRequestsThisHour = 0;
      generalHourStart = Date.now();
    }
    generalRequestsThisHour++;
  }

  let res;
  try {
    res = await fetch(url, { headers: HEADERS });
  } catch (err) {
    if (retries > 0) {
      console.log(`  [retry] Network error (${err.cause?.code || err.message}), retrying in 5s... (${retries} left)`);
      await sleep(5000);
      return rateLimitedFetch(url, isSearch, retries - 1);
    }
    throw err;
  }

  // Handle rate limit errors.
  // retry-after = SECONDARY (abuse) limit; x-ratelimit-reset = PRIMARY.
  // Check retry-after first per RESEARCH §6 — the prior code over-waited up to
  // ~1hr on a secondary 403 (it read x-ratelimit-reset, which is the primary
  // hourly reset, not the short secondary backoff GitHub actually asks for).
  if (res.status === 403 || res.status === 429) {
    const retryAfter = res.headers.get('retry-after');
    const retryAfterSecs = retryAfter ? parseInt(retryAfter, 10) : NaN;
    if (Number.isInteger(retryAfterSecs) && retryAfterSecs > 0) {
      // Cap at 120s to avoid a pathological multi-minute over-wait.
      const waitMs = Math.min(retryAfterSecs * 1000 + 1000, 120000);
      console.log(`  [rate-limit] secondary limit, retry-after ${retryAfterSecs}s...`);
      await sleep(waitMs);
      return rateLimitedFetch(url, isSearch, retries); // retry
    }
    const resetHeader = res.headers.get('x-ratelimit-reset');
    if (resetHeader) {
      const resetTime = parseInt(resetHeader) * 1000;
      const waitMs = Math.max(resetTime - Date.now() + 1000, 5000);
      console.log(`  [rate-limit] 403/429 hit, waiting ${Math.ceil(waitMs / 1000)}s until reset...`);
      await sleep(waitMs);
      return rateLimitedFetch(url, isSearch, retries); // retry
    }
    // Fallback: wait 60s
    console.log('  [rate-limit] 403/429 hit (no reset header), waiting 60s...');
    await sleep(60000);
    return rateLimitedFetch(url, isSearch, retries);
  }

  return res;
}

// --- ETag cache ---

let _etagCache = null;

export function loadETagCache() {
  if (existsSync(ETAG_PATH)) {
    try {
      return JSON.parse(readFileSync(ETAG_PATH, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

export function getETagCache() {
  if (_etagCache === null) _etagCache = loadETagCache();
  return _etagCache;
}

export function saveETagCache(cache) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  // Write chunked JSON to avoid V8's ~536 MB string limit on large caches.
  // Synchronous fd writes mean each chunk is a small allocation; the file
  // shape remains a flat JSON object that JSON.parse can read back.
  const tmp = ETAG_PATH + '.tmp';
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, '{');
    let first = true;
    for (const [k, v] of Object.entries(cache)) {
      const chunk = (first ? '' : ',') + JSON.stringify(k) + ':' + JSON.stringify(v);
      writeSync(fd, chunk);
      first = false;
    }
    writeSync(fd, '}');
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, ETAG_PATH);
}

export async function fetchWithETag(url, retries = 3) {
  const cache = getETagCache();
  const cached = cache[url];
  const headers = { ...HEADERS };
  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag;
  }

  const now = Date.now();
  if (now - generalHourStart > 3600000) {
    generalRequestsThisHour = 0;
    generalHourStart = now;
  }
  if (generalRequestsThisHour >= 4800) {
    const waitMs = 3600000 - (now - generalHourStart) + 1000;
    await sleep(waitMs);
    generalRequestsThisHour = 0;
    generalHourStart = Date.now();
  }
  generalRequestsThisHour++;

  let res;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    if (retries > 0) {
      console.log(`  [retry] Network error (${err.cause?.code || err.message}), retrying in 5s... (${retries} left)`);
      await sleep(5000);
      return fetchWithETag(url, retries - 1);
    }
    return { data: null, cached: false, status: 0 };
  }

  if (res.status === 304 && cached?.data) {
    return { data: cached.data, cached: true };
  }

  // retry-after = SECONDARY (abuse) limit; x-ratelimit-reset = PRIMARY.
  // Check retry-after first per RESEARCH §6 — the prior code over-waited up to
  // ~1hr on a secondary 403 (Track 1's proximate failure: ~4,351 back-to-back
  // GETs trip the secondary 900-pts/min abuse heuristic, which signals via
  // retry-after, not x-ratelimit-reset).
  if (res.status === 403 || res.status === 429) {
    const retryAfter = res.headers.get('retry-after');
    const retryAfterSecs = retryAfter ? parseInt(retryAfter, 10) : NaN;
    if (Number.isInteger(retryAfterSecs) && retryAfterSecs > 0) {
      // Cap at 120s to avoid a pathological multi-minute over-wait.
      const waitMs = Math.min(retryAfterSecs * 1000 + 1000, 120000);
      console.log(`  [rate-limit] secondary limit, retry-after ${retryAfterSecs}s...`);
      await sleep(waitMs);
      return fetchWithETag(url, retries);
    }
    const resetHeader = res.headers.get('x-ratelimit-reset');
    if (resetHeader) {
      const resetTime = parseInt(resetHeader) * 1000;
      const waitMs = Math.max(resetTime - Date.now() + 1000, 5000);
      console.log(`  [rate-limit] ETag fetch 403/429, waiting ${Math.ceil(waitMs / 1000)}s...`);
      await sleep(waitMs);
      return fetchWithETag(url, retries);
    }
    await sleep(60000);
    return fetchWithETag(url, retries);
  }

  if (!res.ok) {
    return { data: null, cached: false, status: res.status };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return { data: null, cached: false, status: res.status };
  }
  const etag = res.headers.get('etag');
  if (etag) {
    cache[url] = { etag, data };
  }

  return { data, cached: false, status: res.status };
}

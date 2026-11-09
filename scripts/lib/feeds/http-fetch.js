/**
 * scripts/lib/feeds/http-fetch.js
 *
 * Phase 4.2 (D-02, 4.2-M03) — polite, host-agnostic HTTP for the feed
 * harvesters. NOT github-fetch.js: no token, no auth header, no body
 * cache (the prior raw NDJSON is the body cache). Sidecar
 * `feeds-etag-cache.ndjson` holds validators only
 * ({ url, etag, last_modified, checked_at, status }), one line per URL,
 * read/written through scripts/lib/ndjson.js so the F1 lints never apply.
 *
 * Politeness (D-02): declared User-Agent (AGENT_UA), conditional GETs
 * (If-None-Match, else If-Modified-Since), 20 s timeout, bodies counted while
 * streaming and cancelled past `maxBytes` (no source sends Content-Length),
 * 3 retries on 429 / 5xx / network errors with Retry-After (capped 120 s) or
 * 1 s → 4 s → 16 s backoff, ≤ 4 requests in flight, ≥ 250 ms between starts
 * on the same host.
 *
 * Everything is injectable (fetchImpl, sleep, now) so tests never touch the
 * network. Paths are always passed in by callers.
 */

import { readNdjsonRecords, writeNdjsonStreaming } from '../ndjson.js';
import { AGENT_UA } from '../reciprocal-probe.js';
import { hostOf } from '../url-host.js';

export const DEFAULT_ACCEPT = 'application/json, text/csv, text/plain;q=0.9, */*;q=0.1';

const RETRY_AFTER_CAP_MS = 120000;
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Read a Response body as UTF-8 text, counting bytes while streaming and
 * cancelling the reader as soon as `maxBytes` is exceeded.
 *
 * @param {Response} res
 * @param {number} [maxBytes]
 * @returns {Promise<{ capped: boolean, body: string | null, bytes: number }>}
 */
export async function readBodyCapped(res, maxBytes = Infinity) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text();
    const bytes = Buffer.byteLength(text);
    return bytes > maxBytes ? { capped: true, body: null, bytes } : { capped: false, body: text, bytes };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      try { await reader.cancel(); } catch { /* already closed */ }
      return { capped: true, body: null, bytes };
    }
    chunks.push(value);
  }
  return { capped: false, body: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8'), bytes };
}

/**
 * One polite GET. Never throws for HTTP status codes (only for network /
 * timeout errors from fetchImpl).
 *
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, etagCache?: { get(url: string): any, set(url: string, e: any): void }, timeoutMs?: number, maxBytes?: number, headers?: Record<string, string>, now?: () => string }} [opts]
 * @returns {Promise<{ status: number, ok: boolean, notModified: boolean, capped: boolean, body: string | null, headers: { etag: string | null, lastModified: string | null, contentType: string | null, retryAfter: string | null } }>}
 */
export async function politeFetch(url, {
  fetchImpl = fetch,
  etagCache,
  timeoutMs = 20000,
  maxBytes = Infinity,
  headers = {},
  now = () => new Date().toISOString(),
} = {}) {
  const prior = etagCache?.get(url);
  const h = { 'User-Agent': AGENT_UA, Accept: DEFAULT_ACCEPT, ...headers };
  if (prior?.etag) h['If-None-Match'] = prior.etag;
  else if (prior?.last_modified) h['If-Modified-Since'] = prior.last_modified;

  const res = await fetchImpl(url, { headers: h, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  const out = {
    status: res.status,
    ok: res.ok,
    notModified: res.status === 304,
    capped: false,
    body: null,
    headers: {
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
      contentType: res.headers.get('content-type'),
      retryAfter: res.headers.get('retry-after'),
    },
  };
  if (out.notModified) return out;

  const { capped, body } = await readBodyCapped(res, maxBytes);
  out.capped = capped;
  out.body = body;
  if (res.ok && etagCache && (out.headers.etag || out.headers.lastModified)) {
    etagCache.set(url, {
      url,
      etag: out.headers.etag ?? null,
      last_modified: out.headers.lastModified ?? null,
      checked_at: now(),
      status: res.status,
    });
  }
  return out;
}

function retryDelay(res, attempt, backoffMs) {
  const ra = res?.headers?.retryAfter;
  const secs = ra != null && ra !== '' ? Number(ra) : NaN;
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, RETRY_AFTER_CAP_MS);
  return backoffMs[Math.min(attempt, backoffMs.length - 1)];
}

const isRetryableError = (err) => err instanceof TypeError || err?.name === 'AbortError' || err?.name === 'TimeoutError';

/**
 * politeFetch with retries on 429, >= 500 and network/timeout errors. Other
 * 4xx are returned as-is. After the last attempt the final response is
 * returned (or the last error rethrown).
 *
 * @param {string} url
 * @param {Parameters<typeof politeFetch>[1] & { retries?: number, backoffMs?: number[], sleep?: (ms: number) => Promise<void> }} [opts]
 */
export async function fetchWithRetry(url, { retries = 3, backoffMs = [1000, 4000, 16000], sleep = defaultSleep, ...opts } = {}) {
  let attempt = 0;
  for (;;) {
    let res = null;
    let err = null;
    try {
      res = await politeFetch(url, opts);
      if (!(res.status === 429 || res.status >= 500)) return res;
    } catch (e) {
      if (!isRetryableError(e)) throw e;
      err = e;
    }
    if (attempt >= retries) {
      if (res) return res;
      throw err;
    }
    await sleep(retryDelay(res, attempt, backoffMs));
    attempt++;
  }
}

/**
 * Concurrency-limited task pool with per-host start spacing. Same-host jobs
 * are serialised on a promise chain so each one's spacing is measured from
 * the previous job's ACTUAL start (two queued jobs never compute the same
 * wait).
 */
export class FetchPool {
  constructor({ limit = 4, perHostMs = 250, now = Date.now, sleep = defaultSleep } = {}) {
    this.limit = limit;
    this.perHostMs = perHostMs;
    this.now = now;
    this.sleep = sleep;
    this.active = 0;
    this.queue = [];
    this.lastStart = new Map();   // host → timestamp of the last start
    this.hostChain = new Map();   // host → promise resolved once the latest job on that host has started
  }

  get inFlight() { return this.active; }

  /**
   * @template T
   * @param {string} url
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  run(url, fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ url, fn, resolve, reject });
      this._pump();
    });
  }

  _pump() {
    while (this.active < this.limit && this.queue.length) {
      const job = this.queue.shift();
      this.active++;
      this._exec(job).finally(() => {
        this.active--;
        this._pump();
      });
    }
  }

  async _exec({ url, fn, resolve, reject }) {
    const host = hostOf(url) || '*';
    const prev = this.hostChain.get(host) ?? Promise.resolve();
    let started;
    const mine = new Promise((r) => { started = r; });
    this.hostChain.set(host, mine);
    try {
      await prev;
      const last = this.lastStart.get(host);
      const wait = last == null ? 0 : Math.max(0, last + this.perHostMs - this.now());
      if (wait > 0) await this.sleep(wait);
      this.lastStart.set(host, this.now());
    } finally {
      started();
      if (this.hostChain.get(host) === mine) this.hostChain.delete(host);
    }
    try {
      resolve(await fn());
    } catch (e) {
      reject(e);
    }
  }
}

/** URL-keyed validator cache persisted as a header-less NDJSON sidecar. */
export class EtagCache {
  constructor(map = new Map()) { this.map = map; }

  /** Missing file → empty cache (readNdjsonRecords semantics). */
  static load(path) {
    return new EtagCache(readNdjsonRecords(path, { keyFn: (r) => r.url }));
  }

  get(url) { return this.map.get(url); }

  set(url, entry) { this.map.set(url, { ...entry, url }); }

  delete(url) { this.map.delete(url); }

  get size() { return this.map.size; }

  /** No header: this is a sidecar, not an entity file. */
  save(path) { writeNdjsonStreaming(path, [...this.map.values()]); }
}

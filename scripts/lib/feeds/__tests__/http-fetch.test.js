/**
 * scripts/lib/feeds/__tests__/http-fetch.test.js
 *
 * Phase 4.2 Plan 02 (4.2-M03 / D-02). RED until Plan 05 lands. No real
 * network: every test injects fetchImpl / sleep / now.
 *
 * Contract: declared UA + Accept, conditional GET from an NDJSON ETag
 * sidecar, streamed 5 MB body cap, 429/5xx retry with Retry-After, ≤ 4 in
 * flight, ≥ 250 ms between starts on the same host.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  politeFetch, readBodyCapped, fetchWithRetry, FetchPool, EtagCache, DEFAULT_ACCEPT,
} from '../http-fetch.js';
import { AGENT_UA } from '../../reciprocal-probe.js';

const LIST = 'https://api.apis.guru/v2/list.json';
const GOUV = 'https://www.data.gouv.fr/api/1/dataservices/?page_size=200';
const MB = 1024 * 1024;

function streamOf(chunks) {
  return new ReadableStream({
    pull(c) {
      if (chunks.length) c.enqueue(chunks.shift());
      else c.close();
    },
  });
}

function fakeResponse({ status = 200, body = '', headers = {}, chunks } = {}) {
  if (status === 304) return new Response(null, { status: 304, headers });
  return new Response(chunks ? streamOf(chunks) : body, { status, headers });
}

/** Queue-driven fake fetch. Entries are Responses or functions (called; may throw). */
function recorder() {
  const queue = [];
  const calls = [];
  return {
    calls,
    async fetchImpl(url, init) {
      calls.push({ url, init });
      const next = queue.shift();
      return typeof next === 'function' ? next() : next;
    },
    push(...res) { queue.push(...res); },
  };
}

class MemCache {
  constructor() { this.map = new Map(); }
  get(u) { return this.map.get(u); }
  set(u, e) { this.map.set(u, e); }
}

const megabytes = (n) => Array.from({ length: n }, () => new Uint8Array(MB));

test('4.2-M03: politeFetch sends the declared UA + Accept and If-None-Match from the cache; 304 → notModified', async () => {
  const cache = new MemCache();
  cache.set(LIST, { url: LIST, etag: '"abc"', last_modified: null });
  const rec = recorder();
  rec.push(fakeResponse({ status: 304 }));
  const r = await politeFetch(LIST, { fetchImpl: rec.fetchImpl, etagCache: cache });
  assert.equal(r.status, 304);
  assert.equal(r.notModified, true);
  assert.equal(r.body, null);
  assert.equal(r.capped, false);
  const init = rec.calls[0].init;
  assert.equal(init.headers['User-Agent'], AGENT_UA);
  assert.equal(init.headers.Accept, DEFAULT_ACCEPT);
  assert.equal(init.headers['If-None-Match'], '"abc"');
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(init.redirect, 'follow');
});

test('4.2-M03: 200 with ETag stores { url, etag, last_modified, checked_at, status } and returns the body', async () => {
  const cache = new MemCache();
  const rec = recorder();
  rec.push(fakeResponse({
    body: '{"a":1}',
    headers: { etag: 'W/"x"', 'last-modified': 'Mon, 18 Aug 2025 11:01:06 GMT', 'content-type': 'application/json' },
  }));
  const r = await politeFetch(LIST, { fetchImpl: rec.fetchImpl, etagCache: cache });
  assert.equal(r.body, '{"a":1}');
  assert.equal(r.ok, true);
  assert.equal(r.headers.etag, 'W/"x"');
  assert.equal(r.headers.contentType, 'application/json');
  const e = cache.get(LIST);
  assert.equal(e.etag, 'W/"x"');
  assert.equal(e.last_modified, 'Mon, 18 Aug 2025 11:01:06 GMT');
  assert.equal(e.status, 200);
  assert.equal(typeof e.checked_at, 'string');
  assert.equal(e.url, LIST);
});

test('4.2-M03/Pitfall 2: 200 without ETag or Last-Modified never writes the cache; If-Modified-Since is used when only last_modified is cached', async () => {
  const cache = new MemCache();
  const rec = recorder();
  rec.push(fakeResponse({ body: '{"data":[]}' }));
  const r = await politeFetch(GOUV, { fetchImpl: rec.fetchImpl, etagCache: cache });
  assert.equal(r.status, 200);
  assert.equal(cache.map.size, 0);

  const cache2 = new MemCache();
  cache2.set(LIST, { url: LIST, etag: null, last_modified: 'Mon, 18 Aug 2025 10:53:40 GMT' });
  const rec2 = recorder();
  rec2.push(fakeResponse({ status: 304 }));
  await politeFetch(LIST, { fetchImpl: rec2.fetchImpl, etagCache: cache2 });
  const h = rec2.calls[0].init.headers;
  assert.equal(h['If-Modified-Since'], 'Mon, 18 Aug 2025 10:53:40 GMT');
  assert.ok(!('If-None-Match' in h));
});

test('4.2-M03/Pitfall 1: readBodyCapped cancels after maxBytes and reports capped', async () => {
  const over = await readBodyCapped(fakeResponse({ chunks: megabytes(7) }), 5 * 1024 * 1024);
  assert.equal(over.capped, true);
  assert.equal(over.body, null);
  assert.ok(over.bytes > 5 * 1024 * 1024);

  const under = await readBodyCapped(fakeResponse({ chunks: megabytes(3) }), 5 * 1024 * 1024);
  assert.equal(under.capped, false);
  assert.equal(under.body.length, 3 * MB);

  const rec = recorder();
  rec.push(fakeResponse({ chunks: megabytes(7) }));
  const r = await politeFetch('https://api.apis.guru/v2/specs/microsoft.com/graph/1.0/openapi.json', {
    fetchImpl: rec.fetchImpl, maxBytes: 5 * 1024 * 1024,
  });
  assert.equal(r.capped, true);
  assert.equal(r.body, null);
  assert.equal(r.status, 200);
});

test('4.2-M03: fetchWithRetry retries 429 honouring Retry-After and 5xx with 1s/4s/16s backoff', async () => {
  {
    const sleeps = [];
    const rec = recorder();
    rec.push(fakeResponse({ status: 429, headers: { 'retry-after': '1' } }), fakeResponse({ body: 'ok' }));
    const r = await fetchWithRetry(LIST, { fetchImpl: rec.fetchImpl, sleep: async (ms) => { sleeps.push(ms); } });
    assert.equal(rec.calls.length, 2);
    assert.deepEqual(sleeps, [1000]);
    assert.equal(r.status, 200);
  }
  {
    const sleeps = [];
    const rec = recorder();
    rec.push(...[500, 500, 500, 500].map((status) => fakeResponse({ status })));
    const r = await fetchWithRetry(LIST, { fetchImpl: rec.fetchImpl, sleep: async (ms) => { sleeps.push(ms); } });
    assert.equal(rec.calls.length, 4);
    assert.deepEqual(sleeps, [1000, 4000, 16000]);
    assert.equal(r.status, 500);
  }
  {
    const sleeps = [];
    const rec = recorder();
    rec.push(fakeResponse({ status: 429, headers: { 'retry-after': '999' } }), fakeResponse({ body: 'ok' }));
    await fetchWithRetry(LIST, { fetchImpl: rec.fetchImpl, sleep: async (ms) => { sleeps.push(ms); } });
    assert.deepEqual(sleeps, [120000]);
  }
});

test('4.2-M03: fetchWithRetry does not retry other 4xx and retries thrown TypeError/AbortError', async () => {
  const noSleep = async () => {};
  {
    const rec = recorder();
    rec.push(fakeResponse({ status: 404, body: 'not found' }));
    const r = await fetchWithRetry(LIST, { fetchImpl: rec.fetchImpl, sleep: noSleep });
    assert.equal(rec.calls.length, 1);
    assert.equal(r.status, 404);
    assert.equal(r.ok, false);
  }
  {
    const rec = recorder();
    rec.push(() => { throw new TypeError('fetch failed'); }, fakeResponse({ body: 'ok' }));
    const r = await fetchWithRetry(LIST, { fetchImpl: rec.fetchImpl, sleep: noSleep });
    assert.equal(rec.calls.length, 2);
    assert.equal(r.status, 200);
  }
  {
    const rec = recorder();
    const abort = () => { throw Object.assign(new Error('t'), { name: 'AbortError' }); };
    rec.push(abort, abort, abort, abort);
    await assert.rejects(fetchWithRetry(LIST, { fetchImpl: rec.fetchImpl, sleep: noSleep }));
    assert.equal(rec.calls.length, 4);
  }
});

test('4.2-M03: FetchPool caps concurrency at 4 and spaces same-host starts by ≥ 250 ms', async () => {
  let t = 0;
  const now = () => t;
  const sleep = async (ms) => { t += ms; };
  const pool = new FetchPool({ limit: 4, perHostMs: 250, now, sleep });
  const starts = [];
  let active = 0;
  let peak = 0;
  const jobs = [];
  for (let i = 0; i < 10; i++) {
    jobs.push(pool.run(`https://api.apis.guru/v2/specs/${i}.json`, async () => {
      active++;
      peak = Math.max(peak, active, pool.inFlight);
      starts.push(now());
      await sleep(100);
      active--;
      return i;
    }));
  }
  const results = await Promise.all(jobs);
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(peak <= 4, `peak ${peak}`);
  const sorted = [...starts].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i] - sorted[i - 1] >= 250, `gap ${sorted[i] - sorted[i - 1]} at ${i}`);
  }

  t = 0;
  const pool2 = new FetchPool({ limit: 4, perHostMs: 250, now, sleep });
  const s2 = [];
  await Promise.all([
    pool2.run('https://a.example/', async () => { s2.push(now()); }),
    pool2.run('https://b.example/', async () => { s2.push(now()); }),
  ]);
  assert.deepEqual(s2, [0, 0]);
});

test('4.2-M03: EtagCache round-trips an NDJSON sidecar (no header), keyed by url', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feeds-etag-'));
  try {
    const p = join(dir, 'feeds-etag-cache.ndjson');
    const c = EtagCache.load(p);
    assert.equal(c.size, 0);
    const url2 = 'https://raw.githubusercontent.com/co-cddo/api-catalogue/main/data/catalogue.csv';
    c.set(LIST, { url: LIST, etag: '"e1"', last_modified: null, checked_at: '2026-11-05T12:00:00Z', status: 200 });
    c.set(url2, { url: url2, etag: '"e2"', last_modified: null, checked_at: '2026-11-05T12:00:00Z', status: 200 });
    c.save(p);
    assert.ok(existsSync(p));
    const lines = readFileSync(p, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 2);
    for (const l of lines) assert.ok(!l.includes('"_header"'));
    const back = EtagCache.load(p);
    assert.equal(back.get(LIST).etag, '"e1"');
    back.delete(LIST);
    assert.equal(back.size, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

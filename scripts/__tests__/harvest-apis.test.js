/**
 * scripts/__tests__/harvest-apis.test.js
 *
 * Phase 4.2 Plan 03 (4.2-M04 / D-02). RED until Plan 09 lands.
 *
 * In-process integration tests for harvestApis(): the four catalog sources
 * and the APIs.guru spec pass run over the shared fixtureFetch (no network),
 * writing into a tmpdir. Pins the 33-record raw set, the zero-source FATAL,
 * --limit, warm-run reuse (304 + per-record `updated`), catalog-only mode,
 * the 5 MB cap / invalid JSON / thrown-fetch skip reasons and checkpoints.
 *
 * Never imports the Astro-side entity loader. `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  harvestApis, rawKey, assignIds, SOURCES, MIN_GURU, MIN_TOTAL, CHECKPOINT_EVERY, SPEC_MAX_BYTES,
} from '../harvest-apis.js';
import { makeFixtureFetch, specUrlOf, GOUV_URL, LIST_URL, LIST_ETAG } from '../lib/feeds/__tests__/helpers/fixture-fetch.js';
import { readNdjsonRecords, writeNdjsonStreaming } from '../lib/ndjson.js';
import { FetchPool } from '../lib/feeds/http-fetch.js';
import { buildHeader } from '../lib/entity-version.js';

const NOW = () => '2026-11-05T12:00:00Z';
const SPECS_PREFIX = 'api.apis.guru/v2/specs/';
const MB = 1024 * 1024;

function assertNoUndefined(obj, path = '') {
  if (obj === undefined) assert.fail(`undefined value at ${path || '<root>'}`);
  if (obj === null || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => assertNoUndefined(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(obj)) assertNoUndefined(v, path ? `${path}.${k}` : k);
}

function paths(dir) {
  return {
    out: join(dir, 'apis-raw.ndjson'),
    partial: join(dir, 'apis-raw.ndjson.partial'),
    sidecar: join(dir, 'feeds-etag-cache.ndjson'),
  };
}

/** Runs harvestApis over fixtureFetch into `dir`; attaches the fetch call log as `.calls`. */
async function runFixtureHarvest(dir, extra = {}) {
  const { fetch: fetchOpts, ...rest } = extra;
  const ff = makeFixtureFetch(fetchOpts);
  const p = paths(dir);
  const r = await harvestApis({
    fetchImpl: ff.fetchImpl,
    now: NOW,
    outPath: p.out,
    partialPath: p.partial,
    sidecarPath: p.sidecar,
    enforceFloors: false,
    log: () => {},
    // No real per-host spacing in tests (politeness spacing is covered by http-fetch.test.js).
    pool: new FetchPool({ limit: 4, perHostMs: 0 }),
    ...rest,
  });
  r.calls = ff.calls;
  return r;
}

function withTmp(fn) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'feeds-'));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

const find = (records, source, name) => records.find((r) => r.origin.source === source && r.name === name);
const specCalls = (calls) => calls.filter((c) => c.url.includes(SPECS_PREFIX));

test('4.2-M04: full run over the fixture sources writes a header + 33 records; by_source and spec stats match', withTmp(async (dir) => {
  const { out, sidecar } = paths(dir);
  const r = await runFixtureHarvest(dir);
  assert.deepEqual(r.bySource, { 'apis.guru': 7, 'data.gouv.fr': 6, 'uk-api-catalogue': 10, 'public-apis': 10 });
  assert.equal(r.records.length, 33);

  const firstLine = JSON.parse(readFileSync(out, 'utf-8').split('\n')[0]);
  assert.equal(firstLine._header, true);
  assert.equal(firstLine.schema_version, 2);
  assert.equal(firstLine.entity_type, 'api');
  assert.equal(readNdjsonRecords(out, { keyFn: rawKey }).size, 33);

  assert.deepEqual(r.specStats, { fetched: 3, reused: 0, capped: 0, failed: 4, skipped: 0 });

  for (const rec of r.records) {
    assert.equal(typeof rec.id, 'string');
    assert.ok(rec.id.startsWith('api:'), rec.id);
    assert.equal(typeof rec.access.cost, 'object');
    assertNoUndefined(rec);
  }

  const stripe = find(r.records, 'apis.guru', 'stripe');
  assert.equal(stripe.id, 'api:api.stripe.com/stripe');
  assert.equal(stripe.extra.spec_parsed, true);
  assert.deepEqual(stripe.extra.base_urls, ['https://api.stripe.com/']);
  assert.equal(stripe.extra.endpoint_count, 2);
  assert.equal(stripe.access.auth.type, 'http_basic');
  assert.deepEqual(stripe.access.auth.schemes, ['http_basic', 'bearer']);
  assert.equal(stripe.access.provenance['auth.type'].source_url, specUrlOf('stripe.com'));

  const github = find(r.records, 'apis.guru', 'github');
  assert.equal(github.id, 'api:api.github.com/github');
  assert.equal(github.access.license.spdx, 'MIT');

  const openai = find(r.records, 'apis.guru', 'openai');
  assert.equal(openai.id, 'api:openai.com/openai');
  assert.equal(openai.extra.spec_parsed, false);
  assert.equal(openai.raw_source.spec_skip_reason, 'http_404');
  assert.deepEqual(openai.extra.base_urls, []);

  const melodi = find(r.records, 'data.gouv.fr', 'melodi');
  assert.equal(melodi.id, 'api:api.insee.fr/melodi');
  assert.ok(melodi.access.rate_limit.notes.startsWith('20 interrogations'));
  assert.equal(melodi.access.cost.model, 'free');

  const cat = find(r.records, 'public-apis', 'cat-facts');
  assert.equal(cat.id, 'api:catfact.ninja/cat-facts');
  assert.equal(cat.access.auth.type, 'none');

  assert.deepEqual(SOURCES, ['apis.guru', 'data.gouv.fr', 'uk-api-catalogue', 'public-apis']);
  assert.ok(MIN_GURU === 2000 && MIN_TOTAL === 1000 && CHECKPOINT_EVERY === 500 && SPEC_MAX_BYTES === 5 * 1024 * 1024);

  assert.ok(existsSync(sidecar));
  const side = readNdjsonRecords(sidecar, { keyFn: (e) => e.url });
  assert.ok(side.has(LIST_URL));
  assert.equal(side.has(GOUV_URL), false);
}));

test('4.2-M04/D-02: any source returning zero records rejects with a FATAL message and writes nothing', withTmp(async (dir) => {
  const { out } = paths(dir);
  for (const s of SOURCES) {
    await assert.rejects(
      runFixtureHarvest(dir, { fetch: { failSource: s } }),
      (err) => err.message.includes(`FATAL: source ${s} returned 0 records`),
    );
    assert.equal(existsSync(out), false, `${s}: nothing written`);
  }
}));

test('4.2-M04: --limit caps each source and disables floors', withTmp(async (dir) => {
  const r = await runFixtureHarvest(dir, { limit: 2 });
  assert.deepEqual(r.bySource, { 'apis.guru': 2, 'data.gouv.fr': 2, 'uk-api-catalogue': 2, 'public-apis': 2 });
  assert.equal(r.records.length, 8);
  await assert.doesNotReject(runFixtureHarvest(dir, { limit: 2, enforceFloors: true }));
  await assert.rejects(runFixtureHarvest(dir, { enforceFloors: true }), /below MIN_GURU|below MIN_TOTAL/);
}));

test('4.2-M04/D-02: prior raw is reused when list.json is 304 — zero spec fetches on the warm run', withTmp(async (dir) => {
  const cold = await runFixtureHarvest(dir);
  const warm = await runFixtureHarvest(dir, { fetch: { listNotModified: true } });
  assert.equal(specCalls(warm.calls).length, 0);
  assert.deepEqual(warm.specStats, { fetched: 0, reused: 7, capped: 0, failed: 0, skipped: 0 });
  assert.deepEqual(warm.records, cold.records);
  const listCall = warm.calls.find((c) => c.url === LIST_URL);
  const inm = listCall.headers['If-None-Match'] ?? listCall.headers['if-none-match'];
  assert.equal(inm, LIST_ETAG);
}));

test('4.2-M04/D-02: prior raw spec fields are reused per record when raw_source.updated is unchanged, re-fetched when it changed', async () => {
  const editPrior = (out, mutate) => {
    const recs = [...readNdjsonRecords(out, { keyFn: rawKey }).values()];
    for (const rec of recs) mutate(rec);
    writeNdjsonStreaming(out, recs, { header: buildHeader('api') });
  };

  {
    const dir = mkdtempSync(join(tmpdir(), 'feeds-'));
    try {
      const { out } = paths(dir);
      await runFixtureHarvest(dir);
      editPrior(out, (rec) => {
        if (rec.origin.source === 'apis.guru' && rec.origin.source_id === 'stripe.com') rec.raw_source.updated = '2023-01-01T00:00:00Z';
      });
      const r = await runFixtureHarvest(dir);
      assert.equal(r.specStats.fetched, 1);
      assert.equal(r.specStats.reused, 6);
      assert.equal(r.specStats.failed, 0);
      const openai = find(r.records, 'apis.guru', 'openai');
      assert.equal(openai.raw_source.spec_skip_reason, 'http_404');
      assert.equal(openai.extra.spec_parsed, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = mkdtempSync(join(tmpdir(), 'feeds-'));
    try {
      const { out } = paths(dir);
      await runFixtureHarvest(dir);
      editPrior(out, (rec) => {
        if (rec.origin.source === 'apis.guru' && rec.origin.source_id === 'adobe.com:aem') rec.raw_source.spec_skip_reason = 'fetch_error';
      });
      const r = await runFixtureHarvest(dir);
      assert.equal(r.specStats.fetched, 0);
      assert.equal(r.specStats.failed, 1);
      assert.equal(r.specStats.reused, 6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('4.2-M04/decision 10: catalog-only mode never writes OUT_PATH; records are marked catalog_only; ids use provider fallback', withTmp(async (dir) => {
  const r = await runFixtureHarvest(dir, { mode: 'catalog-only', outPath: join(dir, 'apis-raw.ndjson') });
  assert.ok(r.outPath.endsWith('.catalog-only.ndjson'), r.outPath);
  assert.ok(existsSync(join(dir, 'apis-raw.catalog-only.ndjson')));
  assert.equal(existsSync(join(dir, 'apis-raw.ndjson')), false);
  const stripe = find(r.records, 'apis.guru', 'stripe');
  assert.equal(stripe.id, 'api:stripe.com/stripe');
  assert.equal(stripe.extra.spec_parsed, false);
  assert.equal(stripe.raw_source.spec_skip_reason, 'catalog_only');
  assert.equal(specCalls(r.calls).length, 0);
}));

test('4.2-M04/Pitfall 1: 5 MB cap, invalid JSON and thrown fetch mark the spec unparsed; checkpoint written', async () => {
  const run = async (extra, check) => {
    const dir = mkdtempSync(join(tmpdir(), 'feeds-'));
    try {
      const r = await runFixtureHarvest(dir, extra);
      await check(r, dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  await run(
    { fetch: { specOverrides: { [specUrlOf('stripe.com')]: { status: 200, chunks: Array.from({ length: 7 }, () => new Uint8Array(MB)) } } } },
    (r) => {
      const stripe = find(r.records, 'apis.guru', 'stripe');
      assert.equal(stripe.extra.spec_parsed, false);
      assert.equal(stripe.raw_source.spec_skip_reason, 'capped');
      assert.equal(r.specStats.capped, 1);
    },
  );
  await run(
    { fetch: { specOverrides: { [specUrlOf('data.gov')]: { status: 200, body: '{not json' } } } },
    (r) => {
      assert.equal(find(r.records, 'apis.guru', 'data').raw_source.spec_skip_reason, 'invalid_json');
    },
  );
  await run(
    { fetch: { specOverrides: { [specUrlOf('adobe.com:aem')]: { throws: true } } }, sleep: async () => {} },
    (r) => {
      assert.equal(find(r.records, 'apis.guru', 'aem').raw_source.spec_skip_reason, 'fetch_error');
    },
  );
  await run({ checkpointEvery: 2 }, (r, dir) => {
    assert.equal(existsSync(paths(dir).partial), true);
  });
  // assignIds is exported for the filter's id-collision tests.
  assert.equal(typeof assignIds, 'function');
});

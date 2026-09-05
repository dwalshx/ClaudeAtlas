/**
 * worker/beh.test.js — behavioral beacon geo/ingest logic tests
 * (quick-260905-fib, L4, BEH-02..04 + PRIV-01..04).
 *
 * The pure logic (isEuCountry / decideActivate / validateBehPayload) takes
 * plain scalars; the handlers take a minimal mock Request + mock env, so these
 * run under plain `node --test` with zero Worker runtime and zero network I/O.
 * Mirror worker/asn-class.test.js + worker/request-log.test.js.
 *
 * NEVER import worker/index.js here — it uses native JSON imports esbuild
 * handles but plain Node cannot. beh.js is pure/self-contained.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EU_EEA_UK,
  isEuCountry,
  decideActivate,
  validateBehPayload,
  handleBehActivate,
  handleBehIngest,
  BEHAVIOR_LOG_DDL,
  BEHAVIOR_LOG_COLUMNS,
} from './beh.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function goodPayload(overrides = {}) {
  return {
    path: '/skills/foo/',
    score: 0.12,
    band: 'human-shaped',
    features: {
      mouse_event_rate: 12,
      has_wheel: true,
      wheel_count: 8,
      teleport_click_ratio: 0.05,
      click_count: 6,
      pointer_move_count: 400,
      keydown_count: 20,
      session_ms: 45000,
      click_duration_spread: 35,
      interaction_total: 850,
    },
    ...overrides,
  };
}

// Mock D1: captures prepare(sql) → bind(...values) → run() chains.
function makeMockDb() {
  const calls = [];
  const db = {
    prepare(sql) {
      const call = { sql, bindArgs: null };
      calls.push(call);
      return {
        bind(...args) {
          call.bindArgs = args;
          return { async run() { return { success: true }; } };
        },
        async run() { return { success: true }; },
      };
    },
  };
  return { db, calls };
}

// Mock ctx that records + awaits waitUntil promises.
function makeCtx() {
  const promises = [];
  return {
    ctx: { waitUntil: (p) => promises.push(p) },
    settle: () => Promise.allSettled(promises),
  };
}

function makeRequest({ method = 'POST', country = 'US', body = null, throwJson = false } = {}) {
  return {
    method,
    cf: { country },
    async json() {
      if (throwJson) throw new Error('bad json');
      return body;
    },
  };
}

// ---------------------------------------------------------------------------
// isEuCountry
// ---------------------------------------------------------------------------

test('isEuCountry: EU/EEA/UK members → true', () => {
  for (const c of ['DE', 'FR', 'GB', 'NO', 'IS', 'LI', 'IE', 'ES', 'IT', 'PL']) {
    assert.equal(isEuCountry(c), true, `${c} should be EU/EEA/UK`);
  }
});

test('isEuCountry: non-EU → false', () => {
  for (const c of ['US', 'CA', 'JP', 'AU', 'BR', 'IN']) {
    assert.equal(isEuCountry(c), false, `${c} should NOT be EU`);
  }
});

test('isEuCountry: null/garbage → false, never throws', () => {
  assert.equal(isEuCountry(null), false);
  assert.equal(isEuCountry(undefined), false);
  assert.equal(isEuCountry(''), false);
  assert.equal(isEuCountry(42), false);
  assert.equal(isEuCountry('de'), false); // case-sensitive: cf.country is uppercase ISO-3166
});

test('EU_EEA_UK is a Set covering 27 EU + IS,LI,NO + GB (31)', () => {
  assert.ok(EU_EEA_UK instanceof Set);
  assert.equal(EU_EEA_UK.size, 31);
  for (const c of ['IS', 'LI', 'NO', 'GB']) assert.ok(EU_EEA_UK.has(c));
});

// ---------------------------------------------------------------------------
// decideActivate
// ---------------------------------------------------------------------------

test('decideActivate: EU country → {activate:false}', () => {
  assert.deepEqual(decideActivate('DE', {}), { activate: false });
  assert.deepEqual(decideActivate('GB', {}), { activate: false });
});

test('decideActivate: US → {activate:true}', () => {
  assert.deepEqual(decideActivate('US', {}), { activate: true });
});

test('decideActivate: feature-flag off → {activate:false} even for US', () => {
  assert.deepEqual(decideActivate('US', { BEH_BEACON_ENABLED: 'false' }), { activate: false });
});

test('decideActivate: default ON when flag unset (only "false" disables)', () => {
  assert.deepEqual(decideActivate('US', {}), { activate: true });
  assert.deepEqual(decideActivate('US', { BEH_BEACON_ENABLED: 'true' }), { activate: true });
  assert.deepEqual(decideActivate('US', undefined), { activate: true });
});

// ---------------------------------------------------------------------------
// validateBehPayload
// ---------------------------------------------------------------------------

test('validateBehPayload: well-formed payload → ok, row has EXACTLY the behavior_log columns', () => {
  const r = validateBehPayload(goodPayload());
  assert.equal(r.ok, true);
  assert.ok(r.row);
  assert.deepEqual(Object.keys(r.row).sort(), [...BEHAVIOR_LOG_COLUMNS].sort());
  assert.equal(r.row.path, '/skills/foo/');
  assert.equal(r.row.band, 'human-shaped');
  assert.equal(r.row.has_wheel, 1); // boolean stored as INTEGER 0/1
  assert.equal(r.row.click_count, 6);
});

test('validateBehPayload: row carries NO identifier (no ip_hash / cookie / nonce / id)', () => {
  const r = validateBehPayload(goodPayload());
  const keys = Object.keys(r.row);
  for (const forbidden of ['ip_hash', 'ip', 'cookie', 'nonce', 'id', 'client_id', 'user_id', 'fingerprint']) {
    assert.ok(!keys.includes(forbidden), `row must not contain ${forbidden}`);
  }
  // And no identifier appears in BEHAVIOR_LOG_COLUMNS itself.
  for (const forbidden of ['ip_hash', 'ip', 'cookie', 'nonce', 'client_id', 'user_id', 'fingerprint']) {
    assert.ok(!BEHAVIOR_LOG_COLUMNS.includes(forbidden), `columns must not contain ${forbidden}`);
  }
});

test('validateBehPayload: rejects non-object / junk', () => {
  assert.equal(validateBehPayload(null).ok, false);
  assert.equal(validateBehPayload(undefined).ok, false);
  assert.equal(validateBehPayload('a string').ok, false);
  assert.equal(validateBehPayload(42).ok, false);
});

test('validateBehPayload: rejects oversize payload', () => {
  const huge = goodPayload({ path: 'x'.repeat(100000) });
  // even after path truncation, an object serializing beyond the cap is rejected
  const bloated = goodPayload();
  bloated.junk = 'y'.repeat(100000);
  assert.equal(validateBehPayload(bloated).ok, false);
  // path is individually truncated on the accepted path, but a giant raw body is rejected up front
  assert.equal(validateBehPayload(huge).ok, false);
});

test('validateBehPayload: rejects invalid band enum', () => {
  assert.equal(validateBehPayload(goodPayload({ band: 'definitely-a-robot' })).ok, false);
  assert.equal(validateBehPayload(goodPayload({ band: 123 })).ok, false);
});

test('validateBehPayload: rejects non-numeric / NaN / Infinity feature fields', () => {
  assert.equal(validateBehPayload(goodPayload({ features: { ...goodPayload().features, click_count: 'lots' } })).ok, false);
  assert.equal(validateBehPayload(goodPayload({ features: { ...goodPayload().features, mouse_event_rate: Infinity } })).ok, false);
  assert.equal(validateBehPayload(goodPayload({ features: { ...goodPayload().features, session_ms: NaN } })).ok, false);
});

test('validateBehPayload: clamps out-of-range numbers to sane bounds', () => {
  const r = validateBehPayload(goodPayload({
    score: 5, // >1 → clamp to 1
    features: {
      ...goodPayload().features,
      teleport_click_ratio: 9, // >1 → clamp to 1
      click_count: -3, // <0 → clamp to 0
    },
  }));
  assert.equal(r.ok, true);
  assert.equal(r.row.score, 1);
  assert.equal(r.row.teleport_click_ratio, 1);
  assert.equal(r.row.click_count, 0);
});

test('validateBehPayload: truncates path to <=256 chars', () => {
  const r = validateBehPayload(goodPayload({ path: '/x'.repeat(500) }));
  // 1000-char path is under the whole-body cap but truncated at the field level
  assert.equal(r.ok, true);
  assert.ok(r.row.path.length <= 256);
});

// ---------------------------------------------------------------------------
// handleBehActivate
// ---------------------------------------------------------------------------

test('handleBehActivate: US → {activate:true}, cache-control no-store', async () => {
  const res = await handleBehActivate(makeRequest({ method: 'GET', country: 'US' }), {});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.activate, true);
});

test('handleBehActivate: EU → {activate:false}, no-store (never cached per-country)', async () => {
  const res = await handleBehActivate(makeRequest({ method: 'GET', country: 'DE' }), {});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.activate, false);
});

// ---------------------------------------------------------------------------
// handleBehIngest
// ---------------------------------------------------------------------------

test('handleBehIngest: valid US POST → one INSERT INTO behavior_log, fast 2xx', async () => {
  const { db, calls } = makeMockDb();
  const { ctx, settle } = makeCtx();
  const res = await handleBehIngest(makeRequest({ country: 'US', body: goodPayload() }), { DB: db }, ctx);
  assert.ok(res.status >= 200 && res.status < 300);
  await settle();
  const inserts = calls.filter((c) => /^INSERT INTO behavior_log/i.test(c.sql));
  assert.equal(inserts.length, 1);
  const bind = inserts[0].bindArgs;
  assert.equal(bind.length, BEHAVIOR_LOG_COLUMNS.length);
  const byCol = Object.fromEntries(BEHAVIOR_LOG_COLUMNS.map((c, i) => [c, bind[i]]));
  assert.equal(byCol.country, 'US');
  assert.equal(byCol.band, 'human-shaped');
  assert.equal(typeof byCol.timestamp, 'number');
  // no raw identifier bound
  assert.ok(!bind.includes('ip_hash'));
});

test('handleBehIngest: EU POST is DROPPED — no DB write, still fast 2xx (defense in depth)', async () => {
  const { db, calls } = makeMockDb();
  const { ctx, settle } = makeCtx();
  const res = await handleBehIngest(makeRequest({ country: 'DE', body: goodPayload() }), { DB: db }, ctx);
  assert.ok(res.status >= 200 && res.status < 300);
  await settle();
  assert.equal(calls.filter((c) => /^INSERT INTO behavior_log/i.test(c.sql)).length, 0, 'EU POST must not write to D1');
});

test('handleBehIngest: invalid payload → no DB write, fast 2xx, never throws', async () => {
  const { db, calls } = makeMockDb();
  const { ctx, settle } = makeCtx();
  const res = await handleBehIngest(makeRequest({ country: 'US', body: { band: 'nonsense' } }), { DB: db }, ctx);
  assert.ok(res.status >= 200 && res.status < 300);
  await settle();
  assert.equal(calls.filter((c) => /^INSERT INTO behavior_log/i.test(c.sql)).length, 0);
});

test('handleBehIngest: malformed JSON body → fast 2xx, no throw, no write', async () => {
  const { db, calls } = makeMockDb();
  const { ctx, settle } = makeCtx();
  const res = await handleBehIngest(makeRequest({ country: 'US', throwJson: true }), { DB: db }, ctx);
  assert.ok(res.status >= 200 && res.status < 300);
  await settle();
  assert.equal(calls.filter((c) => /^INSERT INTO behavior_log/i.test(c.sql)).length, 0);
});

test('handleBehIngest: env.DB absent → still fast 2xx, never throws', async () => {
  const { ctx, settle } = makeCtx();
  const res = await handleBehIngest(makeRequest({ country: 'US', body: goodPayload() }), {}, ctx);
  assert.ok(res.status >= 200 && res.status < 300);
  await settle();
});

test('handleBehIngest: lazy CREATE on "no such table", retries insert once', async () => {
  const calls = [];
  let insertAttempts = 0;
  const db = {
    prepare(sql) {
      const call = { sql, bindArgs: null };
      calls.push(call);
      return {
        bind(...args) {
          call.bindArgs = args;
          return {
            async run() {
              if (/^INSERT INTO behavior_log/i.test(sql)) {
                insertAttempts += 1;
                if (insertAttempts === 1) throw new Error('D1_ERROR: no such table: behavior_log');
              }
              return { success: true };
            },
          };
        },
        async run() { return { success: true }; },
      };
    },
  };
  const { ctx, settle } = makeCtx();
  await handleBehIngest(makeRequest({ country: 'US', body: goodPayload() }), { DB: db }, ctx);
  await settle();
  const ddl = calls.filter((c) => /^CREATE (TABLE|INDEX) IF NOT EXISTS/i.test(c.sql));
  assert.ok(ddl.some((c) => /CREATE TABLE IF NOT EXISTS behavior_log/i.test(c.sql)), 'must create behavior_log');
  assert.equal(insertAttempts, 2, 'insert retried exactly once');
});

// ---------------------------------------------------------------------------
// DDL / columns exports
// ---------------------------------------------------------------------------

test('BEHAVIOR_LOG_DDL creates behavior_log with has_wheel INTEGER + a timestamp index, NO identifier', () => {
  assert.ok(Array.isArray(BEHAVIOR_LOG_DDL));
  const joined = BEHAVIOR_LOG_DDL.join('\n');
  assert.match(joined, /CREATE TABLE IF NOT EXISTS behavior_log/i);
  assert.match(joined, /has_wheel\s+INTEGER/i);
  assert.match(joined, /CREATE INDEX IF NOT EXISTS .*behavior_log\(timestamp\)/i);
  assert.ok(!/ip_hash|\bip\b|cookie|nonce|fingerprint|user_id|client_id/i.test(joined), 'DDL must carry no identifier column');
});

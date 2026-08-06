/**
 * worker/request-log.test.js — buildLogRow + logRequest tests
 * (quick-260806-dn3, E1).
 *
 * NEVER import worker/index.js here — it uses native JSON imports that
 * esbuild handles but plain Node cannot. request-log.js is pure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLogRow,
  logRequest,
  REQUEST_LOG_COLUMNS,
  _resetMigrationAttempted,
  _resetColumnMigrationAttempted,
} from './request-log.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const RAW_IP = '203.0.113.77';

function makeRequest(overrides = {}) {
  return {
    url: 'https://claudeatlas.com/skills/foo/bar/?utm_source=secret-query',
    method: 'GET',
    headers: new Headers({
      'user-agent': 'GPTBot/1.0',
      accept: 'text/html',
      'cf-connecting-ip': RAW_IP,
    }),
    cf: { asn: 16509, asOrganization: 'AMAZON-02', country: 'US' },
    ...overrides,
  };
}

function makeResponse(status = 200) {
  return { status };
}

// Mock D1: captures prepare(sql) → bind(...values) → run() chains.
function makeMockDb({ failFirstInsertWith = null, alwaysThrow = null } = {}) {
  const calls = [];
  let insertAttempts = 0;
  const db = {
    prepare(sql) {
      if (alwaysThrow) throw alwaysThrow;
      const call = { sql, bindArgs: null };
      calls.push(call);
      return {
        bind(...args) {
          call.bindArgs = args;
          return {
            async run() {
              if (/^INSERT INTO request_log/i.test(sql)) {
                insertAttempts += 1;
                if (failFirstInsertWith && insertAttempts === 1) {
                  throw failFirstInsertWith;
                }
              }
              return { success: true };
            },
          };
        },
        // DDL path uses prepare(sql).run() without bind.
        async run() {
          return { success: true };
        },
      };
    },
  };
  return { db, calls, insertAttempts: () => insertAttempts };
}

// ---------------------------------------------------------------------------
// buildLogRow
// ---------------------------------------------------------------------------

test('buildLogRow covers all 19 request_log columns', () => {
  const row = buildLogRow({
    path: '/skills/foo/',
    method: 'GET',
    status: 200,
    headers: new Headers({ 'user-agent': 'GPTBot/1.0', accept: 'text/html' }),
    cf: { asn: 16509, asOrganization: 'AMAZON-02', country: 'US' },
    classification: {
      class: 'crawler',
      operator: 'openai',
      confidence: 0.9,
      method: 'ua_list',
      secFetchCoherent: null,
    },
    wba: { status: 'absent', signer: null },
    ipHash: 'abc123',
  });

  assert.equal(REQUEST_LOG_COLUMNS.length, 19);
  for (const col of REQUEST_LOG_COLUMNS) {
    assert.ok(col in row, `row missing column ${col}`);
  }
  assert.equal(Object.keys(row).length, 19);
  assert.equal(row.path, '/skills/foo/');
  assert.equal(row.class, 'crawler');
  assert.equal(row.operator, 'openai');
  assert.equal(row.wba_status, 'absent');
  assert.equal(row.ip_hash, 'abc123');
  assert.equal(typeof row.timestamp, 'number');
});

test('buildLogRow truncates user_agent and accept_header to 256 chars', () => {
  const longUa = 'X'.repeat(1000);
  const row = buildLogRow({
    path: '/',
    method: 'GET',
    status: 200,
    headers: new Headers({ 'user-agent': longUa, accept: longUa }),
    cf: {},
    classification: { class: 'unknown', operator: null, confidence: 0.3, method: 'default' },
    wba: { status: 'absent', signer: null },
    ipHash: null,
  });
  assert.equal(row.user_agent.length, 256);
  assert.equal(row.accept_header.length, 256);
});

test('buildLogRow never contains a raw IP anywhere', () => {
  const row = buildLogRow({
    path: '/',
    method: 'GET',
    status: 200,
    headers: new Headers({
      'user-agent': 'test',
      'cf-connecting-ip': RAW_IP,
      'x-forwarded-for': RAW_IP,
    }),
    cf: { asn: 7922, asOrganization: 'COMCAST', country: 'US' },
    classification: { class: 'unknown', operator: null, confidence: 0.3, method: 'default' },
    wba: { status: 'absent', signer: null },
    ipHash: 'hashed-value',
  });
  assert.ok(!JSON.stringify(row).includes(RAW_IP), 'raw IP leaked into log row');
});

// ---------------------------------------------------------------------------
// logRequest
// ---------------------------------------------------------------------------

test('logRequest executes exactly one INSERT INTO request_log; path excludes query string', async () => {
  _resetMigrationAttempted();
  const { db, calls, insertAttempts } = makeMockDb();
  await logRequest(makeRequest(), makeResponse(200), { DB: db }, {
    hashIp: async () => 'hashed-ip',
  });

  const inserts = calls.filter((c) => /^INSERT INTO request_log/i.test(c.sql));
  assert.equal(inserts.length, 1);
  assert.equal(insertAttempts(), 1);

  const bind = inserts[0].bindArgs;
  assert.equal(bind.length, 19);
  // Column order: match REQUEST_LOG_COLUMNS positions.
  const byCol = Object.fromEntries(REQUEST_LOG_COLUMNS.map((c, i) => [c, bind[i]]));
  assert.equal(byCol.path, '/skills/foo/bar/', 'query string must be stripped');
  assert.equal(byCol.method, 'GET');
  assert.equal(byCol.status, 200);
  assert.equal(byCol.user_agent, 'GPTBot/1.0');
  assert.equal(byCol.asn, 16509);
  assert.equal(byCol.as_org, 'AMAZON-02');
  assert.equal(byCol.country, 'US');
  assert.equal(byCol.class, 'crawler');
  assert.equal(byCol.operator, 'openai');
  assert.equal(byCol.wba_status, 'absent');
  assert.equal(byCol.ip_hash, 'hashed-ip');
  assert.ok(!bind.includes(RAW_IP), 'raw IP must never be bound');
});

test('logRequest with env.DB.prepare throwing resolves without throwing', async () => {
  _resetMigrationAttempted();
  const { db } = makeMockDb({ alwaysThrow: new Error('D1 exploded') });
  await assert.doesNotReject(
    logRequest(makeRequest(), makeResponse(500), { DB: db }, { hashIp: async () => 'h' })
  );
});

test('logRequest with env.DB absent is a no-op that resolves', async () => {
  _resetMigrationAttempted();
  await assert.doesNotReject(logRequest(makeRequest(), makeResponse(200), {}, {}));
  await assert.doesNotReject(logRequest(makeRequest(), makeResponse(200), null, {}));
});

test('logRequest with hashIp rejecting still resolves', async () => {
  _resetMigrationAttempted();
  const { db } = makeMockDb();
  await assert.doesNotReject(
    logRequest(makeRequest(), makeResponse(200), { DB: db }, {
      hashIp: async () => {
        throw new Error('salt unavailable');
      },
    })
  );
});

// ---------------------------------------------------------------------------
// Self-migration (orchestrator deviation, 2026-08-06): the .env API token
// can't run remote DDL, so the worker lazily creates request_log via its
// own D1 binding on first "no such table" error, then retries once.
// ---------------------------------------------------------------------------

test('no such table → runs DDL via env.DB, retries insert once, succeeds', async () => {
  _resetMigrationAttempted();
  const { db, calls, insertAttempts } = makeMockDb({
    failFirstInsertWith: new Error('D1_ERROR: no such table: request_log'),
  });
  await logRequest(makeRequest(), makeResponse(200), { DB: db }, {
    hashIp: async () => 'h',
  });

  const ddl = calls.filter((c) => /^CREATE (TABLE|INDEX) IF NOT EXISTS/i.test(c.sql));
  assert.ok(
    ddl.some((c) => /CREATE TABLE IF NOT EXISTS request_log/i.test(c.sql)),
    'must create request_log table'
  );
  assert.equal(ddl.length, 3, 'table + two indexes');
  assert.equal(insertAttempts(), 2, 'insert retried exactly once');
});

test('migration attempted at most once per isolate', async () => {
  _resetMigrationAttempted();
  const err = new Error('no such table: request_log');
  // DB that ALWAYS fails inserts with "no such table" — first call attempts
  // migration + retry; second call must NOT re-run DDL.
  const calls = [];
  const db = {
    prepare(sql) {
      const call = { sql };
      calls.push(call);
      return {
        bind() {
          return {
            async run() {
              if (/^INSERT/i.test(sql)) throw err;
              return { success: true };
            },
          };
        },
        async run() {
          return { success: true };
        },
      };
    },
  };
  await logRequest(makeRequest(), makeResponse(200), { DB: db }, { hashIp: async () => 'h' });
  const ddlCountAfterFirst = calls.filter((c) => /^CREATE/i.test(c.sql)).length;
  assert.equal(ddlCountAfterFirst, 3);
  await logRequest(makeRequest(), makeResponse(200), { DB: db }, { hashIp: async () => 'h' });
  const ddlCountAfterSecond = calls.filter((c) => /^CREATE/i.test(c.sql)).length;
  assert.equal(ddlCountAfterSecond, 3, 'DDL must not run again');
});

test('non-table insert errors do not trigger migration', async () => {
  _resetMigrationAttempted();
  _resetColumnMigrationAttempted();
  const { db, calls } = makeMockDb({
    failFirstInsertWith: new Error('D1_ERROR: too many requests'),
  });
  await assert.doesNotReject(
    logRequest(makeRequest(), makeResponse(200), { DB: db }, { hashIp: async () => 'h' })
  );
  assert.equal(calls.filter((c) => /^CREATE|^ALTER/i.test(c.sql)).length, 0);
});

// ---------------------------------------------------------------------------
// E3 (quick-260806-ejd): agent_token capture + "no such column" lazy
// ALTER TABLE migration. request_log already exists in production with the
// v1 (18-column) shape by the time this deploys — the ALTER path is the
// LIVE-DB migration.
// ---------------------------------------------------------------------------

test('buildLogRow captures x-claudeatlas-agent into agent_token (truncated to 256)', () => {
  const row = buildLogRow({
    path: '/',
    method: 'GET',
    status: 200,
    headers: new Headers({
      'user-agent': 'test',
      'x-claudeatlas-agent': 'ca-0123456789abcdef0123456789abcdef; tool=verify-curl',
    }),
    cf: {},
    classification: { class: 'agent', operator: 'verify-curl', confidence: 0.95, method: 'token_echo' },
    wba: { status: 'absent', signer: null },
    ipHash: null,
  });
  assert.equal(row.agent_token, 'ca-0123456789abcdef0123456789abcdef; tool=verify-curl');

  const longToken = 'ca-' + 'x'.repeat(1000);
  const long = buildLogRow({
    path: '/',
    method: 'GET',
    status: 200,
    headers: new Headers({ 'user-agent': 'test', 'x-claudeatlas-agent': longToken }),
    cf: {},
    classification: { class: 'agent', operator: null, confidence: 0.95, method: 'token_echo' },
    wba: { status: 'absent', signer: null },
    ipHash: null,
  });
  assert.equal(long.agent_token.length, 256);
});

test('buildLogRow: absent x-claudeatlas-agent header → agent_token null', () => {
  const row = buildLogRow({
    path: '/',
    method: 'GET',
    status: 200,
    headers: new Headers({ 'user-agent': 'test' }),
    cf: {},
    classification: { class: 'unknown', operator: null, confidence: 0.3, method: 'default' },
    wba: { status: 'absent', signer: null },
    ipHash: null,
  });
  assert.equal(row.agent_token, null);
});

test('logRequest feeds the echoed token into the classifier (class=agent token_echo bound)', async () => {
  _resetMigrationAttempted();
  _resetColumnMigrationAttempted();
  const { db, calls } = makeMockDb();
  const request = makeRequest({
    headers: new Headers({
      'user-agent': 'python-requests/2.31',
      'x-claudeatlas-agent': 'ca-abc; tool=my-agent',
      'cf-connecting-ip': RAW_IP,
    }),
  });
  await logRequest(request, makeResponse(200), { DB: db }, { hashIp: async () => 'h' });
  const insert = calls.find((c) => /^INSERT INTO request_log/i.test(c.sql));
  const byCol = Object.fromEntries(REQUEST_LOG_COLUMNS.map((c, i) => [c, insert.bindArgs[i]]));
  assert.equal(byCol.class, 'agent');
  assert.equal(byCol.classifier_method, 'token_echo');
  assert.equal(byCol.operator, 'my-agent');
  assert.equal(byCol.agent_token, 'ca-abc; tool=my-agent');
});

test('no such column agent_token → ALTER TABLE via env.DB, retries insert once, succeeds', async () => {
  _resetMigrationAttempted();
  _resetColumnMigrationAttempted();
  const { db, calls, insertAttempts } = makeMockDb({
    failFirstInsertWith: new Error('D1_ERROR: table request_log has no column named agent_token: no such column: agent_token'),
  });
  await logRequest(makeRequest(), makeResponse(200), { DB: db }, { hashIp: async () => 'h' });

  const alters = calls.filter((c) => /^ALTER TABLE request_log ADD COLUMN agent_token/i.test(c.sql));
  assert.equal(alters.length, 1, 'exactly one ALTER TABLE');
  assert.equal(calls.filter((c) => /^CREATE/i.test(c.sql)).length, 0, 'table DDL must not run');
  assert.equal(insertAttempts(), 2, 'insert retried exactly once');
});

test('column migration attempted at most once per isolate; repeat failure lands in outer catch', async () => {
  _resetMigrationAttempted();
  _resetColumnMigrationAttempted();
  const err = new Error('no such column: agent_token');
  const calls = [];
  // DB that ALWAYS fails inserts with "no such column" — first call attempts
  // ALTER + retry (retry fails → outer catch); second call must NOT re-ALTER.
  const db = {
    prepare(sql) {
      const call = { sql };
      calls.push(call);
      return {
        bind() {
          return {
            async run() {
              if (/^INSERT/i.test(sql)) throw err;
              return { success: true };
            },
          };
        },
        async run() {
          return { success: true };
        },
      };
    },
  };
  await assert.doesNotReject(
    logRequest(makeRequest(), makeResponse(200), { DB: db }, { hashIp: async () => 'h' })
  );
  const altersAfterFirst = calls.filter((c) => /^ALTER/i.test(c.sql)).length;
  assert.equal(altersAfterFirst, 1);
  await assert.doesNotReject(
    logRequest(makeRequest(), makeResponse(200), { DB: db }, { hashIp: async () => 'h' })
  );
  const altersAfterSecond = calls.filter((c) => /^ALTER/i.test(c.sql)).length;
  assert.equal(altersAfterSecond, 1, 'ALTER must not run again');
});

/**
 * worker/request-log.js — per-request D1 logging (quick-260806-dn3, E1).
 *
 * buildLogRow: pure assembly of one request_log row (18 columns).
 * logRequest:  orchestrator — classify (worker/classify.js), Web Bot Auth
 *              (worker/web-bot-auth.js), hash IP via injected closure, one
 *              D1 INSERT.
 *
 * Contract: logRequest NEVER throws or rejects. It runs exclusively inside
 * ctx.waitUntil (see worker/index.js) and can never delay or break a
 * response. All failure modes are console.error + resolve.
 *
 * Privacy: the row carries ip_hash ONLY (daily-salted SHA-256 via the
 * hashedClientIp closure index.js injects — the salt logic is NOT
 * duplicated here). Path excludes the query string (queries can carry user
 * text; search_events already logs search queries separately).
 *
 * Volume/retention: ~98k rows/day at current traffic — within D1 paid
 * row-write limits (50M/mo). Retention purge deliberately deferred to a
 * follow-up task (see worker/schema.sql).
 */

import { classifyRequest, computeSecFetchCoherence } from './classify.js';
import { verifyWebBotAuth } from './web-bot-auth.js';

// Column order for INSERT binds. Mirrors worker/schema.sql (minus the
// autoincrement id).
export const REQUEST_LOG_COLUMNS = [
  'timestamp',
  'path',
  'method',
  'status',
  'user_agent',
  'asn',
  'as_org',
  'country',
  'accept_header',
  'sec_fetch_coherent',
  'class',
  'operator',
  'confidence',
  'classifier_method',
  'signature_agent',
  'wba_status',
  'wba_signer',
  'ip_hash',
  'agent_token', // E3 (quick-260806-ejd): echoed X-ClaudeAtlas-Agent value
  'mcp_client', // E4 (quick-260806-f00): MCP initialize clientInfo (x-ca-mcp-client marker)
];

const INSERT_SQL = `INSERT INTO request_log (${REQUEST_LOG_COLUMNS.join(', ')}) VALUES (${REQUEST_LOG_COLUMNS.map(() => '?').join(', ')})`;

// ---------------------------------------------------------------------------
// Lazy self-migration (orchestrator deviation, 2026-08-06).
//
// The .env CF_API_TOKEN lacks D1 write/edit permission, so the request_log
// DDL could not be applied via the REST API (scripts/apply-d1-schema.js is
// kept for future use once a D1-Edit token exists). The Worker's own DB
// binding has full database access, so on the FIRST "no such table" insert
// error we run the DDL right here and retry the insert exactly once.
//
// DDL strings are kept IN SYNC with worker/schema.sql — that file remains
// the source of truth; this is an import-free duplicate because schema.sql
// can't be imported from Worker code.
// ---------------------------------------------------------------------------
export const REQUEST_LOG_DDL = [
  `CREATE TABLE IF NOT EXISTS request_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  path TEXT,
  method TEXT,
  status INTEGER,
  user_agent TEXT,
  asn INTEGER,
  as_org TEXT,
  country TEXT,
  accept_header TEXT,
  sec_fetch_coherent INTEGER,
  class TEXT NOT NULL,
  operator TEXT,
  confidence REAL,
  classifier_method TEXT,
  signature_agent TEXT,
  wba_status TEXT,
  wba_signer TEXT,
  ip_hash TEXT,
  agent_token TEXT,
  mcp_client TEXT
)`,
  'CREATE INDEX IF NOT EXISTS idx_request_log_timestamp ON request_log(timestamp)',
  'CREATE INDEX IF NOT EXISTS idx_request_log_class ON request_log(class)',
];

// E3 (quick-260806-ejd): lazy column migration for the LIVE database.
// request_log already exists in production with the v1 (18-column) shape by
// the time this ships, so the "no such table" path never fires there — the
// first insert instead fails with "no such column: agent_token", and we
// ALTER the live table via the Worker's own DB binding, then retry once.
const AGENT_TOKEN_MIGRATION_SQL =
  'ALTER TABLE request_log ADD COLUMN agent_token TEXT';

// E4 (quick-260806-f00): generalized column-migration list. On the FIRST
// "no such column" insert error we attempt EVERY pending ALTER — columns
// the live table already has fail with "duplicate column", which is
// swallowed (and ONLY that) so the loop is idempotent against any prior
// live-DB shape (e.g. agent_token already added by the E3 deploy).
const COLUMN_MIGRATIONS = [
  AGENT_TOKEN_MIGRATION_SQL,
  'ALTER TABLE request_log ADD COLUMN mcp_client TEXT',
];

// At-most-once-per-isolate guard for the DDL path.
let migrationAttempted = false;

// At-most-once-per-isolate guard for the agent_token column migration
// (separate flag — mirrors migrationAttempted).
let columnMigrationAttempted = false;

// Test hook — resets the module-level migration flag between test cases.
export function _resetMigrationAttempted() {
  migrationAttempted = false;
}

// Test hook — resets the column-migration flag between test cases.
export function _resetColumnMigrationAttempted() {
  columnMigrationAttempted = false;
}

function truncate(value, max = 256) {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

/**
 * buildLogRow({ path, method, status, headers, cf, classification, wba,
 * ipHash }) → plain object mirroring the 18 request_log columns.
 *
 * `classification` is the classifyRequest verdict plus `secFetchCoherent`
 * (computed from the same signals). `wba` is the verifyWebBotAuth outcome.
 * NO raw IP ever enters the row — only the injected ipHash.
 */
export function buildLogRow({ path, method, status, headers, cf, classification, wba, ipHash, mcpClient }) {
  const get = (name) =>
    headers && typeof headers.get === 'function' ? headers.get(name) : null;
  const c = classification || {};
  const w = wba || {};
  const cfObj = cf || {};

  return {
    timestamp: Date.now(),
    path: typeof path === 'string' ? path : null,
    method: typeof method === 'string' ? method : null,
    status: typeof status === 'number' ? status : null,
    user_agent: truncate(get('user-agent')),
    asn: typeof cfObj.asn === 'number' ? cfObj.asn : null,
    as_org: typeof cfObj.asOrganization === 'string' ? cfObj.asOrganization : null,
    country: typeof cfObj.country === 'string' ? cfObj.country : null,
    accept_header: truncate(get('accept')),
    sec_fetch_coherent: c.secFetchCoherent ?? null,
    class: c.class || 'unknown',
    operator: c.operator ?? null,
    confidence: c.confidence ?? null,
    classifier_method: c.method ?? null,
    signature_agent: truncate(get('signature-agent')),
    wba_status: w.status || 'absent',
    wba_signer: w.signer ?? null,
    ip_hash: ipHash ?? null,
    // E3: echoed X-ClaudeAtlas-Agent value (random per-request token +
    // optional '; tool=<name>' suffix). Carries no PII by construction.
    agent_token: truncate(get('x-claudeatlas-agent')),
    // E4: MCP initialize clientInfo ('<name>/<version>', read off the
    // RESPONSE's x-ca-mcp-client marker in logRequest). Nullable, no PII —
    // the client volunteered it.
    mcp_client: truncate(mcpClient),
  };
}

/**
 * logRequest(request, response, env, deps?) — one classified D1 row per
 * origin-reaching request. deps.hashIp is the hashedClientIp closure
 * injected by worker/index.js (keeps this module pure/testable).
 */
export async function logRequest(request, response, env, deps = {}) {
  try {
    if (!env || !env.DB) return;

    const headers = request.headers;
    const get = (name) =>
      headers && typeof headers.get === 'function' ? headers.get(name) : null;
    const cf = request.cf || {};
    const url = new URL(request.url);

    // E4: MCP marker headers live on the RESPONSE (worker/mcp.js sets
    // x-ca-mcp / x-ca-mcp-client only for structurally valid JSON-RPC
    // bodies) — the in-band channel from the response path to this
    // waitUntil logger.
    const respGet = (name) =>
      response && response.headers && typeof response.headers.get === 'function'
        ? response.headers.get(name)
        : null;
    const mcpClient = respGet('x-ca-mcp-client');

    const signals = {
      userAgent: get('user-agent'),
      asn: typeof cf.asn === 'number' ? cf.asn : null,
      asOrg: cf.asOrganization ?? null,
      accept: get('accept'),
      secFetchMode: get('sec-fetch-mode'),
      secFetchSite: get('sec-fetch-site'),
      secFetchDest: get('sec-fetch-dest'),
      secChUa: get('sec-ch-ua'),
      signatureAgent: get('signature-agent'),
      agentToken: get('x-claudeatlas-agent'), // E3 token echo → rule 0
      mcpValid: respGet('x-ca-mcp') === '1', // E4 MCP front door → rule 0.5
      mcpClient,
    };

    const verdict = classifyRequest(signals);
    const secFetchCoherent = computeSecFetchCoherence(signals);

    // E5: Web Bot Auth check — INSIDE the waitUntil path, never the
    // response path. Zero network when no signature headers are present.
    const wba = await verifyWebBotAuth(headers, deps.wbaOpts);

    let ipHash = null;
    if (typeof deps.hashIp === 'function') {
      try {
        ipHash = await deps.hashIp();
      } catch (err) {
        console.error('request-log hashIp error:', err && err.message);
      }
    }

    const row = buildLogRow({
      path: url.pathname, // pathname ONLY — query strings can carry user text
      method: request.method,
      status: response ? response.status : null,
      headers,
      cf,
      classification: { ...verdict, secFetchCoherent },
      wba,
      ipHash,
      mcpClient,
    });
    const values = REQUEST_LOG_COLUMNS.map((col) => row[col]);

    try {
      await env.DB.prepare(INSERT_SQL).bind(...values).run();
    } catch (err) {
      const message = String((err && err.message) || '');
      if (!migrationAttempted && /no such table/i.test(message)) {
        // Lazy self-migration: create the table via the Worker's own DB
        // binding, then retry the insert exactly once.
        migrationAttempted = true;
        for (const stmt of REQUEST_LOG_DDL) {
          await env.DB.prepare(stmt).run();
        }
        await env.DB.prepare(INSERT_SQL).bind(...values).run();
      } else if (!columnMigrationAttempted && /no such column/i.test(message)) {
        // E3/E4 lazy column migration (the LIVE-DB path): the pre-existing
        // request_log table lacks one or more of the newer columns — run
        // EVERY pending ALTER via the Worker's own DB binding (swallowing
        // ONLY "duplicate column" for columns the live table already has,
        // e.g. agent_token after the E3 deploy), then retry the insert
        // exactly once. A failing retry throws to the outer catch (logged,
        // never rethrown).
        columnMigrationAttempted = true;
        for (const migrationSql of COLUMN_MIGRATIONS) {
          try {
            await env.DB.prepare(migrationSql).run();
          } catch (migErr) {
            const migMessage = String((migErr && migErr.message) || '');
            if (!/duplicate column/i.test(migMessage)) throw migErr;
          }
        }
        await env.DB.prepare(INSERT_SQL).bind(...values).run();
      } else {
        throw err; // handed to the outer catch — logged, never rethrown
      }
    }
  } catch (err) {
    console.error('request-log error:', err && err.message);
  }
}

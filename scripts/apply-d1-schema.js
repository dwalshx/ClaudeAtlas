#!/usr/bin/env node
/**
 * scripts/apply-d1-schema.js — one-shot remote D1 DDL via the Cloudflare
 * REST API (quick-260806-dn3, Task 1).
 *
 * Wrangler cannot run on this machine (workerd has no win32-arm64 build), so
 * `wrangler d1 execute --file=worker/schema.sql --remote` is unavailable.
 * This script POSTs the schema straight to the D1 HTTP query endpoint
 * instead, then lists tables to confirm the DDL landed.
 *
 * Usage:
 *   node --env-file=.env scripts/apply-d1-schema.js
 *
 * Required env (in .env):
 *   CF_API_TOKEN   — API token with D1 edit permission
 *   CF_ACCOUNT_ID  — Cloudflare account id
 *
 * The whole schema file is IF-NOT-EXISTS, so re-running is idempotent.
 *
 * Note: readFileSync on worker/schema.sql is fine — the banned-pattern rule
 * (check-banned-patterns.js) covers unbounded files under data/ only; the
 * schema is a small bounded source file.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// claudeatlas-search-log — same database wrangler.toml binds as DB.
const DATABASE_ID = 'd4e341fa-17d6-4069-8a00-3b6a8d698ab9';

const { CF_API_TOKEN, CF_ACCOUNT_ID } = process.env;

if (!CF_API_TOKEN || !CF_ACCOUNT_ID) {
  console.error(
    'Missing CF_API_TOKEN and/or CF_ACCOUNT_ID. Run with:\n' +
      '  node --env-file=.env scripts/apply-d1-schema.js'
  );
  process.exit(1);
}

const QUERY_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;

async function d1Query(sql) {
  const res = await fetch(QUERY_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${CF_API_TOKEN}`,
    },
    body: JSON.stringify({ sql }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.success === false) {
    const detail = json && json.errors ? JSON.stringify(json.errors) : `HTTP ${res.status}`;
    throw new Error(`D1 query failed: ${detail}`);
  }
  return json;
}

// Split a schema file into individual statements. The D1 /query endpoint
// rejects the raw multi-statement file (observed: error 7500 for the full
// worker/schema.sql payload while every single statement succeeds), so we
// strip `--` comments and execute statement-by-statement.
export function splitSqlStatements(sql) {
  const noComments = sql
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
  return noComments
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const schemaPath = resolve(REPO_ROOT, 'worker', 'schema.sql');
  const sql = readFileSync(schemaPath, 'utf-8');

  console.log(`Applying ${schemaPath} to remote D1 database ${DATABASE_ID} ...`);
  const statements = splitSqlStatements(sql);
  for (const [i, stmt] of statements.entries()) {
    await d1Query(stmt);
    console.log(`  [${i + 1}/${statements.length}] ok: ${stmt.slice(0, 60).replace(/\s+/g, ' ')}...`);
  }
  console.log('Schema applied (all statements IF NOT EXISTS — idempotent).');

  const listing = await d1Query(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  );
  const tables = (listing.result || [])
    .flatMap((r) => r.results || [])
    .map((row) => row.name);
  console.log('Remote tables:');
  for (const t of tables) console.log(`  - ${t}`);

  if (!tables.includes('request_log')) {
    console.error('ERROR: request_log table not found after applying schema.');
    process.exit(1);
  }
  console.log('OK: request_log present on remote D1.');
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});

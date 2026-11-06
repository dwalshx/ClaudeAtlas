#!/usr/bin/env node
/**
 * ClaudeAtlas — GitHub token preflight.
 *
 * Verifies, BEFORE any scrape step runs, that the PATs the pipeline depends
 * on are alive, and warns when one is about to expire. Exists because the
 * fine-grained SCRAPE_PAT silently expired on 2026-10-14 and the daily cron
 * failed for 39 days before anyone noticed (debug artifact:
 * .planning/debug/daily-scrape-outage-2026-09-28.md).
 *
 * Checks (one GET /rate_limit per token; /rate_limit needs no permission and
 * does not count against the primary limit):
 *   SCRAPE_PAT          — fine-grained PAT; REST discovery (Track 2, plugins,
 *                         weekly code search). Must return 200.
 *   SCRAPE_PAT_CLASSIC  — classic PAT; GraphQL star pulse (Track 1) + plugin
 *                         engagement refresh. Must return 200 on REST AND on a
 *                         trivial GraphQL `{ viewer { login } }` POST.
 *
 * Logged per token: HTTP status, the `github-authentication-token-expiration`
 * header (absent = never expires), days remaining, core rate-limit remaining.
 * NEVER logs token material (not even a prefix).
 *
 * Exit codes: 0 all good (warnings allowed), 1 any token missing/rejected.
 *
 * Env:
 *   SCRAPE_PAT, SCRAPE_PAT_CLASSIC — the tokens (CI passes the secrets through)
 *   TOKEN_WARN_DAYS                — warn threshold, default 14
 *
 * CLI:
 *   --skip-graphql   do not probe the GraphQL endpoint (local use)
 *
 * Pure helper `assessToken()` is exported for unit tests.
 */

import { fileURLToPath } from 'url';

const REST_URL = 'https://api.github.com/rate_limit';
const GRAPHQL_URL = 'https://api.github.com/graphql';
const EXPIRY_HEADER = 'github-authentication-token-expiration';
const DEFAULT_WARN_DAYS = 14;

// Secrets the daily pipeline cannot run without, with the API surface each
// one authenticates. `graphql: true` adds the viewer probe.
export const REQUIRED_TOKENS = [
  { name: 'SCRAPE_PAT', purpose: 'REST discovery (Track 2 repo search, plugin + weekly code search)', graphql: false },
  { name: 'SCRAPE_PAT_CLASSIC', purpose: 'GraphQL star pulse (Track 1) + plugin engagement refresh', graphql: true },
];

/**
 * Parse GitHub's expiration header. Observed format: "2026-10-14 20:37:52 UTC".
 * Returns epoch ms or null when absent/unparseable.
 */
export function parseExpiration(headerValue) {
  if (!headerValue) return null;
  const iso = String(headerValue).trim().replace(/ UTC$/i, 'Z').replace(' ', 'T');
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Pure verdict for one token.
 *
 * @param {{ name: string, present?: boolean, status?: number, expiration?: string | null,
 *           graphqlStatus?: number | null, now?: number, warnDays?: number }} input
 * @returns {{ level: 'ok' | 'warn' | 'fail', daysLeft: number | null, message: string }}
 */
export function assessToken({ name, present = true, status, expiration = null, graphqlStatus = null, now = Date.now(), warnDays = DEFAULT_WARN_DAYS }) {
  if (!present) {
    return { level: 'fail', daysLeft: null, message: `${name}: secret is NOT SET in this workflow (empty env). Add it under Settings → Secrets → Actions.` };
  }
  if (status !== 200) {
    const hint = status === 401
      ? 'token expired or revoked — rotate it'
      : status === 403
        ? 'token rejected (permission/scope or SSO) — check its permissions'
        : 'unexpected response';
    return { level: 'fail', daysLeft: null, message: `${name}: REST /rate_limit returned HTTP ${status} (${hint}).` };
  }
  if (graphqlStatus !== null && graphqlStatus !== 200) {
    const hint = graphqlStatus === 401
      ? 'bad credentials'
      : 'GraphQL rejects this token — Track 1 needs a CLASSIC PAT (fine-grained PATs are refused by the GraphQL API)';
    return { level: 'fail', daysLeft: null, message: `${name}: GraphQL probe returned HTTP ${graphqlStatus} (${hint}).` };
  }
  const expMs = parseExpiration(expiration);
  if (expMs === null) {
    return { level: 'ok', daysLeft: null, message: `${name}: OK (HTTP 200; no expiration header — token does not expire).` };
  }
  const daysLeft = (expMs - now) / 86_400_000;
  const when = new Date(expMs).toISOString().slice(0, 10);
  if (daysLeft <= 0) {
    return { level: 'fail', daysLeft, message: `${name}: expired on ${when} (GitHub still answered 200 — rotate NOW).` };
  }
  if (daysLeft < warnDays) {
    return { level: 'warn', daysLeft, message: `${name}: OK but EXPIRES in ${daysLeft.toFixed(1)} days (${when}). Rotate it before then.` };
  }
  return { level: 'ok', daysLeft, message: `${name}: OK (HTTP 200; expires ${when}, ${Math.floor(daysLeft)} days left).` };
}

async function probeRest(token) {
  const res = await fetch(REST_URL, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  let coreRemaining = null;
  if (res.ok) {
    try {
      const json = await res.json();
      coreRemaining = json?.resources?.core?.remaining ?? null;
    } catch { /* ignore */ }
  }
  return {
    status: res.status,
    expiration: res.headers.get(EXPIRY_HEADER),
    coreRemaining,
  };
}

async function probeGraphql(token) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ query: 'query { viewer { login } }' }),
  });
  return res.status;
}

async function main() {
  const skipGraphql = process.argv.includes('--skip-graphql');
  const warnDays = Number.parseInt(process.env.TOKEN_WARN_DAYS || '', 10) || DEFAULT_WARN_DAYS;
  let failed = false;

  console.log('[tokens] === GitHub token preflight ===');
  for (const spec of REQUIRED_TOKENS) {
    const token = process.env[spec.name];
    if (!token) {
      const v = assessToken({ name: spec.name, present: false });
      console.error(`::error::${v.message}`);
      failed = true;
      continue;
    }
    let rest;
    try {
      rest = await probeRest(token);
    } catch (err) {
      console.error(`::error::${spec.name}: network error probing /rate_limit (${err.cause?.code || err.message})`);
      failed = true;
      continue;
    }
    let graphqlStatus = null;
    if (spec.graphql && !skipGraphql && rest.status === 200) {
      try {
        graphqlStatus = await probeGraphql(token);
      } catch (err) {
        console.error(`::error::${spec.name}: network error probing GraphQL (${err.cause?.code || err.message})`);
        failed = true;
        continue;
      }
    }
    const verdict = assessToken({ name: spec.name, status: rest.status, expiration: rest.expiration, graphqlStatus, warnDays });
    console.log(`[tokens] ${spec.name}: purpose=${spec.purpose}`);
    console.log(`[tokens] ${spec.name}: rest_status=${rest.status} expiration=${rest.expiration || 'none'} core_remaining=${rest.coreRemaining ?? 'n/a'}${spec.graphql ? ` graphql_status=${graphqlStatus ?? 'skipped'}` : ''}`);
    if (verdict.level === 'fail') {
      console.error(`::error::${verdict.message}`);
      failed = true;
    } else if (verdict.level === 'warn') {
      console.log(`::warning::${verdict.message}`);
    } else {
      console.log(`[tokens] ${verdict.message}`);
    }
  }

  if (failed) {
    console.error('[tokens] FATAL: at least one required GitHub token is unusable.');
    console.error('[tokens] Rotate it at https://github.com/dwalshx/ClaudeAtlas/settings/secrets/actions');
    console.error('[tokens] then follow CLAUDE.md "Recovery: expired GitHub PAT / poisoned GHA caches".');
    process.exit(1);
  }
  console.log('[tokens] all required tokens OK');
}

const invokedAsScript = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1]
      || (process.argv[1] || '').endsWith('check-github-tokens.js');
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  main().catch((err) => {
    console.error(`[tokens] FATAL: ${err.stack || err.message}`);
    process.exit(1);
  });
}

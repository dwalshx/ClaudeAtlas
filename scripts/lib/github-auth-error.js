/**
 * ClaudeAtlas — GitHub auth-failure classification (token-free module).
 *
 * Background (debug: .planning/debug/daily-scrape-outage-2026-09-28.md):
 * the fine-grained SCRAPE_PAT expired on 2026-10-14. Every REST scraper
 * treated the resulting HTTP 401 as "skip this page" and exited 0 with an
 * unchanged — or, for the weekly full sweep, EMPTY — corpus. The outage went
 * unnoticed for 39 days because nothing distinguished "quiet day" from
 * "no credentials".
 *
 * This module is the single place that decides "is this response an
 * authentication/authorization failure that must abort the run?". It
 * deliberately imports NOTHING from github-fetch.js (which exits the process
 * at import time when GITHUB_TOKEN is unset) so it is safe to import from
 * token-free unit tests and from scripts/lib/github-graphql.js.
 *
 * Classification (pure, synchronous — callers pass the already-read body):
 *   401                                       → auth failure (expired/revoked/bad token)
 *   403 + `retry-after` header                → secondary (abuse) rate limit — NOT auth
 *   403 + `x-ratelimit-remaining: 0`          → primary rate limit exhausted — NOT auth
 *   403 + body matching a credential/scope message → auth failure
 *   403 otherwise (e.g. "Repository access blocked") → per-resource casualty — NOT auth
 *   anything else                             → NOT auth
 */

const AUTH_BODY_PATTERNS = [
  /bad credentials/i,
  /requires authentication/i,
  /resource not accessible by (personal access token|integration)/i,
  /personal access token/i,
  /must have (admin|push|read) (rights|access)/i,
  /saml|sso/i,
  /token (is )?(expired|revoked)/i,
];

export class GitHubAuthError extends Error {
  /**
   * @param {number} status — HTTP status (401 or 403)
   * @param {string} url — request URL (no secrets; GitHub URLs carry none)
   * @param {string} [detail] — first ~200 chars of the response body
   */
  constructor(status, url, detail = '') {
    super(`GitHub API returned HTTP ${status} for ${url}${detail ? ` — ${detail}` : ''}`);
    this.name = 'GitHubAuthError';
    this.status = status;
    this.url = url;
    this.detail = detail;
  }
}

/**
 * Pure classifier. `res` only needs `.status` and `.headers.get()`.
 *
 * @param {{ status: number, headers?: { get(name: string): string | null } }} res
 * @param {string} [bodyText] — response body (read by the caller for 403s)
 * @returns {boolean}
 */
export function isAuthFailure(res, bodyText = '') {
  if (!res || typeof res.status !== 'number') return false;
  if (res.status === 401) return true;
  if (res.status !== 403) return false;

  const get = (name) => (res.headers && typeof res.headers.get === 'function' ? res.headers.get(name) : null);
  if (get('retry-after')) return false;            // secondary limit — back off, do not abort
  if (get('x-ratelimit-remaining') === '0') return false; // primary limit — wait for reset

  const body = String(bodyText || '');
  return AUTH_BODY_PATTERNS.some((re) => re.test(body));
}

/**
 * Human-readable, actionable explanation for the CI log. Names the secret
 * the failing step authenticates with and points at the runbook. Never
 * includes token material.
 *
 * @param {GitHubAuthError} err
 * @param {{ secretName?: string, tag?: string }} [opts]
 * @returns {string}
 */
export function describeAuthFailure(err, { secretName = 'SCRAPE_PAT', tag = '[github]' } = {}) {
  const lines = [
    `${tag} FATAL: GitHub rejected our credentials (HTTP ${err.status}).`,
    `${tag}   ${err.message}`,
    `${tag}   The GITHUB_TOKEN for this step comes from the ${secretName} repository secret.`,
    `${tag}   HTTP 401 almost always means the token EXPIRED or was REVOKED (fine-grained PATs`,
    `${tag}   expire; classic PATs can be revoked by a security sweep).`,
    `${tag}   Fix: rotate the secret at https://github.com/dwalshx/ClaudeAtlas/settings/secrets/actions`,
    `${tag}   then follow CLAUDE.md "Recovery: expired GitHub PAT / poisoned GHA caches".`,
    `${tag}   Aborting WITHOUT writing any corpus file so the cached data stays intact.`,
  ];
  return lines.join('\n');
}

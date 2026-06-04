/**
 * ACTIVE (2026-06-03) — wired into Track 1 (scrape-pulse.js) and authenticated
 * via SCRAPE_PAT_CLASSIC (a CLASSIC PAT, verified against GitHub's GraphQL API).
 * The fine-grained SCRAPE_PAT is REJECTED by the GraphQL endpoint (403), which
 * caused the temporary REST fallback (commit 1e5d1a5) — now retired. Track 1 on
 * GraphQL uses GraphQL's SEPARATE 5,000-points/hr budget, freeing the shared
 * REST budget for Track 2 + plugin discovery (budget starvation on REST was
 * crawling/timing out plugin discovery). The workflow's Track 1 step sets
 * process.env.GITHUB_TOKEN = SCRAPE_PAT_CLASSIC; Track 2 stays on SCRAPE_PAT.
 *
 * ClaudeAtlas — GitHub GraphQL batch client for Track 1 (Star Pulse).
 *
 * Replaces the per-repo REST `GET /repos/{owner}/{name}` loop with a batched
 * GraphQL `repository(...)` query (50 repos/query via aliases, ~88 queries for
 * ~4,351 repos, ~1 pt each). This collapses the abuse pattern structurally:
 * 88 serial queries cannot trip the 2,000-pts/min secondary GraphQL limit, and
 * the whole sweep stays far under the 5,000-pts/hr primary limit. RESEARCH §2.
 *
 * MODULE IMPORT-SAFETY (token-free guarantee): this module MUST NOT import
 * anything from github-fetch.js. github-fetch.js calls process.exit(1) at
 * module-load time when GITHUB_TOKEN is unset, so a top-level import would
 * transitively kill any token-free process that imports github-graphql.js even
 * just for its PURE exports (buildPulseQuery, mapGraphqlRepoToFields). We define
 * a local `sleep` one-liner instead so the pure exports are import-safe without
 * a token (consistent with the unit-test token-free guarantee).
 *
 * Exports: fetchRepoBatchGraphql, mapGraphqlRepoToFields, buildPulseQuery.
 */

const GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';

// Local sleep — NOT imported from github-fetch.js (see module header / token-free guarantee).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Pure: map one GraphQL `repository` node to the 11 TRACK1_FRESHNESS_FIELDS.
 *
 * Reproduces the REST refreshRepo() shape byte-for-byte (same `|| 0` / `|| false`
 * / `|| null` nullish defaults). repo_open_issues sums open issues + open PRs to
 * preserve REST parity with `open_issues_count` (which counts both) — locked
 * decision D2.
 *
 * DEFERRED (do NOT implement here): the more-correct issues-ONLY semantic (drop
 * the pullRequests sum) is a deliberate future scoring change requiring its own
 * scorer re-validation per CLAUDE.md Data-integrity constraint + Known-Issue #3.
 *
 * @param {object} node — a non-null GraphQL repository node.
 * @returns {object} the 11 TRACK1_FRESHNESS_FIELDS.
 */
export function mapGraphqlRepoToFields(node) {
  const openIssues = (node.issues?.totalCount || 0) + (node.pullRequests?.totalCount || 0);
  const topics = Array.isArray(node.repositoryTopics?.nodes)
    ? node.repositoryTopics.nodes
        .map((n) => n?.topic?.name)
        .filter((name) => typeof name === 'string')
    : [];
  return {
    repo_stars: node.stargazerCount || 0,
    repo_forks: node.forkCount || 0,
    repo_open_issues: openIssues, // open issues AND open PRs — REST parity (D2)
    repo_pushed_at: node.pushedAt ?? null,
    repo_updated_at: node.updatedAt ?? null,
    repo_archived: node.isArchived || false,
    repo_topics: topics,
    repo_license: node.licenseInfo?.spdxId || node.licenseInfo?.key || null,
    repo_language: node.primaryLanguage?.name || null,
    repo_description: node.description || null,
    repo_default_branch: node.defaultBranchRef?.name || null,
  };
}

// GraphQL injection defense: GitHub owner/repo names are restricted to
// [A-Za-z0-9._-], so a quote can never legitimately appear. We escape
// defensively anyway in case of malformed input.
function escapeGraphqlString(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// The shared selection set per aliased repository(...) block.
const REPO_SELECTION = `{
    stargazerCount
    forkCount
    pushedAt
    updatedAt
    isArchived
    description
    primaryLanguage { name }
    licenseInfo { spdxId key }
    defaultBranchRef { name }
    repositoryTopics(first: 20) { nodes { topic { name } } }
    issues(states: OPEN) { totalCount }
    pullRequests(states: OPEN) { totalCount }
  }`;

/**
 * Pure: build an aliased GraphQL query for a batch of repos.
 *
 * @param {string[]} repoFullNames — e.g. ["anthropics/claude-code", ...].
 * @returns {{ query: string, aliasMap: Record<string, string> }}
 *   query     — one aliased repository(owner,name){...} block per repo (r0..rN).
 *   aliasMap  — alias -> repoFullName, so the caller can map nulls back.
 */
export function buildPulseQuery(repoFullNames) {
  const aliasMap = {};
  const blocks = [];
  repoFullNames.forEach((repoFullName, i) => {
    const alias = `r${i}`;
    aliasMap[alias] = repoFullName;
    // Split owner/name on the FIRST slash only (neither owner nor repo name
    // can contain a slash, but be explicit).
    const slash = repoFullName.indexOf('/');
    const owner = repoFullName.slice(0, slash);
    const name = repoFullName.slice(slash + 1);
    blocks.push(
      `  ${alias}: repository(owner: "${escapeGraphqlString(owner)}", name: "${escapeGraphqlString(name)}") ${REPO_SELECTION}`,
    );
  });
  const query = `query {\n${blocks.join('\n')}\n}`;
  return { query, aliasMap };
}

/**
 * Fetch a batch of repos via GraphQL. Serial-friendly (caller loops batches
 * with a small inter-batch delay).
 *
 * Auth: MUST be SCRAPE_PAT_CLASSIC (a CLASSIC PAT — fine-grained PATs are 403'd
 * by the GraphQL API; the Actions GITHUB_TOKEN is only 1,000 pts/hr). Classic
 * PATs get the full 5,000 GraphQL pts/hr — RESEARCH §6. The workflow's Track 1
 * step sets process.env.GITHUB_TOKEN to SCRAPE_PAT_CLASSIC, so we read that.
 *
 * Partial-data semantics (RESEARCH §3): HTTP 200 with both `data` and a
 * non-empty `errors[]` is NORMAL when some aliases resolve and others fail
 * (deleted/renamed/private repo → null alias). A null alias is a tolerated
 * casualty (same class as today's REST 404/451), NOT a whole-query failure.
 * We only throw on a transport-level non-200 or a totally-missing `data`.
 *
 * @param {string[]} repoFullNames
 * @param {number} retries
 * @returns {Promise<{ freshByRepo: Map<string, object>, failures: Array<{repoFullName: string, status: string}> }>}
 */
export async function fetchRepoBatchGraphql(repoFullNames, retries = 3) {
  const freshByRepo = new Map();
  const failures = [];
  if (!repoFullNames || repoFullNames.length === 0) {
    return { freshByRepo, failures };
  }

  const { query, aliasMap } = buildPulseQuery(repoFullNames);
  const token = process.env.GITHUB_TOKEN; // SCRAPE_PAT_CLASSIC in CI — see header (RESEARCH §6).

  let res;
  try {
    res = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ query }),
    });
  } catch (err) {
    if (retries > 0) {
      console.log(`  [retry] GraphQL network error (${err.cause?.code || err.message}), retrying in 5s... (${retries} left)`);
      await sleep(5000);
      return fetchRepoBatchGraphql(repoFullNames, retries - 1);
    }
    // Whole batch failed at transport level — mark every repo a casualty.
    for (const repoFullName of repoFullNames) {
      failures.push({ repoFullName, status: 'graphql-network' });
    }
    return { freshByRepo, failures };
  }

  // CRITICAL DIAGNOSTIC FIX (2026-06-03): on any non-OK GraphQL response,
  // capture and log the response BODY + status text BEFORE the retry/backoff.
  // The prior REST-fallback episode (commit 1e5d1a5) was blind: a fine-grained
  // SCRAPE_PAT 403'd every batch but we logged only the bare status, so the
  // auth root-cause was invisible in CI. A future auth/limit failure (e.g. the
  // classic PAT being revoked or hitting the GraphQL points budget) must now be
  // diagnosable from the CI log. res.text() consumes the body once, so we read
  // it here and reuse the captured string in both non-OK branches below.
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch { body = '<unreadable body>'; }
    console.error(`[pulse] GraphQL ${res.status}: ${body.slice(0, 300)}`);
  }

  // 403/429 → secondary abuse limit. Honor retry-after first (RESEARCH §6),
  // using the LOCAL sleep (no github-fetch.js import — token-free guarantee).
  if (res.status === 403 || res.status === 429) {
    if (retries > 0) {
      const retryAfter = res.headers.get('retry-after');
      const retryAfterSecs = retryAfter ? parseInt(retryAfter, 10) : NaN;
      const waitMs = Number.isInteger(retryAfterSecs) && retryAfterSecs > 0
        ? Math.min(retryAfterSecs * 1000 + 1000, 120000)
        : 60000;
      console.log(`  [rate-limit] GraphQL ${res.status}, waiting ${Math.ceil(waitMs / 1000)}s...`);
      await sleep(waitMs);
      return fetchRepoBatchGraphql(repoFullNames, retries - 1);
    }
    for (const repoFullName of repoFullNames) {
      failures.push({ repoFullName, status: `graphql-${res.status}` });
    }
    return { freshByRepo, failures };
  }

  if (!res.ok) {
    for (const repoFullName of repoFullNames) {
      failures.push({ repoFullName, status: `graphql-${res.status}` });
    }
    return { freshByRepo, failures };
  }

  let json;
  try {
    json = await res.json();
  } catch {
    for (const repoFullName of repoFullNames) {
      failures.push({ repoFullName, status: 'graphql-parse' });
    }
    return { freshByRepo, failures };
  }

  // Totally-missing data = whole-query failure (e.g. auth error, malformed query).
  if (!json || !json.data) {
    for (const repoFullName of repoFullNames) {
      failures.push({ repoFullName, status: 'graphql-no-data' });
    }
    return { freshByRepo, failures };
  }

  // Per-alias resolution. A non-empty json.errors[] is NORMAL (partial data) —
  // do NOT treat it as a whole-query failure (RESEARCH §3).
  for (const [alias, repoFullName] of Object.entries(aliasMap)) {
    const node = json.data[alias];
    if (node == null) {
      // Deleted/renamed/private → tolerated casualty (same class as REST 404/451).
      failures.push({ repoFullName, status: 'graphql-null' });
    } else {
      freshByRepo.set(repoFullName, mapGraphqlRepoToFields(node));
    }
  }

  return { freshByRepo, failures };
}

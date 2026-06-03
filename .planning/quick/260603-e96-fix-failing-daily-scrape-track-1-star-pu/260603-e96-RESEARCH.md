# Quick Task 260603-e96 — Fix failing daily scrape (Track 1 Star Pulse) — Research

**Researched:** 2026-06-03
**Domain:** GitHub REST/GraphQL rate limits; Track 1 (`scripts/scrape-pulse.js`) per-repo refresh
**Confidence:** HIGH on the GitHub rate-limit mechanics (verified against current docs); HIGH on the failure mechanism (read from code).

---

## Summary

Track 1 refreshes engagement signals for every unique repo in the catalog via one
`GET /repos/{owner}/{name}` per repo, serially, through `fetchWithETag`. At 826 repos
(its design point) this was fine; at ~4,351 repos it is failing. The failure is **not**
primary-rate-limit exhaustion of the 5,000/hr budget — 304s are free and the warm path
costs ~0 against primary. The failure is the **secondary (abuse) rate limit**: most repos
tick stars/forks/issues daily, so their cached ETags invalidate and come back as **200s,
not 304s** (this is the documented Known-Issue #7 behavior). 4,351 back-to-back 200-returning
GETs with zero inter-request delay trip GitHub's secondary limit (points-per-minute and/or
the abuse heuristic for rapid serial requests), returning 403/429. The current backoff reads
`x-ratelimit-reset` — but secondary limits signal via **`retry-after`**, which the code does
not read, so it either waits until the *primary* reset (up to an hour) or falls into the
60s blind-wait branch. Multiplied across thousands of repos and the added Phase 3.2
plugin/MCP steps, the run blows the 330-min ceiling or fails the 10% MAX_FAIL_RATIO gate,
and the daily-history snapshot is dropped.

**The documented lever (3.0.1 RESEARCH §Q3d):** migrate Track 1's per-repo REST loop to a
**batched GraphQL query** — ~50 repos per aliased query, ~88 queries for 4,351 repos, at
~1 point each = ~88 points against the 5,000/hr GraphQL budget. Track 1 authenticates with
`SCRAPE_PAT` (a user PAT), so it gets the **full 5,000 points/hr** GraphQL budget, **not**
the GITHUB_TOKEN's restricted 1,000/hr — this is the load-bearing fact that makes the
migration comfortable.

**Primary recommendation:** Ship a **stopgap first** (read `retry-after`, add a small
inter-request delay, raise MAX_FAIL_RATIO tolerance) to stop the bleeding and protect
tonight's snapshot, **then** do the GraphQL migration as the durable fix. Both can land in
one PR if time allows, but the stopgap must not be blocked on the migration.

---

## 1. Current failure mechanism (from `scripts/scrape-pulse.js` + `github-fetch.js`)

**How Track 1 fetches:**
- `main()` builds `uniqueRepos` (Set of `repo_full_name`), then loops **serially**:
  `scrape-pulse.js:141-153` — `for (const repoFullName of uniqueRepos) { await refreshRepo(...) }`.
- `refreshRepo` (`:46-72`) calls `fetchWithETag('https://api.github.com/repos/${repoFullName}')`.
- `fetchWithETag` (`github-fetch.js:155-221`) sends `If-None-Match` when an ETag is cached.
  **No delay between requests** — the loop fires as fast as `await fetch` resolves.

**Why it hits 403/429 now and didn't at 826 repos:**
- Per CLAUDE.md Known-Issue #7, per-repo ETags **invalidate daily** because stars/forks/issues
  tick up on most repos → conditional GETs return **200, not 304**. 200s **count** against
  both the primary budget AND the secondary points-per-minute budget; 304s are free.
- Secondary limit (verified, current docs): **no more than 900 points/min** for REST
  (most GETs = 1 point), **no more than 100 concurrent requests** (shared REST+GraphQL),
  plus an abuse heuristic that penalizes rapid serial requests to the same host.
  4,351 serial 200-returning GETs as fast as the socket allows is exactly the pattern the
  secondary limiter targets.
- **This is secondary, not primary, exhaustion.** Primary is 5,000/hr; even 4,351 fresh
  200s fit under 5,000/hr. The binding constraint is the *per-minute* / abuse limit.

**Why the current backoff makes it worse (`github-fetch.js:192-203`):**
```js
if (res.status === 403 || res.status === 429) {
  const resetHeader = res.headers.get('x-ratelimit-reset');   // PRIMARY reset only
  if (resetHeader) { /* wait until primary reset — could be ~1hr */ }
  await sleep(60000);  // else blind 60s
}
```
- It reads **`x-ratelimit-reset`** (the *primary* reset). On a **secondary** limit GitHub
  sends **`retry-after`** (seconds) — which this code ignores. So on a secondary 403 it
  either waits up to ~1hr for the primary reset (massively over-waits, blows the timeout) or
  hits the blind 60s branch and immediately re-trips the secondary limit on resume.
- There is no inter-request pacing, so even after a wait it resumes hammering.

**Net:** repeated long waits → 330-min timeout, OR enough failures to exceed the 10%
`MAX_FAIL_RATIO` gate (`scrape-pulse.js:34, 160-165`) → `process.exit(1)` → snapshot dropped.

---

## 2. GraphQL batch approach — cost model (VERIFIED, current docs)

**GraphQL budget for Track 1 = 5,000 points/hr.** Track 1 runs with
`env: GITHUB_TOKEN: ${{ secrets.SCRAPE_PAT }}` (daily-scrape.yml:128-129). A **user PAT
gets 5,000 points/hr** on GraphQL. The restrictive **1,000 points/hr GraphQL limit applies
only to the Actions-provided `GITHUB_TOKEN`** — which Track 1 does **not** use. Do not
confuse the two; the migration's headroom depends on this.

**Point cost of an aliased batch query (verified):** GitHub's rule —
> "Add up the number of requests needed to fulfill each unique connection in the call …
> Divide the number by 100 and round to the nearest whole number."

Scalar fields (`stargazerCount`, `forkCount`, `pushedAt`) create **no connections**.
`issues(states:OPEN){ totalCount }` is a connection but we request only `totalCount` (no
`first`/node traversal), so it contributes negligibly. **A query batching ~50 aliased
`repository(...)` lookups of scalar/totalCount fields costs ≈ 1 point** (rounds to minimum).
Secondary GraphQL limit: **2,000 points/min**; non-mutation query = 1 point.

**Math at 4,351 repos:**

| Approach | Requests | Primary cost | Per-min risk |
|----------|----------|--------------|--------------|
| REST today (cold/200 path) | 4,351 serial GETs | ~4,351 pts/hr (under 5k) | **TRIPS** 900 pts/min secondary |
| GraphQL @ 50/query | ~88 queries | ~88 pts/hr | trivial (88 pts total, vs 2,000/min) |
| GraphQL @ 100/query | ~44 queries | ~44 pts/hr | trivial |

Either batch size leaves the 5,000/hr GraphQL budget essentially untouched, with **enormous
headroom** for Track 2 discovery (Track 2 uses REST search on a *separate* budget anyway).
The 4,351→88 request collapse also eliminates the secondary-limit abuse pattern by
construction (88 sequential queries with a small delay cannot trip 2,000 pts/min).

---

## 3. Batch / alias limits & query shape

- **Node limit:** 500,000 total nodes per query (verified). At 50 repos × a handful of scalar
  fields, we are ~5 orders of magnitude under the cap. Batch size is bounded by *query
  readability and error blast-radius*, not the node limit. **Recommend 50 repos/query** —
  small enough that one malformed/renamed repo's error is easy to isolate, large enough to
  collapse 4,351 → 88 calls.
- **Aliased query shape:**
  ```graphql
  query Pulse {
    r0: repository(owner: "anthropics", name: "skills") {
      stargazerCount
      forkCount
      pushedAt
      isArchived
      primaryLanguage { name }
      licenseInfo { spdxId }
      description
      defaultBranchRef { name }
      repositoryTopics(first: 20) { nodes { topic { name } } }
      issues(states: OPEN) { totalCount }
    }
    r1: repository(owner: "...", name: "...") { ... }
    # ... up to r49
  }
  ```
  Note `repositoryTopics(first: 20)` IS a small connection — keep `first` modest (topics
  rarely exceed ~10). This nudges cost but still rounds to ~1 point at 50 repos.
- **Partial-data / errors semantics (IMPORTANT):** GraphQL returns **HTTP 200 with both
  `data` and `errors[]`** when some aliases resolve and others fail. A deleted/renamed/private
  repo yields `data.rN === null` plus an entry in `errors[]` (typically `type: "NOT_FOUND"`).
  **Do not treat a non-empty `errors[]` as a whole-query failure.** Iterate the `data.rN`
  fields; a `null` alias = that repo is a tolerated casualty (same class as today's 404/451 in
  `refreshRepo`). This preserves the existing 10% MAX_FAIL_RATIO tolerance semantics.
- **Auth:** same `SCRAPE_PAT`, same `Authorization: Bearer` header. GraphQL endpoint is
  `POST https://api.github.com/graphql` with `{ query }` JSON body. No new scopes needed —
  public-repo read is sufficient (the PAT already has it for REST).
- **No ETag/conditional requests on GraphQL.** Every GraphQL call costs its points
  regardless of whether data changed (there is no 304 path). This is fine here because the
  batched cost is ~88 points total — the ETag savings that mattered for REST are irrelevant
  when the whole job costs <2% of the hourly budget.

---

## 4. History-snapshot field mapping (schema MUST NOT change)

The snapshot writer (`scrape-pulse.js:79-111`) emits per-repo objects with **exactly four
short keys**, sourced from the refreshed skill record:

```js
repos[name] = {
  s: skill.repo_stars,        // stars
  f: skill.repo_forks,        // forks
  i: skill.repo_open_issues,  // open issues
  p: skill.repo_pushed_at,    // pushed_at (ISO 8601)
};
```
Plus top-level `date`, `timestamp`, `repo_count`. Exclusion gate:
`if (skill.repo_archived || skill.repo_is_fork) continue;` — so `repo_archived` must still be
populated by the refresh (it is, via the field map). `repo_is_fork` is sourced from the
existing record, NOT refreshed (comment at `:75-77`) — **GraphQL must NOT need to provide it.**

**REST→GraphQL field map** (feeds `TRACK1_FRESHNESS_FIELDS`, `skill-fields.js:12-24`):

| Skill field (unchanged) | Snapshot key | REST source (today) | GraphQL field |
|-------------------------|--------------|---------------------|---------------|
| `repo_stars` | `s` | `stargazers_count` | `stargazerCount` |
| `repo_forks` | `f` | `forks_count` | `forkCount` |
| `repo_open_issues` | `i` | `open_issues_count` | `issues(states: OPEN) { totalCount }` ⚠ see note |
| `repo_pushed_at` | `p` | `pushed_at` | `pushedAt` |
| `repo_updated_at` | — | `updated_at` | `updatedAt` |
| `repo_archived` | (gate) | `archived` | `isArchived` |
| `repo_topics` | — | `topics[]` | `repositoryTopics(first:20){nodes{topic{name}}}` → map to names |
| `repo_license` | — | `license.spdx_id`/`key` | `licenseInfo { spdxId }` (fallback `key`/null) |
| `repo_language` | — | `language` | `primaryLanguage { name }` |
| `repo_description` | — | `description` | `description` |
| `repo_default_branch` | — | `default_branch` | `defaultBranchRef { name }` |

⚠ **`open_issues_count` vs `issues(states:OPEN).totalCount` semantics differ.** REST's
`open_issues_count` includes **open issues AND open pull requests**. GraphQL's
`issues(states:OPEN).totalCount` is **issues only** (PRs are a separate `pullRequests`
connection). This is a real behavior change that feeds the Issue-health scorer signal (10%
weight). **Options for the planner:** (a) accept the semantic shift (cleaner — "open issues"
arguably *should* exclude PRs), and re-validate scoring distribution per the Data-integrity
constraint; or (b) preserve REST parity by also querying
`pullRequests(states:OPEN){ totalCount }` and summing. **Recommend (a)** — it is more correct,
the scorer is log/ratio-scaled so small absolute shifts are minor, but flag it explicitly so
the scoring change is a conscious decision, not silent drift (CLAUDE.md Data-integrity
constraint + Known-Issue #3).

**The snapshot JSON schema (keys s/f/i/p, date/timestamp/repo_count) does not change.** Only
the upstream data source for those values changes.

---

## 5. Stopgap vs full migration — RECOMMENDATION: stopgap FIRST, then GraphQL

**Ship the stopgap first** (minutes, low-risk, protects tonight's 06:30 UTC snapshot), then
land the GraphQL migration as the durable fix. Rationale: the snapshot is load-bearing and
unreplayable (CLAUDE.md Known-Issue #4 / PROJECT.md moat constraint) — every missed night is
permanent data loss. A focused secondary-limit-aware backoff fix is far lower-risk than a
first-ever GraphQL client, and a GraphQL bug that fails the run would *also* drop the snapshot.

**Stopgap (in `github-fetch.js` / `scrape-pulse.js`), all small:**
1. **Read `retry-after`** in the 403/429 branch of `fetchWithETag` BEFORE falling back to
   `x-ratelimit-reset`/blind-60s. Honor it (`await sleep(retryAfter*1000 + jitter)`).
2. **Add a small inter-request delay** in the Track 1 loop (e.g. `await sleep(80–120ms)` per
   repo) to stay well under 900 pts/min. At ~100ms × 4,351 ≈ 7–8 min added — acceptable
   under the 330-min ceiling and far cheaper than repeated hour-long primary waits.
3. Optionally **raise `MAX_FAIL_RATIO`** modestly (e.g. 0.10 → 0.15) so a partial
   secondary-limit blip doesn't fail the whole run and drop the snapshot.

**Full fix (durable):** GraphQL batch migration (§2–§4). 4,351 → ~88 queries removes the
abuse pattern structurally and is ~50× faster. This is the documented lever (3.0.1 §Q3d:
"Recommend Track 1 migrate to GraphQL batched repo queries").

**Why not straight-to-GraphQL only:** higher single-change risk on a load-bearing daily job;
no fallback if the new GraphQL path has a bug; the stopgap is independently valuable as
defense-in-depth (secondary-limit handling helps Track 2's REST search too).

---

## 6. Pitfalls / gotchas

- **`retry-after` (secondary) ≠ `x-ratelimit-reset` (primary).** The current code only reads
  the latter. This is the proximate bug. Secondary limits use `retry-after` (seconds).
- **Secondary limit is shared across REST+GraphQL** (100 concurrent, and the abuse heuristic).
  Keep Track 1 **serial** even on GraphQL — do not parallelize the 88 queries aggressively.
  A tiny delay between GraphQL calls is cheap insurance.
- **`open_issues_count` includes PRs; GraphQL `issues` does not** (§4 ⚠). Conscious decision
  required; affects the Issue-health scorer.
- **No 304/ETag on GraphQL** — every call costs points. Irrelevant at 88-point job cost, but
  means the GraphQL path does NOT use `etag-cache.json` and won't grow/refresh it. Track 2
  still uses ETags; leave that cache path intact.
- **GITHUB_TOKEN vs PAT GraphQL budget (1,000 vs 5,000 pts/hr).** The migration MUST keep
  using `SCRAPE_PAT`. If anyone "simplifies" Track 1 to the Actions `GITHUB_TOKEN`, the
  GraphQL budget collapses to 1,000/hr/repo and headroom shrinks 5×. Document this.
- **CLAUDE.md footguns:** `scrape-pulse.js` already uses `loadSkillsArray()` (chunked NDJSON
  read) and `writeNdjsonStreaming` — do NOT reintroduce `readFileSync(...,'utf-8')` or
  `JSON.stringify(arr)` on `data/` files. The GraphQL change is request-layer only; it must
  not touch the read/write path. `npm run check:patterns` gates this.
- **Data-integrity constraint:** any change to the values feeding the 7-signal scorer
  (notably the issues-vs-PRs shift) requires re-validating the tier distribution before
  shipping (PROJECT.md Constraints; Known-Issue #3).
- **Don't gate Track 1's refresh on time** (Known-Issue #7) — the daily snapshot needs
  same-day numbers for every repo. GraphQL batching reduces *request count*, not coverage;
  keep refreshing all repos.

---

## RECOMMENDATION (bottom line)

1. **Stopgap first, this PR or a hotfix commit:** in `fetchWithETag`'s 403/429 branch, read
   and honor **`retry-after`** before `x-ratelimit-reset`/blind-60s; add ~100ms inter-request
   delay in the Track 1 loop; bump `MAX_FAIL_RATIO` 0.10→0.15. Protects tonight's snapshot.
2. **Durable fix:** migrate Track 1's per-repo `GET /repos/{owner}/{name}` loop to a
   **batched GraphQL** `POST /graphql` query, **50 repos per query** (~88 queries at 4,351
   repos, ~1 point each, ~88 of 5,000 pts/hr). Keep it serial with a small delay. Keep
   `SCRAPE_PAT` auth (5,000 pts/hr — NOT GITHUB_TOKEN's 1,000).
3. **Error handling:** treat GraphQL `data.rN === null` + `errors[]` entry as a tolerated
   per-repo casualty (existing 404/451 semantics), not a query failure.
4. **Field mapping:** §4 table. Snapshot schema (`s/f/i/p` + `date`/`timestamp`/`repo_count`)
   is unchanged. **Flag the `open_issues_count`→`issues(states:OPEN).totalCount` PR-exclusion
   semantic change** and re-validate scorer distribution before shipping.

---

## Sources

### Primary (HIGH confidence)
- [GitHub GraphQL rate limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api) — 5,000 pts/hr PAT; 1,000 pts/hr GITHUB_TOKEN/repo; 2,000 pts/min secondary; 500k node limit; cost = connections/100 rounded.
- [GitHub REST secondary rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) — 900 pts/min, 100 concurrent (shared REST+GraphQL), `retry-after` then `x-ratelimit-reset`, exponential backoff.
- `scripts/scrape-pulse.js`, `scripts/lib/github-fetch.js`, `scripts/lib/skill-fields.js`, `.github/workflows/daily-scrape.yml` (read directly).
- `.planning/phases/3.0.1-pipeline-state-persistence/RESEARCH.md` §Q3d — the documented REST→GraphQL Track 1 lever.
- CLAUDE.md Known-Issues #4 (snapshot is unreplayable) and #7 (Track 1 ETags invalidate daily → 200s).

### Secondary (MEDIUM confidence)
- WebSearch corroboration of PAT (5,000) vs GITHUB_TOKEN (1,000) GraphQL budget distinction.

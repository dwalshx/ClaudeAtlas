---
phase: quick-260806-dn3
plan: 01
subsystem: worker-analytics
tags: [agent-analytics, d1, classifier, web-bot-auth, rfc-9421, request-logging]
requires: []
provides:
  - request_log D1 table (lazy self-migrated by the worker)
  - classifier v0 (worker/classify.js)
  - Web Bot Auth log-only verification (worker/web-bot-auth.js)
  - full-traffic worker logging via run_worker_first = true
affects:
  - worker/index.js (fetch wrapper + agent-ping 410)
  - wrangler.toml (run_worker_first flip)
  - llms.txt (agent-ping invitation removed)
tech-stack:
  added: []
  patterns:
    - ctx.waitUntil for ALL post-response D1 work (never detached promises)
    - lazy self-migration via the worker's own D1 binding
key-files:
  created:
    - worker/classify.js
    - worker/classify.test.js
    - worker/web-bot-auth.js
    - worker/web-bot-auth.test.js
    - worker/request-log.js
    - worker/request-log.test.js
    - scripts/apply-d1-schema.js
  modified:
    - worker/schema.sql
    - worker/index.js
    - wrangler.toml
    - package.json
    - scripts/generate-llms-txt.js
    - public/llms.txt
decisions:
  - "Lazy self-migration replaces REST-API DDL: .env CF_API_TOKEN lacks D1 Edit, so request_log is created by the worker's own env.DB binding on first 'no such table' error (orchestrator-authorized deviation)"
  - "Classifier ambiguity NEVER defaults to human — unknown/automated_unknown are first-class outputs"
  - "search_events fire-and-forget insert root-caused: detached promise canceled at response return; fixed with ctx.waitUntil (drive-by, orchestrator-authorized)"
metrics:
  duration: ~35 min active execution (started 2026-08-06T17:01Z)
  completed: 2026-08-06
  tasks: 3
  commits: [2c53c6c, 7023ac7, 0bee219]
---

# Quick Task 260806-dn3: Wave 1 Agent Analytics (E1 + E5 + E7) Summary

Full-traffic request logging into D1 with classifier v0 + log-only RFC 9421 Web Bot Auth verification, agent-ping retired at 410 — the measurement substrate for the agent-traffic analytics experiments, self-migrating its own table because the API token can't run DDL.

## What shipped per experiment

### E1 — request logging + classifier v0 (commits 2c53c6c, 7023ac7)

- **`request_log` table** (18 data columns) appended to `worker/schema.sql`; timestamp + class indexes. `ip_hash` only (daily-salted SHA-256 via the existing `hashedClientIp` closure — salt logic not duplicated); path stored WITHOUT query string.
- **`worker/classify.js`** — pure classifier: agent UA list (ChatGPT-User, Claude-User, Perplexity-User, MistralAI-User, claude-code/ prefix), crawler UA list (17 patterns incl. GPTBot, ClaudeBot/Claude-SearchBot ordered correctly, Bytespider, SEO bots), automation UA list (12 patterns), empty-UA rule, datacenter-ASN heuristic (11 ASNs + org-keyword regex; Google Cloud matched by org so plain GOOGLE/Googlebot never trips it), Sec-Fetch coherence (Chromium-≥80 contradiction = Browser Use signature). Silent/ambiguous traffic is NEVER defaulted to `human`. 31 unit tests.
- **`worker/request-log.js`** — `buildLogRow` (pure, 256-char truncation, no raw IP possible) + `logRequest` orchestrator. Entire body try/caught — never throws, never delays a response.
- **Wiring** — `worker/index.js` fetch body moved verbatim into `handleFetch`; new entry point computes the response FIRST, then schedules `ctx.waitUntil(logRequest(...))`.
- **Lazy self-migration** — on the first insert failing with "no such table", the worker runs the request_log DDL via its own `env.DB` binding and retries the insert exactly once (module-level at-most-once-per-isolate flag). DDL strings duplicated import-free with `worker/schema.sql` marked as source of truth. Covered by 3 dedicated tests (migrate-and-retry, at-most-once, non-table errors don't trigger).

### E5 — Web Bot Auth verification, log-only (commit 7023ac7)

- **`worker/web-bot-auth.js`** — parses Signature-Agent/Signature-Input/Signature, fetches signer JWKS from `/.well-known/http-message-signatures-directory` (per-isolate 1h cache), reconstructs the RFC 9421 §2.5 signature base for the supported component subset (@authority, @path, @method, signature-agent), verifies Ed25519 via WebCrypto. Outcomes: `verified | failed | present_unverified | absent`. Zero network when headers absent; never throws; runs only inside the waitUntil path. Tests include a REAL Ed25519 keypair round-trip (verified) and a flipped-byte case (failed).

### E7 — agent-ping retired (commit 0bee219)

- `POST /api/v1/agent-ping` → **410 Gone** JSON (no body read, no D1 write). `parseAgentPingBody` + `AGENT_PING_MAX_BODY_BYTES` deleted (index.js was the only referent). `agent_pings` table + schema block preserved (historical: n=1 ping over 2 months — the opt-in-with-no-carrot base rate).
- llms.txt "Say hi" section removed from BOTH `scripts/generate-llms-txt.js` (source) and committed `public/llms.txt`.

## run_worker_first flip rationale

`wrangler.toml` changed `run_worker_first = ["/skills/*", "/api/*", "/badge/*"]` → `true`. With the array, static-asset requests bypassed the worker entirely, so E1 would have logged only the API/skills/badge slice instead of the full ~98k req/day. The `env.ASSETS.fetch` fallthrough at the end of `handleFetch` still serves every static path — behavior unchanged. Cost: ~3M invocations/mo, within Workers Paid 10M included. Edge-cache hits still bypass the worker; the log captures origin-reaching requests (the correct denominator). Rollback = restore the array (comment left in place).

## D1 volume / retention

~98k rows/day ≈ 3M/mo — within D1 paid limits (50M row-writes/mo). One INSERT per request via waitUntil, no batching needed at v0. **Retention purge is deliberately deferred** (noted in the schema comment) — follow-up task.

## Deviations from Plan

### Orchestrator-authorized

**1. Remote D1 REST migration replaced by lazy self-migration** (the big one)
- **Found during:** Task 1, step 6
- **Issue:** `.env` CF_API_TOKEN lacks D1 write/edit — error 7500 on any real DDL; reads and IF-NOT-EXISTS no-ops succeed (proof: `idx_agent_pings_timestamp` never existed remotely, so all apparent successes were no-ops). Wrangler unusable (workerd has no win32-arm64 build — crashes at import).
- **Fix:** Checkpoint raised; orchestrator lifted the pre-migration requirement. `worker/request-log.js` now self-migrates via the worker's own `env.DB` binding (full DB access independent of API-token permissions). `scripts/apply-d1-schema.js` kept for future use (requires Account → D1 → Edit token). PLAN.md Task 1 amended accordingly.
- **Commits:** 2c53c6c (script + gate documentation), 7023ac7 (self-migration)

**2. Drive-by fix: search_events insert canceled at response return**
- **Found during:** Task 2 (root-caused by orchestrator while executing)
- **Issue:** `semanticSearch`'s D1 logging was a detached promise without `ctx.waitUntil` — the Workers runtime cancels it when the response returns. Root cause of search_events having only 3 rows ever.
- **Fix:** `ctx` threaded through `handleFetch` → `semanticSearch`; the insert promise (with its existing `.catch`/`console.error`) is now registered via `ctx.waitUntil`.
- **Commit:** 7023ac7

### Auto-fixed (Rule 3 — blocking)

**3. apply-d1-schema.js: statement-by-statement execution**
- **Issue:** the D1 REST /query endpoint rejected the full multi-statement schema.sql payload; individual statements succeed.
- **Fix:** script strips `--` comments and splits on `;`, executing sequentially.
- **Commit:** 2c53c6c

**4. Minor: stale comment tidy** — the search rate-limiter comment mentioned agent-ping; trimmed so Task 3's grep contract ("remaining agent-ping hits = 410 route + retirement comment only") holds. Commit 0bee219.

### Out of scope (logged, NOT fixed — see deferred-items.md)

- 2 pre-existing failures in `scripts/__tests__/embed-skills.test.js` (verified identical on pristine main @ 6235531).
- `idx_agent_pings_timestamp` missing on remote D1 (historical gap; next successful schema apply creates it — it's also NOT in the worker's self-migration DDL, which covers request_log only).

## Authentication gates

- **Task 1:** CF_API_TOKEN lacks D1 Edit → checkpoint (human-action) raised; resolved by the orchestrator with the self-migration deviation instead of a token fix. `scripts/apply-d1-schema.js` remains ready for when a D1-Edit token exists.

## Post-deploy verification checklist — PENDING (orchestrator's job after merge + push)

- [ ] `curl -sI https://claudeatlas.com/ | head -1` → 200 (statics still serve under run_worker_first = true)
- [ ] `curl -sI "https://claudeatlas.com/skills/dotnet/dotnet-test-frameworks/" | head -1` → 200
- [ ] `curl -s "https://claudeatlas.com/api/v1/search?q=testing&k=3"` → JSON results
- [ ] `curl -s -X POST https://claudeatlas.com/api/v1/agent-ping -d '{}'` → HTTP 410, body contains "gone"
- [ ] `curl -s https://claudeatlas.com/llms.txt | grep -c agent-ping` → 0 (committed copy already clean; regenerated daily)
- [ ] After ~10 min of live traffic, via D1 REST (read queries work with the current token): `SELECT class, COUNT(*) FROM request_log GROUP BY class` → rows across multiple classes; `SELECT COUNT(*) FROM request_log WHERE class='human' AND classifier_method='default'` → 0
- [ ] search_events row count growing (drive-by fix validation): `SELECT COUNT(*) FROM search_events`

Note: the FIRST logged request after deploy triggers the self-migration (one-time DDL inside waitUntil); the table will exist within seconds of any traffic.

## Follow-up seeds

- Per-actor daily report script over request_log (operator × class × day rollup) — feeds the "what agent traffic really looks like" essay.
- request_log retention sweep (purge or roll up rows older than ~90 days).
- E2/E3 experiments ride on this substrate.
- Apply `worker/schema.sql` remotely once a D1-Edit token exists (also creates the missing `idx_agent_pings_timestamp`; self-migration only covers request_log).
- Pre-existing embed-skills.test.js failures (deferred-items.md).

## Known Stubs

None — all shipped code paths are wired to real data sources.

## Task Commits

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | request_log schema + classifier v0 + D1 REST migration script | 2c53c6c |
| 2 | E1 request logging + E5 web-bot-auth (log-only, waitUntil) + self-migration + search_events drive-by | 7023ac7 |
| 3 | E7 retire agent-ping (410) + drop llms.txt invitation | 0bee219 |

## Self-Check: PASSED

All 7 created files + modified schema verified on disk; commits 2c53c6c, 7023ac7, 0bee219 verified on branch `worktree-agent-ac7aeb88e2dd5586d`; `npm test` 263 pass / 2 pre-existing fails (embed-skills, unrelated, verified failing on pristine main) / 6 skipped; `npm run check:patterns` clean before every commit.

---
phase: quick-260603-bug
plan: 01
subsystem: worker-api
tags: [worker, d1, telemetry, llms-txt, agent-affordance]
requires:
  - worker/index.js shared helpers (jsonResponse, SOURCE_CITATION, corsPreflightResponse)
  - env.DB (Cloudflare D1 binding) — optional; handler degrades gracefully if absent
provides:
  - "POST /api/v1/agent-ping endpoint (agent self-identification)"
  - "parseAgentPingBody(rawText, contentLength) exported pure helper"
  - "agent_pings D1 table DDL (operator-applied)"
  - "agent-ping invitation in llms.txt (static + generator)"
affects:
  - worker/index.js
  - worker/schema.sql
  - public/llms.txt
  - scripts/generate-llms-txt.js
tech-stack:
  added: []
  patterns:
    - "best-effort D1 logging (try/catch that never 500s — diverges from logSearch)"
    - "pure, exported, unit-testable body validation helper (no Worker runtime needed)"
key-files:
  created: []
  modified:
    - worker/index.js
    - worker/schema.sql
    - public/llms.txt
    - scripts/generate-llms-txt.js
decisions:
  - "D1 now, Cloudflare Analytics Engine later (low-volume experiment to validate agent self-reporting before durable telemetry)"
  - "agent-ping logging is best-effort: a DB failure returns 200, NOT 500 (unlike logSearch) — the ack is the product"
  - "2 KB body cap enforced twice: by Content-Length header when present, then by actual UTF-8 byte length"
metrics:
  duration: ~15m
  completed: 2026-06-03
---

# Phase quick-260603 Plan 01: Agent-Ping Affordance Endpoint Summary

Added an experimental `POST /api/v1/agent-ping` Worker route so tool-using AI agents can self-identify with a tiny `{agent, purpose}` body, logged best-effort to a new D1 `agent_pings` table and acked with the shared citation block; invited from both copies of llms.txt.

## What Was Built

### Task 1 — agentPing handler + route + validation (worker/index.js) — commit f02965e
- Exported pure `parseAgentPingBody(rawText, contentLength)` helper near the other shared helpers. Rejects oversized input via `{ tooLarge: true }` (checked against `AGENT_PING_MAX_BODY_BYTES = 2048` by Content-Length first, then actual UTF-8 byte length), tolerates malformed JSON (falls to `{}`), caps `agent`/`purpose` at 200 chars. Pure + synchronous so it is unit-testable without a Worker runtime.
- `agentPing(request, env)` handler: 405 on non-POST; 413 (no D1 write) on oversized; captures `Date.now()`, agent, purpose, `user-agent`, `request.cf?.botManagement?.verifiedBotCategory`, `request.cf?.country`; INSERTs into `agent_pings` wrapped in try/catch that — unlike logSearch — does NOT 500 on DB error (logs and falls through to the ack); always returns `{ ok: true, citation: SOURCE_CITATION }` (200) for well-formed/empty bodies.
- `// TODO (Analytics Engine):` comment block documents the planned migration to a Cloudflare Analytics Engine binding (D1 now, Analytics Engine later).
- Route wired in `fetch()` default export alongside `/api/v1/search`. The existing top-of-fetch `OPTIONS /api/*` preflight already covers CORS — no second preflight branch added.

### Task 2 — agent_pings DDL (worker/schema.sql) — commit 1a3e0cf
- Appended `CREATE TABLE IF NOT EXISTS agent_pings` (6 telemetry columns: id PK AUTOINCREMENT, timestamp INTEGER NOT NULL, agent/purpose/user_agent/bot_category/country TEXT) + `idx_agent_pings_timestamp` index, following the `search_events` conventions.
- Updated the file header to note it now defines two tables applied via the same command.
- Operator note explains wrangler CANNOT run on this Windows ARM64 machine (workerd has no win32-arm64 build) and the DDL must be pasted into the Cloudflare D1 dashboard console (or run from a non-ARM64 host). `IF NOT EXISTS` makes re-applying the whole file safe (search_events untouched).

### Task 3 — agent-ping invitation in llms.txt (public/llms.txt + scripts/generate-llms-txt.js) — commit 098124f
- Added an identical "## Found this useful? Say hi (optional)" section to both the static file and the generator template, positioned after the Citation section's "Copy directly from there..." paragraph and before "## For agents that want to stay current".
- Section includes the `POST https://claudeatlas.com/api/v1/agent-ping` line with the `{agent, purpose}` body example, the 2 KB cap note, and the malformed-JSON-tolerated note. No `${...}` interpolation (static copy), so the generator's unsubstituted-token sanity check is unaffected.
- Running the generator regenerated public/llms.txt with the invitation present; the regen also refreshed the header catalog counts from the current `data/pipeline-stats.json` (expected — the generator always reseeds counts).

## Verification

- `node --check worker/index.js` → CHECK OK (route + handler + exported `parseAgentPingBody` parse cleanly).
- `node -e` schema regex check → `schema ok` (agent_pings CREATE TABLE + idx_agent_pings_timestamp present with IF NOT EXISTS).
- `node scripts/generate-llms-txt.js` → exit 0, wrote 9,306 bytes; follow-up regex check → `llms.txt invite ok (regenerated + present in both)` (agent-ping invite + POST line present in both static file and generator template).
- Logic review against must_haves: oversized → 413 with no DB access (413 branch precedes any `env.DB` reference); malformed JSON → still acks 200 (parse wrapped in try/catch → `{}`); DB failure → catch only logs then falls through to the 200 ack (no rethrow, no 500); ack carries `SOURCE_CITATION`.

## Deviations from Plan

None — plan executed exactly as written.

## Deferred / Post-Deploy (NOT part of this plan)

The Worker cannot run locally (Windows ARM64; workerd has no win32-arm64 build), so the live endpoint smoke is operator-run after deploy:
1. Apply the `agent_pings` DDL via the Cloudflare D1 dashboard console (claudeatlas-search-log).
2. `curl -X POST .../api/v1/agent-ping -d '{"agent":"test","purpose":"smoke"}'` → expect 200 `{ ok:true, citation:{...} }`.
3. Oversized (>2 KB) body → expect 413 `{ ok:false, error:"body_too_large" }`.
4. Confirm a row landed: `SELECT * FROM agent_pings ORDER BY id DESC LIMIT 5;`.

No deploy was performed (implement + commit only, per constraints).

## Known Stubs

None. The endpoint is fully wired (route → handler → D1 insert → ack); the only manual step is the operator applying the DDL, which is by design (wrangler unavailable on this host).

## Commits

- f02965e — feat(quick-260603): add agentPing handler + route + body validation to worker
- 1a3e0cf — feat(quick-260603): add agent_pings table DDL + operator note to schema.sql
- 098124f — feat(quick-260603): add agent-ping invitation to llms.txt (static + generator)

## Self-Check: PASSED
- worker/index.js: FOUND (parseAgentPingBody + agentPing + route)
- worker/schema.sql: FOUND (agent_pings DDL)
- public/llms.txt: FOUND (agent-ping invite)
- scripts/generate-llms-txt.js: FOUND (agent-ping invite)
- Commits f02965e, 1a3e0cf, 098124f: FOUND in git log

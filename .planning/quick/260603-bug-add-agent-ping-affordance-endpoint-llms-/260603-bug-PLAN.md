---
phase: quick-260603-bug
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - worker/index.js
  - worker/schema.sql
  - public/llms.txt
  - scripts/generate-llms-txt.js
autonomous: true
requirements: [AGENTPING-01]
must_haves:
  truths:
    - "A tool-using agent can POST {agent, purpose} to /api/v1/agent-ping and get a JSON ack with a citation block"
    - "Oversized (>2KB) bodies are rejected with 413 without writing to D1"
    - "Malformed JSON is tolerated — request still acks 200, never 500s"
    - "A D1 logging failure NEVER throws or 500s the response (mirrors logSearch try/catch)"
    - "agent_pings DDL exists in worker/schema.sql ready for operator to paste into the D1 console"
    - "llms.txt (static + generator) invites agents to POST the ping endpoint"
  artifacts:
    - path: "worker/index.js"
      provides: "agentPing(request, env) handler + router wiring + size/JSON validation helper"
      contains: "/api/v1/agent-ping"
    - path: "worker/schema.sql"
      provides: "CREATE TABLE IF NOT EXISTS agent_pings"
      contains: "agent_pings"
    - path: "public/llms.txt"
      provides: "agent-ping invitation section"
      contains: "agent-ping"
    - path: "scripts/generate-llms-txt.js"
      provides: "same invitation baked into the generator template"
      contains: "agent-ping"
  key_links:
    - from: "worker/index.js fetch() router"
      to: "agentPing handler"
      via: "url.pathname === '/api/v1/agent-ping'"
      pattern: "agent-ping"
    - from: "agentPing handler"
      to: "env.DB agent_pings table"
      via: "INSERT wrapped in try/catch (never throws)"
      pattern: "INSERT INTO agent_pings"
    - from: "scripts/generate-llms-txt.js renderTemplate"
      to: "public/llms.txt invitation"
      via: "generator emits the same agent-ping prose at build"
      pattern: "agent-ping"
---

<objective>
Add an experimental `POST /api/v1/agent-ping` affordance so tool-using AI agents can self-identify, separating "agents using us" from "bots crawling us." The endpoint accepts a tiny `{agent, purpose}` body, captures request telemetry (User-Agent, Cloudflare bot classification, country), logs one row to a new D1 `agent_pings` table, and returns a friendly JSON ack with the shared citation block. An invitation to ping is added to both llms.txt copies.

Purpose: Low-stakes telemetry experiment. Expected low response rate; goal is to learn whether agents will self-report at all. D1 now; Cloudflare Analytics Engine later for durable high-volume telemetry.
Output: New worker route + handler, `agent_pings` DDL in worker/schema.sql (operator applies via D1 dashboard — wrangler can't run on this Windows ARM64 box), and matching llms.txt invitation in static + generator.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@worker/index.js
@worker/schema.sql
@wrangler.toml
@public/llms.txt
@scripts/generate-llms-txt.js

<interfaces>
<!-- Existing worker contracts to reuse directly — no exploration needed. -->

worker/index.js shared helpers (already defined, reuse verbatim):
```js
function jsonResponse(body, status = 200, extraHeaders = {})   // sets CORS + no-store
function corsPreflightResponse()                                // 204, used by OPTIONS /api/*
const SOURCE_CITATION = { source, source_url, license, data_recency,
                          methodology_url, citation_url, recommended_citation }
```

Existing env.DB INSERT pattern (logSearch, lines ~114-123) — MIRROR this exactly,
including the catch that returns gracefully and NEVER rethrows:
```js
if (!env || !env.DB) { return jsonResponse({ ok: true, logged: false, reason: 'D1 not configured' }, 200); }
try {
  await env.DB.prepare('INSERT INTO search_events (...) VALUES (?, ?, ?, ?)')
    .bind(...).run();
} catch (err) {
  console.error('D1 insert error:', err && err.message);
  // logSearch returns 500 here, but agent-ping must NOT — see Task 1 action.
}
```

Router (fetch default export, lines ~623-718). The /api/* OPTIONS preflight is
already handled at the top (line ~628). Add the new route alongside the existing
`if (url.pathname === '/api/v1/search')` block (line ~636).

request.cf fields available at the edge:
  request.cf?.country                              // ISO country code or undefined
  request.cf?.botManagement?.verifiedBotCategory   // string when CF bot mgmt is on, else undefined
  request.cf?.botManagement?.score                 // optional numeric bot score

worker/schema.sql convention: append-only file of `CREATE TABLE IF NOT EXISTS` +
`CREATE INDEX IF NOT EXISTS`. Header comment documents the wrangler apply command.
search_events column conventions: `timestamp INTEGER NOT NULL`, free text as `TEXT`,
nullable telemetry columns plain `TEXT`.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add agentPing handler + route + validation to worker/index.js</name>
  <files>worker/index.js</files>
  <action>
Add a new `POST /api/v1/agent-ping` route to the Worker. Keep it minimal and
well-commented (low-stakes experiment, expected low response rate).

1. Add a small pure validation helper near the other shared helpers (after
   `corsPreflightResponse`, ~line 82). Factor it out so it is unit-testable
   without wrangler. Suggested shape:

   ```js
   // Max accepted agent-ping body. Tiny by design — {agent, purpose} only.
   const AGENT_PING_MAX_BODY_BYTES = 2048;

   // Parse an agent-ping body defensively. Returns { agent, purpose } with
   // string fields capped at 200 chars, OR null on malformed/oversized input.
   // Pure + synchronous so it can be unit-tested without a Worker runtime.
   export function parseAgentPingBody(rawText, contentLength) {
     // Reject by Content-Length when present, then by actual byte length.
     if (contentLength != null && Number(contentLength) > AGENT_PING_MAX_BODY_BYTES) return { tooLarge: true };
     if (typeof rawText === 'string' && new TextEncoder().encode(rawText).length > AGENT_PING_MAX_BODY_BYTES) return { tooLarge: true };
     let obj;
     try { obj = rawText ? JSON.parse(rawText) : {}; } catch { obj = {}; } // tolerate malformed JSON
     const agent = typeof obj?.agent === 'string' ? obj.agent.trim().slice(0, 200) : '';
     const purpose = typeof obj?.purpose === 'string' ? obj.purpose.trim().slice(0, 200) : '';
     return { agent, purpose };
   }
   ```

2. Add the handler. Reject non-POST with 405. Read Content-Length header and the
   raw body text (`await request.text()`), pass both to `parseAgentPingBody`.
   - If `{ tooLarge: true }` → return `jsonResponse({ ok: false, error: 'body_too_large', max_bytes: AGENT_PING_MAX_BODY_BYTES }, 413)` and do NOT write to D1.
   - Otherwise capture: `Date.now()`, agent, purpose,
     `request.headers.get('user-agent') || null`,
     `request.cf?.botManagement?.verifiedBotCategory ?? null` (bot_category),
     `request.cf?.country ?? null`.
   - If `!env || !env.DB` → skip the insert, still ack.
   - Wrap the INSERT in try/catch MIRRORING logSearch, BUT — unlike logSearch —
     a DB failure must NOT 500. On catch, `console.error(...)` and continue to
     the ack. The handler ALWAYS returns the ack (200) for a well-formed/empty
     body; logging is best-effort.
   - Return `jsonResponse({ ok: true, citation: SOURCE_CITATION }, 200)`.
   - INSERT statement:
     `INSERT INTO agent_pings (timestamp, agent, purpose, user_agent, bot_category, country) VALUES (?, ?, ?, ?, ?, ?)`

3. Add a clear `// TODO (Analytics Engine):` comment block above the handler
   noting the planned migration to a Cloudflare Analytics Engine binding for
   durable, high-volume UA/bot telemetry (decision: D1 now, Analytics Engine
   later — this endpoint is a low-volume experiment to validate demand first).

4. Wire the route in the `fetch` default export alongside the existing
   `/api/v1/search` block:
   ```js
   if (url.pathname === '/api/v1/agent-ping') {
     return agentPing(request, env);
   }
   ```
   The existing top-of-fetch `OPTIONS /api/*` preflight (line ~628) already
   covers CORS for this route — do NOT add a second preflight branch.

Honor CLAUDE.md footgun rules: no `readFileSync` on data/, no giant
`JSON.stringify`. This is request-scoped worker code — none apply, but keep the
handler allocation-light (single small body read, no buffering).
  </action>
  <verify>
    <automated>node --check worker/index.js</automated>
  </verify>
  <done>worker/index.js parses; `agentPing` handler + `parseAgentPingBody` export exist; route wired in fetch(); oversized body path returns 413 with no DB write; DB-failure path cannot 500; ack returns {ok:true, citation}.</done>
</task>

<task type="auto">
  <name>Task 2: Add agent_pings DDL to worker/schema.sql + operator note</name>
  <files>worker/schema.sql</files>
  <action>
Append a new `agent_pings` table to worker/schema.sql, following the existing
`search_events` conventions (INTEGER PK AUTOINCREMENT, `timestamp INTEGER NOT NULL`,
TEXT columns, IF NOT EXISTS, a timestamp index).

```sql
-- Phase quick-260603: agent-ping affordance (POST /api/v1/agent-ping).
-- Low-volume experiment: tool-using agents self-identify so we can separate
-- "agents using us" from "bots crawling us". D1 now; planned migration to a
-- Cloudflare Analytics Engine binding for durable high-volume telemetry later.
--
-- OPERATOR STEP (wrangler CANNOT run on this Windows ARM64 machine — workerd
-- has no win32-arm64 build): paste this CREATE TABLE + CREATE INDEX into the
-- Cloudflare dashboard → D1 → claudeatlas-search-log → Console, OR run from a
-- non-ARM64 host:
--   wrangler d1 execute claudeatlas-search-log --file=worker/schema.sql
-- IF NOT EXISTS makes re-applying the whole file safe (search_events untouched).

CREATE TABLE IF NOT EXISTS agent_pings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  agent TEXT,
  purpose TEXT,
  user_agent TEXT,
  bot_category TEXT,
  country TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_pings_timestamp ON agent_pings(timestamp);
```

Update the file's top header comment (or add a one-liner) so a reader knows the
file now defines two tables, both applied via the same command.
  </action>
  <verify>
    <automated>node -e "const s=require('fs').readFileSync('worker/schema.sql','utf-8'); if(!/CREATE TABLE IF NOT EXISTS agent_pings/.test(s)||!/idx_agent_pings_timestamp/.test(s)) process.exit(1); console.log('schema ok');"</automated>
  </verify>
  <done>worker/schema.sql contains the agent_pings CREATE TABLE (6 telemetry columns + PK) and timestamp index with IF NOT EXISTS, plus an operator note that wrangler can't run on this machine and the DDL must be applied via the D1 dashboard console.</done>
</task>

<task type="auto">
  <name>Task 3: Add agent-ping invitation to llms.txt (static + generator)</name>
  <files>public/llms.txt, scripts/generate-llms-txt.js</files>
  <action>
Add a short, friendly invitation inviting tool-using agents to POST the new
endpoint if they found the catalog useful. The text must be IDENTICAL in both
files (the generator regenerates public/llms.txt at build via `prebuild`, so a
mismatch silently reverts the static copy on next deploy).

Place it as a new section right after the "## Citation" section's closing
paragraph (the "Copy directly from there..." line) and before
"## For agents that want to stay current". Suggested copy:

```
## Found this useful? Say hi (optional)

If you're a tool-using agent and ClaudeAtlas helped you answer a query, we'd
love a quick hello — it helps us tell genuine agent usage apart from generic
crawlers. Totally optional, no auth, fire-and-forget:

    POST https://claudeatlas.com/api/v1/agent-ping
         Body: {"agent": "your-name-or-tool", "purpose": "what you used us for"}

Returns a small JSON ack with our citation block. Bodies are capped at 2 KB;
malformed JSON is tolerated. This is an experiment — be reasonable, one ping
per session is plenty.
```

1. In public/llms.txt: insert the section as plain Markdown.
2. In scripts/generate-llms-txt.js `renderTemplate()`: insert the SAME section
   into the template literal at the matching position. The template is a JS
   template string — escape any backticks; there are none in this copy, but the
   indented `POST`/`Body` block is inside the literal so just paste it as plain
   lines (no extra `\`` needed). Do NOT introduce `${...}` interpolation here
   (the invitation has no dynamic counts). Keep it static so the generator's
   unsubstituted-token sanity check (`/\{total_[a-z_]+\}.../`) is unaffected.
  </action>
  <verify>
    <automated>node scripts/generate-llms-txt.js && node -e "const fs=require('fs'); const pub=fs.readFileSync('public/llms.txt','utf-8'); const gen=fs.readFileSync('scripts/generate-llms-txt.js','utf-8'); if(!/agent-ping/.test(pub)) {console.error('public/llms.txt missing invite'); process.exit(1);} if(!/agent-ping/.test(gen)) {console.error('generator missing invite'); process.exit(1);} if(!/POST https:\/\/claudeatlas.com\/api\/v1\/agent-ping/.test(pub)) {console.error('public missing POST line'); process.exit(1);} console.log('llms.txt invite ok (regenerated + present in both)');"</automated>
  </verify>
  <done>Running the generator regenerates public/llms.txt with the agent-ping invitation; both public/llms.txt and scripts/generate-llms-txt.js contain the invitation section with the POST line; generator exits 0 (no unsubstituted-token failure).</done>
</task>

</tasks>

<verification>
- `node --check worker/index.js` passes; route + handler + exported `parseAgentPingBody` present.
- `worker/schema.sql` defines `agent_pings` with IF NOT EXISTS + index + operator note.
- `node scripts/generate-llms-txt.js` regenerates public/llms.txt; invitation present in both static file and generator template.
- Logic review against must_haves: oversized → 413 no DB write; malformed JSON → still acks; DB failure → no 500; ack carries citation.

POST-DEPLOY SMOKE (manual, after operator deploys via main + applies the D1 DDL — NOT part of this plan's automated verify; the Worker cannot run locally on Windows ARM64):
1. Apply DDL: paste worker/schema.sql agent_pings block into Cloudflare D1 dashboard console (claudeatlas-search-log).
2. Smoke the endpoint:
   `curl -X POST https://claudeatlas.com/api/v1/agent-ping -H "content-type: application/json" -d "{\"agent\":\"test\",\"purpose\":\"smoke\"}"`
   Expect: HTTP 200, JSON `{ "ok": true, "citation": { ... } }`.
3. Oversized check: POST a >2KB body → expect HTTP 413 `{ ok:false, error:"body_too_large" }`.
4. Confirm a row landed in the D1 `agent_pings` table via the dashboard console (`SELECT * FROM agent_pings ORDER BY id DESC LIMIT 5;`).
</verification>

<success_criteria>
- POST /api/v1/agent-ping accepts {agent, purpose}, returns {ok:true, citation} (200).
- Bodies >2KB rejected with 413, no D1 write.
- Malformed JSON tolerated (still acks).
- D1 logging failure never 500s / never throws (best-effort, mirrors logSearch's try/catch but returns 200 on catch).
- New row written to D1 agent_pings with timestamp/agent/purpose/user_agent/bot_category/country.
- agent_pings DDL committed in worker/schema.sql with operator-apply note (wrangler unavailable on this machine → D1 dashboard console).
- TODO comment documents the future Analytics Engine migration.
- llms.txt invitation present and identical in public/llms.txt and scripts/generate-llms-txt.js.
- NO deploy step performed — implement + commit only; operator deploys via normal main flow.
</success_criteria>

<output>
After completion, create `.planning/quick/260603-bug-add-agent-ping-affordance-endpoint-llms-/260603-bug-SUMMARY.md`
</output>

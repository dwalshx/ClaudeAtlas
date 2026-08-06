---
phase: quick-260806-ejd
plan: 01
subsystem: worker / agent-analytics
tags: [agent-analytics, markdown-negotiation, token-handshake, E2, E3, worker, d1]
requires:
  - quick-260806-dn3 (Wave 1: request_log E1 logging + classifier v0 + run_worker_first=true)
provides:
  - E2 markdown content negotiation (skill pages + root site index from SKILLS_KV)
  - E3 /agent/index.json token handshake + agent_token logging + token_echo classifier rule
affects:
  - request_log D1 table (19th column agent_token via lazy ALTER TABLE)
  - /skills/<slug>/ response headers (Vary: Accept added to Listed HTML path)
tech-stack:
  added: []
  patterns:
    - pure-worker-module + node --test (Wave 1 convention; index.js wiring verified by grep)
    - lazy at-most-once-per-isolate D1 self-migration (second flag mirrors Wave 1's table DDL path)
key-files:
  created:
    - worker/markdown.js
    - worker/markdown.test.js
    - worker/agent-index.js
    - worker/agent-index.test.js
  modified:
    - worker/index.js
    - worker/request-log.js
    - worker/request-log.test.js
    - worker/classify.js
    - worker/classify.test.js
    - worker/schema.sql
    - src/layouts/BaseLayout.astro
    - scripts/generate-llms-txt.js
    - public/llms.txt
decisions:
  - "prefersMarkdown counts ONLY an explicit text/markdown media range (q-aware, tie goes to markdown); */* and text/* never trip it — browser/Googlebot Accepts unaffected, SEO safe"
  - "token_echo is classifier rule 0, BEFORE the UA lists (0.95): an echoed token from a python-requests UA is still class=agent; '; tool=<name>' suffix parses to operator (trimmed, lowercased)"
  - "agent_token live-DB migration is a SECOND at-most-once branch ('no such column' → ALTER TABLE ADD COLUMN + one retry) with its own flag/reset hook — the 'no such table' path never fires in prod since Wave 1 already created the 18-col table"
  - "Vary: Accept added to BOTH markdown responses and the Listed-tier HTML response so the 5-min edge cache can never cross-serve the two renditions of one URL"
metrics:
  duration: "~9 min (2026-08-06T17:36:56Z → 2026-08-06T17:45:23Z)"
  completed: "2026-08-06"
  tasks: 3
  files: 14
---

# Quick 260806-ejd: Wave 2 Agent Analytics — E2 Markdown Negotiation + E3 Token Handshake Summary

Skill pages now content-negotiate to compact markdown straight from SKILLS_KV (no build-time .md siblings), and /agent/index.json serves a stateless per-request token whose X-ClaudeAtlas-Agent echo lands in request_log as a Tier-1 agent signal (class=agent, method=token_echo) via a lazy ALTER TABLE column migration.

## Tasks

| # | Task | Commits |
|---|------|---------|
| 1 | E2 — worker/markdown.js (Accept negotiation + renderers) + index.js wiring | 940dd95 (RED), a95dfac (GREEN) |
| 2 | E3 — /agent/index.json + agent_token column (ALTER TABLE lazy migration) + token_echo rule | 9a04db5 (RED), a2143ed (GREEN) |
| 3 | In-band advertising — BaseLayout link+comment, llms.txt generator + regenerated copy | 88c1065 |

## What was built

### E2 — Markdown content negotiation (Task 1)

- **`worker/markdown.js`** (pure module, zero imports/IO):
  - `prefersMarkdown(accept)` — q-factor-aware parse; true iff an EXPLICIT `text/markdown` range has q>0 AND q ≥ any explicit `text/html` q. Wildcards (`*/*`, `text/*`) never count; whole parse try/caught → false. Chrome's default Accept and Googlebot can never trip it.
  - `renderSkillMarkdown(record)` — E3 preamble blockquote (points at /agent/index.json + the echo header), `# name`, description, tier/score/stars/category/repo metadata list, fenced `claude install-skill <repo_full_name>`, body excerpt via `(extra && extra.body_markdown) || body_markdown || ''` (same fallback as renderListedSkillHtml), detail URL + `Source: ClaudeAtlas — https://claudeatlas.com` footer. Null-safe throughout.
  - `renderSiteIndexMarkdown()` — static <2 KB index: search API, registry, llms.txt, /agent/index.json, feeds, the Accept: text/markdown affordance, echo-header pointer.
- **`worker/index.js` wiring** (all additive, every branch try/caught → falls through to the existing path on ANY error; zero 5xx introduced):
  - `/skills/<slug>/` markdown branch BEFORE the asset probe (KV get → parse → render; miss/error → normal HTML path).
  - `GET /index.md` always serves the site index; `GET /` serves it only on markdown-preferring Accept. Both placed BEFORE the final `env.ASSETS.fetch` fallthrough (plan-checker note honored).
  - Markdown headers: `content-type: text/markdown; charset=utf-8`, `vary: Accept`, `x-robots-tag: noindex`, `cache-control: public, max-age=300`.
  - Hardening: `vary: Accept` added to the Listed-tier HTML response (edge cache can't cross-serve HTML/markdown).
  - robots.txt, /browse, /category/* untouched (locked scope).

### E3 — Token handshake (Task 2)

- **`worker/agent-index.js`**: `generateAgentToken()` = `ca-` + 32 lowercase hex (16 bytes `crypto.getRandomValues` — random, stateless, NEVER IP-derived); `buildAgentIndex({token})` = site info, token, natural-language echo instruction (exact `X-ClaudeAtlas-Agent: <token>` + `; tool=<name>` wording), endpoints (search/feeds/registry/llms.txt/markdown affordance/detail pattern), the 8 categories, SOURCE_CITATION-shaped `source` block.
- **`worker/index.js`**: `GET /agent/index.json` route with the other API routes — `jsonResponse(buildAgentIndex({ token: generateAgentToken() }))`; jsonResponse already sets `cache-control: no-store` (fresh token every fetch). No auth, no state, no D1 write on the route.
- **`worker/classify.js`**: rule 0 (TOP, before UA lists): non-empty string `agentToken` → `agent / 0.95 / token_echo`, operator parsed from optional `; tool=` suffix (trimmed, lowercased, null without). Decision-order comment updated. All 44 prior classify tests unchanged.
- **`worker/request-log.js`**: `agent_token` appended to REQUEST_LOG_COLUMNS (INSERT_SQL derives — now 19 binds); v2 CREATE TABLE DDL carries the column (fresh installs); `buildLogRow` captures `x-claudeatlas-agent` (256-trunc); signals feed `agentToken` into classifyRequest; NEW at-most-once branch in the insert catch: `/no such column/i` → `ALTER TABLE request_log ADD COLUMN agent_token TEXT` via env.DB + exactly one retry (`columnMigrationAttempted` flag + `_resetColumnMigrationAttempted` test hook, mirroring the Wave 1 table path). Any other/second failure → outer catch (logged, never rethrown). This is the LIVE-DB migration path — production request_log already exists with 18 columns.
- **`worker/schema.sql`**: `agent_token TEXT` added to the request_log source-of-truth DDL with migration note.

### In-band advertising (Task 3)

- **BaseLayout.astro** head: `<link rel="alternate" type="application/json" href="/agent/index.json" title="Agent catalog index" />` + agent HTML comment (survives into baked output; wording distinct from any visible UI string per STATE decision 03.3-04; carries NO token — static pages point at the endpoint where the per-request token lives).
- **generate-llms-txt.js**: /agent/index.json block with the one-line echo instruction + markdown-negotiation line, in the "For agents that want to stay current" section. `public/llms.txt` regenerated (9,683 bytes).
- **robots.txt untouched** (verified: 0 diff lines).

## Verification (executor-local)

- `npm test`: **290 pass / 2 fail / 6 skipped** — the 2 failures are the known pre-existing embed-skills.test.js Task 9 B-2 cases (same count as pristine main per Wave 1 SUMMARY). Worker suite alone: 75/75 green (Wave 1's 48 + 27 new).
- `npm run check:patterns`: clean (0 baselined, 0 new).
- Wiring greps confirmed: markdown.js import + prefersMarkdown gate + /index.md + x-robots-tag in index.js; agent-index.js import + /agent/index.json route; agent_token in columns/DDL/schema.sql; token_echo in classify.js.
- Post-merge deploy curls (markdown negotiation, token round-trip → D1 row, llms.txt/homepage adverts, search regression) are the ORCHESTRATOR'S job per plan §verification.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan directory absent from the worktree**
- **Found during:** load_plan
- **Issue:** `.planning/quick/260806-ejd-.../260806-ejd-PLAN.md` existed only in the main checkout, not the worktree branch this executor runs on.
- **Fix:** Read the plan from the main checkout; copied it into the worktree and committed it alongside this SUMMARY (mirrors the Wave 1 260806-dn3 convention where PLAN + SUMMARY are tracked on the branch).
- **Files modified:** .planning/quick/260806-ejd-wave-2-agent-analytics-e2-markdown-conte/260806-ejd-PLAN.md
- **Commit:** docs commit (with this SUMMARY)

No code deviations — all three tasks executed exactly as written.

## Known Stubs

None — every surface is wired end-to-end (markdown renders from live KV, the token route is stateless by design, echoes flow through the existing E1 logging path).

## Commits

- 940dd95 — test(quick-260806-ejd): failing tests for E2 markdown negotiation + renderers
- a95dfac — feat(quick-260806-ejd): E2 markdown content negotiation from SKILLS_KV
- 9a04db5 — test(quick-260806-ejd): failing tests for E3 token handshake
- a2143ed — feat(quick-260806-ejd): E3 token handshake — /agent/index.json + agent_token logging + token_echo rule
- 88c1065 — feat(quick-260806-ejd): advertise /agent/index.json in-band — BaseLayout head + llms.txt

## Next Steps (orchestrator)

1. Merge worktree branch → main, push (fires push-event build + deploy).
2. Run the post-merge deploy curls in plan §verification (markdown Accept round-trips, /index.md, /agent/index.json token uniqueness, token-echo → D1 `SELECT agent_token, class, classifier_method FROM request_log WHERE agent_token LIKE 'ca-%'`).
3. E2 metric readable from day 1 (request_log.accept_header); E3 gate is 60-day (≥5% of bot sessions echo, ≥10 distinct clients).

## Self-Check: PASSED

- All 4 created files exist (worker/markdown.js, worker/markdown.test.js, worker/agent-index.js, worker/agent-index.test.js).
- All 5 commits present on branch: 940dd95, a95dfac, 9a04db5, a2143ed, 88c1065.
- npm test: 290 pass / 2 known pre-existing fails (unchanged count) / 6 skipped; check:patterns clean.

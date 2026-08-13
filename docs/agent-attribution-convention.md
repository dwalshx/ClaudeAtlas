# ClaudeAtlas Agent Attribution Convention

## 1. Status

**DRAFT — 2026-08-09.** This is experiment **E6** of the agent-analytics
experiment series (`docs/agent-traffic-analytics-research.md` §5). It is a
spec draft pending Dan's product review — **nothing in this document is
shipped product, and all rewards described in §4 are PLANNED, not live.**
Nothing here changes worker or site behavior.

## 2. The header convention

Primary header: `X-ClaudeAtlas-Agent`. Grammar:

```
X-ClaudeAtlas-Agent: <token> [; tool=<name>] [; skill=<slug>]
```

- `<token>` — either the per-request random token from
  `GET /agent/index.json` (the E3 handshake; `ca-` + 32 hex chars,
  never derived from the caller's identity) OR a self-chosen stable
  identifier.
- `tool=<name>` — names the calling tool (e.g. `claude-code`, `cursor`).
- `skill=<slug>` — attributes the specific ClaudeAtlas-distributed skill
  making the call.

**Vendor-neutral alias considered:** `X-Agent-Identity` (per research
report 5, Recommendation #3) as the ecosystem-portable spelling. Decision
deferred to Dan — the site-scoped `X-ClaudeAtlas-Agent` name ships first
either way, since it is already parsed in production.

**What is already consumed today:** the `token_echo` classifier rule
(Wave 2, `worker/classify.js`) already parses the `; tool=` parameter into
`request_log.operator`, and the full header value lands in
`request_log.agent_token`. The `skill=` parameter is the only grammar
extension not yet consumed by any code path — it is logged verbatim inside
`agent_token` but not parsed into its own column.

## 3. Rationale — the OpenRouter model

Summary of `docs/agent-analytics-research/05-incentives.md` §2f and §6:

OpenRouter bootstrapped voluntary self-identification on a niche platform
by paying contributors in **marketing visibility**: optional
`HTTP-Referer` / `X-Title` headers feed public app leaderboards and
model-page featuring. Adoption became strong enough that *missing* headers
get bug reports filed against client libraries — identification became a
feature users demand, not a compliance chore. The lesson: **visibility is
the one currency a directory has infinite supply of.**

ClaudeAtlas has a unique accelerant OpenRouter lacked: **it distributes
the code agents run.** A convention embedded in install snippets, docs,
and the skills themselves propagates via distribution, not persuasion —
the same mechanism that made schema.org markup and WordPress-plugin
attribution footers ubiquitous. Authors copy the snippet because it
credits them; the convention spreads as a side effect of the catalog's
own growth.

## 4. Planned rewards (PLANNED — pending Dan's product review)

Neither reward below is built. This document is the spec they would be
built against:

1. **Public "Agents using ClaudeAtlas" leaderboard** — distinct
   tools/operators ranked by request volume, computed from `request_log`
   (`operator`, `agent_token`, `mcp_client` columns). Aggregate-only; no
   per-request or per-IP data exposed.
2. **Per-skill usage attribution for skill authors** — the `skill=`
   parameter resolved to author-facing usage stats ("your skill made N
   identified API calls this week"), crediting distribution back to the
   people who wrote the skills.

## 5. Draft snippet for skill authors' install docs

Copy-paste block for skill READMEs / install docs:

```markdown
This skill uses the ClaudeAtlas API. When calling claudeatlas.com endpoints,
include the header:

    X-ClaudeAtlas-Agent: <token from /agent/index.json>; tool=claude-code; skill=<your-skill-slug>

Identified calls appear (in aggregate) in ClaudeAtlas's public agent stats and
credit your skill's usage to you. No PII: the token is random and per-request.
```

## 6. Experiment status (E1–E7)

Per `docs/agent-traffic-analytics-research.md` §5:

| Exp | What | Status |
|---|---|---|
| E1 | Request logging + classifier v0 (`request_log`, never-default-to-human) | **VERIFIED LIVE** — deployed via daily cron 2026-08-07, verified 2026-08-09. First data: ~143k classified requests. **Upgraded to L1 network-aware v1 (2026-08-12, quick-260812-p3b):** ASN-based impersonation_suspected + datacenter-human downgrade + WBA-verified override + `asn_class` column — see `docs/classifier-v1-notes.md`. |
| E2 | Markdown content negotiation (`Accept: text/markdown` on skill pages + `/index.md`) | Merged; deploy in progress 2026-08-09. |
| E3 | Token handshake `GET /agent/index.json` (echo → `agent_token` + `token_echo` rule) | Merged; deploy in progress 2026-08-09. 60-day gate: ≥5% bot sessions echo, ≥10 distinct clients. |
| E4 | MCP front door (`POST /mcp` + server card + `mcp_client` logging) | Built 2026-08-09 — registry publish pending (Dan); `mcp/server.json` ready. |
| E5 | Web Bot Auth verification (log-only Ed25519) | **VERIFIED LIVE** — deployed via daily cron 2026-08-07, verified 2026-08-09. First data: 1,396 Web Bot Auth verified requests. |
| E6 | Attribution-for-visibility convention (this doc) | Drafted 2026-08-09 — product review pending (Dan); rewards PLANNED, not live. |
| E7 | Retire agent-ping (410 control group) | **VERIFIED LIVE** — deployed via daily cron 2026-08-07, verified 2026-08-09. First data across E1/E5/E7 window: 156 named-agent requests. |

## 7. Measurement

Adoption metrics for this convention, all computable from `request_log`:

- **Voluntary identification rate** — rows carrying `X-ClaudeAtlas-Agent`
  WITHOUT a preceding same-session `/agent/index.json` fetch (i.e.
  self-chosen stable identifiers rather than E3 handshake echoes) — the
  signal that the convention propagated through docs/snippets rather than
  in-band instruction-following.
- **Parameter uptake trend** — share of identified rows carrying `tool=`
  and (once parsed) `skill=` parameters over time.
- **MCP client diversity** — distinct `request_log.mcp_client` values
  (E4's initialize clientInfo), the zero-contamination named-agent
  population to cross-check the voluntary-header numbers against.

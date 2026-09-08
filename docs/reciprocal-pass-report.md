# Reciprocal Pass v1 — how the web treats a declared agent

Run: `2026-09-08T07:22:35.950Z` · Agent: `ClaudeAtlasBot/1.0 (+https://claudeatlas.com/bot)`

One polite, read-only, meta-only pass by a declared AI agent over the operators whose bots appear in the ClaudeAtlas request log. Getting blocked is data, not failure. Details of the agent and how to block it: https://claudeatlas.com/bot/

## Headline

- Targets probed: **1** (1 answered; 0 error, 0 robots-disallowed)
- Block rate (blocked + challenged, of those that answered): **0.0%**
- Allowed rate: **100.0%** (1 allowed · 0 blocked · 0 challenged)
- Challenge pages (Cloudflare / Akamai / captcha): 0
- Toll (HTTP 402 anywhere on the target): 0
- Markdown negotiation (`Accept: text/markdown` honoured): **100.0%**
- Publish a Web Bot Auth key directory (they sign their own requests): 0
- JSON-LD on the homepage: 1
- Cloaking incidence (agent vs browser UA differs by status or >30% size): 0
- Homepage size to an agent: min 147 KB · median 147 KB · max 147 KB
- control_passes (claudeatlas.com passes its own probe): **yes**

## By tier

| tier | n | allowed | blocked | challenged | toll | error | robots_disallowed | md-neg |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| control | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |

## Per target

| domain | tier | result | status | server | md-neg | llms.txt | signs | cloak | bytes |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | ---: |
| claudeatlas.com | control | allowed | 200 | cloudflare | yes | ✓ | no | no | 147 KB |

## Agent-web standards matrix

✓ = 200 with a plausible body · ✗ = the site answered with anything else (404, 403, HTML shell…) · — = not fetched (robots-disallowed) or no HTTP answer (network error)

| domain | `/llms.txt` | `/llms-full.txt` | `/.well-known/agents.json` | `/.well-known/mcp/server-card.json` | `/.well-known/http-message-signatures-directory` | `/ai.txt` |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| claudeatlas.com | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| **adoption** | 1 (100.0%) | 0 (0.0%) | 0 (0.0%) | 1 (100.0%) | 0 (0.0%) | 0 (0.0%) |

## robots.txt posture

| domain | present | policy | names AI bots | disallows all bots | disallows us | content-signal | sitemap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| claudeatlas.com | yes | parsed | 7 (0 disallowed) | no | no | `search=yes,ai-input=yes,ai-train=no` | yes |
| **totals** | 1 | | 1 | 0 | 0 | 1 | 1 |

## Method

User-Agent `ClaudeAtlasBot/1.0 (+https://claudeatlas.com/bot)`. Per target: `GET /robots.txt` first, then — only if robots.txt allows us — `GET /` three times (agent UA with an HTML Accept, agent UA with `Accept: text/markdown, text/html;q=0.9`, and a standard browser UA for the single cloaking comparison), then each of 6 fixed well-known paths (`/llms.txt`, `/llms-full.txt`, `/.well-known/agents.json`, `/.well-known/mcp/server-card.json`, `/.well-known/http-message-signatures-directory`, `/ai.txt`), each individually gated by robots.txt. Policy: GET only; ≥3000 ms between consecutive requests to one host (redirect hops included); at most 3 hosts in flight; 15000 ms timeout per hop; ≤5 redirects; ≤512 KB read per response; 1 retry on network error only, never on any HTTP status. A robots.txt 4xx is treated as allow-all, a 5xx/timeout as disallow-all. Only statuses, selected headers, byte counts, robots directives, JSON-LD counts and content-types are recorded — no page text. The per-target result is the agent-UA homepage classification; rates are over targets that answered (excluding network errors and robots-disallowed). The block rate counts both hard blocks (401/403/429/451) and interstitial challenge pages; a 402 anywhere on the target is recorded as a toll.

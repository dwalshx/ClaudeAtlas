# Reciprocal Pass v1 — how the web treats a declared bot

Run: `2026-09-10T17:34:10.482Z` · Agent: `ClaudeAtlasBot/1.0 (+https://claudeatlas.com/bot)`

One polite, read-only, meta-only pass by a self-declared bot (a fixed-probe crawler, no model in the loop) over the operators whose bots appear in the ClaudeAtlas request log. Servers see the declaration, not what sits behind it, so this is the treatment any declared automated client — agent or crawler — receives. Getting blocked is data, not failure. Details of the bot and how to block it: https://claudeatlas.com/bot/

## Headline

- Targets probed: **27** (27 answered; 0 error, 0 robots-disallowed)
- Block rate (blocked + challenged, of those that answered): **18.5%**
- Allowed rate: **81.5%** (22 allowed · 2 blocked · 3 challenged)
- Challenge pages (Cloudflare / Akamai / captcha): 3
- Toll (HTTP 402 anywhere on the target): 0
- Markdown negotiation (`Accept: text/markdown` honoured): **7.4%**
- Publish a Web Bot Auth key directory (they sign their own requests): 2
- JSON-LD on the homepage: 10
- Cloaking incidence (agent vs browser UA differs by status or >30% size): 6
- Homepage size to an agent: min 366 B · median 173 KB · max 512 KB
- control_passes (claudeatlas.com passes its own probe): **yes**

## By tier

| tier | n | allowed | blocked | challenged | toll | error | robots_disallowed | md-neg |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| named-operator | 14 | 10 | 1 | 3 | 0 | 0 | 0 | 0 |
| infrastructure | 11 | 10 | 1 | 0 | 0 | 0 | 0 | 1 |
| control | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| seed | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |

## Per target

| domain | tier | result | status | server | md-neg | llms.txt | signs | cloak | bytes |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | ---: |
| semrush.com | named-operator | allowed | 200 | nginx | no | ✓ | no | no | 192 KB |
| amazon.com | named-operator | challenged | 503 | Server | no | ✗ | no | yes (status) | 4 KB |
| apple.com | named-operator | allowed | 200 | Apple | no | ✗ | no | no | 31 KB |
| ahrefs.com | named-operator | allowed | 200 | cloudflare | no | ✗ | yes | no | 512 KB |
| openai.com | named-operator | challenged | 403 | cloudflare | no | ✗ | no | yes (status) | 10 KB |
| dataforseo.com | named-operator | allowed | 200 | cloudflare | no | ✓ | no | no | 512 KB |
| bytedance.com | named-operator | allowed | 200 | TLB | no | ✗ | no | yes (size) | 100 KB |
| huawei.com | named-operator | blocked | 403 | AkamaiGHost | no | ✗ | no | no | 366 B |
| microsoft.com | named-operator | allowed | 200 | — | no | ✗ | no | yes (size) | 33 KB |
| anthropic.com | named-operator | allowed | 200 | cloudflare | no | ✗ | no | no | 173 KB |
| google.com | named-operator | allowed | 200 | gws | no | ✗ | no | no | 82 KB |
| meta.com | named-operator | allowed | 200 | — | no | ✗ | yes | — | 512 KB |
| perplexity.ai | named-operator | challenged | 403 | cloudflare | no | ✗ | no | no | 5 KB |
| mistral.ai | named-operator | allowed | 200 | cloudflare | no | ✓ | no | no | 463 KB |
| aws.amazon.com | infrastructure | allowed | 200 | Server | no | ✗ | no | no | 510 KB |
| azure.microsoft.com | infrastructure | allowed | 200 | — | no | ✓ | no | yes (size) | 457 KB |
| alibabacloud.com | infrastructure | allowed | 200 | Tengine | no | ✗ | no | no | 23 KB |
| cloud.tencent.com | infrastructure | allowed | 200 | nginx | no | ✓ | no | no | 208 KB |
| ksyun.com | infrastructure | allowed | 200 | openresty | no | ✗ | no | no | 208 KB |
| ovhcloud.com | infrastructure | allowed | 200 | — | no | ✗ | no | yes (size) | 366 KB |
| hetzner.com | infrastructure | allowed | 200 | HeRay | no | ✗ | no | no | 15 KB |
| oracle.com | infrastructure | blocked | 403 | AkamaiGHost | no | ✗ | no | no | 1 KB |
| cloudflare.com | infrastructure | allowed | 200 | cloudflare | yes | ✓ | no | no | 512 KB |
| digitalocean.com | infrastructure | allowed | 200 | cloudflare | no | ✗ | no | no | 281 KB |
| contabo.com | infrastructure | allowed | 200 | cloudflare | no | ✓ | no | no | 512 KB |
| claudeatlas.com | control | allowed | 200 | cloudflare | yes | ✓ | no | no | 147 KB |
| commoncrawl.org | seed | allowed | 200 | cloudflare | no | ✗ | no | no | 26 KB |

## Agent-web standards matrix

✓ = 200 with a plausible body · ✗ = the site answered with anything else (404, 403, HTML shell…) · — = not fetched (robots-disallowed) or no HTTP answer (network error)

| domain | `/llms.txt` | `/llms-full.txt` | `/.well-known/agents.json` | `/.well-known/mcp/server-card.json` | `/.well-known/http-message-signatures-directory` | `/ai.txt` |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| semrush.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| amazon.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| apple.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| ahrefs.com | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| openai.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| dataforseo.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| bytedance.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| huawei.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| microsoft.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| anthropic.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| google.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| meta.com | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| perplexity.ai | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| mistral.ai | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| aws.amazon.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| azure.microsoft.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| alibabacloud.com | ✗ | ✗ | — | — | ✗ | ✗ |
| cloud.tencent.com | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| ksyun.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| ovhcloud.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| hetzner.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| oracle.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| cloudflare.com | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| digitalocean.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| contabo.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| claudeatlas.com | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| commoncrawl.org | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **adoption** | 8 (29.6%) | 2 (7.4%) | 1 (3.7%) | 1 (3.7%) | 2 (7.4%) | 0 (0.0%) |

## robots.txt posture

| domain | present | policy | names AI bots | disallows all bots | disallows us | content-signal | sitemap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| semrush.com | yes | parsed | no | no | no | no | yes |
| amazon.com | yes | parsed | 12 (12 disallowed) | no | no | no | no |
| apple.com | yes | parsed | no | no | no | no | yes |
| ahrefs.com | yes | parsed | no | no | no | no | no |
| openai.com | yes | parsed | no | no | no | no | yes |
| dataforseo.com | yes | parsed | no | no | no | no | yes |
| bytedance.com | yes | parsed | no | no | no | no | no |
| huawei.com | no | allow_all | no | no | no | no | no |
| microsoft.com | yes | parsed | no | no | no | no | yes |
| anthropic.com | yes | parsed | no | no | no | no | yes |
| google.com | yes | parsed | no | no | no | no | yes |
| meta.com | yes | parsed | no | no | no | no | yes |
| perplexity.ai | yes | parsed | no | no | no | no | yes |
| mistral.ai | yes | parsed | no | no | no | no | yes |
| aws.amazon.com | yes | parsed | no | no | no | no | yes |
| azure.microsoft.com | yes | parsed | no | no | no | no | yes |
| alibabacloud.com | yes | parsed | no | no | no | no | yes |
| cloud.tencent.com | yes | parsed | no | no | no | no | yes |
| ksyun.com | yes | parsed | no | no | no | no | yes |
| ovhcloud.com | yes | parsed | no | no | no | no | yes |
| hetzner.com | yes | parsed | no | no | no | no | yes |
| oracle.com | no | allow_all | no | no | no | no | no |
| cloudflare.com | yes | parsed | 7 (0 disallowed) | no | no | `ai-train=yes, search=yes, ai-input=yes` | yes |
| digitalocean.com | yes | parsed | no | no | no | no | yes |
| contabo.com | yes | parsed | no | no | no | no | yes |
| claudeatlas.com | yes | parsed | 7 (0 disallowed) | no | no | `search=yes,ai-input=yes,ai-train=no` | yes |
| commoncrawl.org | yes | parsed | no | no | no | no | yes |
| **totals** | 25 | | 3 | 0 | 0 | 2 | 22 |

## Method

User-Agent `ClaudeAtlasBot/1.0 (+https://claudeatlas.com/bot)`. Per target: `GET /robots.txt` first, then — only if robots.txt allows us — `GET /` three times (agent UA with an HTML Accept, agent UA with `Accept: text/markdown, text/html;q=0.9`, and a standard browser UA for the single cloaking comparison), then each of 6 fixed well-known paths (`/llms.txt`, `/llms-full.txt`, `/.well-known/agents.json`, `/.well-known/mcp/server-card.json`, `/.well-known/http-message-signatures-directory`, `/ai.txt`), each individually gated by robots.txt. Policy: GET only; ≥3000 ms between consecutive requests to one host (redirect hops included); at most 3 hosts in flight; 15000 ms timeout per hop; ≤5 redirects; ≤512 KB read per response; 1 retry on network error only, never on any HTTP status. A robots.txt 4xx is treated as allow-all, a 5xx/timeout as disallow-all. Only statuses, selected headers, byte counts, robots directives, JSON-LD counts and content-types are recorded — no page text. The per-target result is the agent-UA homepage classification; rates are over targets that answered (excluding network errors and robots-disallowed). The block rate counts both hard blocks (401/403/429/451) and interstitial challenge pages; a 402 anywhere on the target is recorded as a toll.

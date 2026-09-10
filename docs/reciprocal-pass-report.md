# Reciprocal Pass v1 — how the web treats a declared bot

Run: `2026-09-10T18:49:01.171Z` · Agent: `ClaudeAtlasBot/1.0 (+https://claudeatlas.com/bot)`

Finished: `2026-09-10T19:02:55.115Z` · Wall-clock: **13m 54s** · Requests: **2581** · Sum of per-target time: 82m 19s (6 hosts in flight)

One polite, read-only, meta-only pass by a self-declared bot (a fixed-probe crawler, no model in the loop) over the operators whose bots appear in the ClaudeAtlas request log. Servers see the declaration, not what sits behind it, so this is the treatment any declared automated client — agent or crawler — receives. Getting blocked is data, not failure. Details of the bot and how to block it: https://claudeatlas.com/bot/

## Headline

- Targets probed: **157** (147 answered; 1 error, 9 robots-disallowed)
- Block rate (blocked + challenged, of those that answered): **15.6%**
- Allowed rate: **84.4%** (124 allowed · 10 blocked · 13 challenged)
- Challenge pages (Cloudflare / Akamai / captcha): 13
- Toll (HTTP 402 anywhere on the target): 0
- Markdown negotiation (`Accept: text/markdown` honoured): **8.2%**
- Publish a Web Bot Auth key directory (they sign their own requests): 4
- JSON-LD on the homepage: 53
- Cloaking incidence (agent vs browser UA differs by status or >30% size): 18
- Homepage size to an agent: min 357 B · median 202 KB · max 512 KB
- control_passes (claudeatlas.com passes its own probe): **yes**

## By tier

| tier | n | allowed | blocked | challenged | toll | error | robots_disallowed | md-neg | question |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| named-operator | 14 | 10 | 1 | 3 | 0 | 0 | 0 | 0 | Do the operators whose bots crawl us let a declared bot crawl them? |
| infrastructure | 11 | 10 | 1 | 0 | 0 | 0 | 0 | 1 | Do the cloud vendors hosting most anonymous scraper traffic admit a declared bot to their own sites? |
| control | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | Do we pass our own probe? |
| seed | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | Scope-doc seeds not yet seen in the request log. |
| agent-native | 10 | 10 | 0 | 0 | 0 | 0 | 0 | 3 | Are the companies building the agent economy agent-ready themselves? |
| positive-control | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 2 | Known llms.txt publishers — if these show a cross, the standards probe is broken, not the site. |
| ecommerce | 7 | 4 | 1 | 1 | 0 | 0 | 1 | 0 | How does the agentic-commerce battleground treat a declared bot? |
| publisher | 10 | 7 | 0 | 1 | 0 | 0 | 2 | 0 | How do licensing-deal-era publishers treat a declared bot, and do they name AI bots in robots.txt? |
| travel-local | 7 | 3 | 1 | 1 | 0 | 0 | 2 | 0 | Can a declared bot reach the booking and local-discovery sites agents are demoed on? |
| dev-reference | 6 | 4 | 0 | 2 | 0 | 0 | 0 | 1 | Do the sources coding agents actually fetch admit a declared bot? |
| bot-defense | 5 | 4 | 0 | 1 | 0 | 0 | 0 | 0 | Do bot-defense vendors let a polite declared bot through their own front door? |
| public-info | 5 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | Is public-interest information reachable by a declared bot? |
| citation | 77 | 62 | 6 | 4 | 0 | 1 | 4 | 4 | How do the domains AI assistants most often cite (top slice of 2,000+ unique domains from our AEO probe runs) treat a declared bot? |

## Cited cohort

The **87** targets flagged `cited` are the top-cited slice of the 2,000+ unique domains AI assistants cited across the ClaudeAtlas AEO probe runs — the sites assistants send people to, probed exactly like everything else.

| n | answered | allowed | blocked | challenged | error | robots_disallowed | block_rate | allowed_rate | md-neg rate | llms.txt | signers |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 87 | 81 | 69 | 6 | 6 | 1 | 5 | 14.8% | 85.2% | 4.9% | 22 | 1 |

## Per target

| domain | tier | cited | result | status | server | md-neg | llms.txt | signs | cloak | bytes |
| --- | --- | :-: | --- | ---: | --- | --- | --- | --- | --- | ---: |
| semrush.com | named-operator | ✓ | allowed | 200 | nginx | no | ✓ | no | no | 193 KB |
| amazon.com | named-operator |  | challenged | 503 | Server | no | ✗ | no | yes (status) | 4 KB |
| apple.com | named-operator |  | allowed | 200 | Apple | no | ✗ | no | no | 31 KB |
| ahrefs.com | named-operator |  | allowed | 200 | cloudflare | no | ✗ | yes | no | 512 KB |
| openai.com | named-operator | ✓ | challenged | 403 | cloudflare | no | ✗ | no | yes (status) | 10 KB |
| dataforseo.com | named-operator |  | allowed | 200 | cloudflare | no | ✓ | no | no | 512 KB |
| bytedance.com | named-operator |  | allowed | 200 | TLB | no | ✗ | no | no | 197 KB |
| huawei.com | named-operator |  | blocked | 403 | AkamaiGHost | no | ✗ | no | no | 366 B |
| microsoft.com | named-operator |  | allowed | 200 | — | no | ✗ | no | yes (size) | 33 KB |
| anthropic.com | named-operator | ✓ | allowed | 200 | cloudflare | no | ✗ | no | no | 173 KB |
| google.com | named-operator |  | allowed | 200 | gws | no | ✗ | no | no | 82 KB |
| meta.com | named-operator |  | allowed | 200 | — | no | ✗ | yes | — | 512 KB |
| perplexity.ai | named-operator |  | challenged | 403 | cloudflare | no | ✗ | no | no | 5 KB |
| mistral.ai | named-operator |  | allowed | 200 | cloudflare | no | ✓ | no | no | 463 KB |
| aws.amazon.com | infrastructure |  | allowed | 200 | Server | no | ✗ | no | no | 510 KB |
| azure.microsoft.com | infrastructure |  | allowed | 200 | — | no | ✓ | no | no | 50 KB |
| alibabacloud.com | infrastructure |  | allowed | 200 | Tengine | no | ✗ | no | no | 23 KB |
| cloud.tencent.com | infrastructure |  | allowed | 200 | nginx | no | ✓ | no | no | 208 KB |
| ksyun.com | infrastructure |  | allowed | 200 | openresty | no | ✗ | no | no | 208 KB |
| ovhcloud.com | infrastructure |  | allowed | 200 | — | no | ✗ | no | no | 366 KB |
| hetzner.com | infrastructure |  | allowed | 200 | HeRay | no | ✗ | no | no | 15 KB |
| oracle.com | infrastructure |  | blocked | 403 | AkamaiGHost | no | ✗ | no | no | 1 KB |
| cloudflare.com | infrastructure |  | allowed | 200 | cloudflare | yes | ✓ | no | no | 512 KB |
| digitalocean.com | infrastructure |  | allowed | 200 | cloudflare | no | ✗ | no | no | 281 KB |
| contabo.com | infrastructure |  | allowed | 200 | cloudflare | no | ✓ | no | no | 512 KB |
| claudeatlas.com | control |  | allowed | 200 | cloudflare | yes | ✓ | no | no | 147 KB |
| commoncrawl.org | seed |  | allowed | 200 | cloudflare | no | ✗ | no | no | 26 KB |
| huggingface.co | agent-native |  | allowed | 200 | — | no | ✗ | no | no | 173 KB |
| vercel.com | agent-native |  | allowed | 200 | Vercel | yes | ✓ | no | no | 512 KB |
| docs.stripe.com | agent-native |  | allowed | 200 | nginx | yes | ✓ | no | no | 512 KB |
| shopify.com | agent-native |  | allowed | 200 | cloudflare | no | ✓ | yes | no | 512 KB |
| cursor.com | agent-native |  | allowed | 200 | Vercel | no | ✓ | no | no | 512 KB |
| langchain.com | agent-native |  | allowed | 200 | cloudflare | no | ✗ | no | no | 267 KB |
| x.ai | agent-native |  | allowed | 200 | cloudflare | no | ✗ | no | yes (status) | 233 KB |
| cohere.com | agent-native |  | allowed | 200 | Vercel | no | ✓ | no | no | 512 KB |
| deepseek.com | agent-native |  | allowed | 200 | AmazonS3 | no | ✗ | no | no | 83 KB |
| replicate.com | agent-native |  | allowed | 200 | cloudflare | yes | ✓ | no | no | 329 KB |
| docs.anthropic.com | positive-control |  | allowed | 200 | cloudflare | yes | ✓ | no | no | 446 KB |
| developers.cloudflare.com | positive-control |  | allowed | 200 | cloudflare | yes | ✓ | no | no | 182 KB |
| mintlify.com | positive-control |  | allowed | 200 | cloudflare | no | ✓ | no | no | 375 KB |
| ebay.com | ecommerce |  | blocked | 403 | AkamaiGHost | no | ✗ | no | no | 2 KB |
| walmart.com | ecommerce |  | allowed | 200 | — | no | ✗ | no | no | 78 KB |
| target.com | ecommerce |  | allowed | 200 | — | no | ✓ | no | no | 393 KB |
| etsy.com | ecommerce |  | challenged | 403 | DataDome | no | ✗ | no | no | 776 B |
| bestbuy.com | ecommerce | ✓ | allowed | 200 | — | no | ✗ | no | — | 512 KB |
| instacart.com | ecommerce |  | robots_disallowed | — | — | no | — | no | — | — |
| wayfair.com | ecommerce |  | allowed | 200 | cloudflare | no | ✗ | no | yes (status) | 512 KB |
| nytimes.com | publisher | ✓ | allowed | 200 | envoy | no | ✗ | no | no | 256 KB |
| reddit.com | publisher | ✓ | robots_disallowed | — | — | no | — | no | — | — |
| en.wikipedia.org | publisher | ✓ | allowed | 200 | mw-web.codfw.main-655bf5bbb4-n9m9p | no | ✗ | no | no | 49 KB |
| bbc.com | publisher |  | allowed | 200 | BBC-GTM | no | ✗ | no | no | 94 KB |
| theguardian.com | publisher |  | allowed | 200 | — | no | ✗ | no | no | 154 KB |
| reuters.com | publisher |  | robots_disallowed | — | — | no | — | no | — | — |
| forbes.com | publisher | ✓ | allowed | 200 | istio-envoy | no | ✗ | no | no | 143 KB |
| medium.com | publisher | ✓ | challenged | 403 | cloudflare | no | ✗ | no | yes (status) | 5 KB |
| substack.com | publisher |  | allowed | 200 | cloudflare | no | ✗ | no | no | 285 KB |
| theatlantic.com | publisher |  | allowed | 200 | cloudflare | no | ✗ | no | no | 390 KB |
| booking.com | travel-local |  | allowed | 202 | CloudFront | no | ✗ | no | no | 2 KB |
| expedia.com | travel-local |  | blocked | 429 | istio-envoy | no | ✓ | no | no | 111 KB |
| airbnb.com | travel-local |  | allowed | 200 | nginx | no | ✗ | no | no | 512 KB |
| tripadvisor.com | travel-local |  | challenged | 403 | DataDome | no | ✗ | no | no | 775 B |
| yelp.com | travel-local |  | robots_disallowed | — | — | no | — | no | — | — |
| zillow.com | travel-local |  | allowed | 200 | CloudFront | no | ✗ | no | yes (status) | 459 KB |
| opentable.com | travel-local |  | robots_disallowed | — | — | no | — | no | — | — |
| github.com | dev-reference | ✓ | allowed | 200 | github.com | no | ✓ | no | no | 512 KB |
| stackoverflow.com | dev-reference |  | challenged | 403 | cloudflare | no | ✗ | no | no | 5 KB |
| developer.mozilla.org | dev-reference |  | allowed | 200 | Google Frontend | no | ✗ | no | no | 14 KB |
| npmjs.com | dev-reference |  | challenged | 403 | cloudflare | no | ✗ | no | no | 5 KB |
| pypi.org | dev-reference |  | allowed | 200 | gunicorn | no | ✗ | no | no | 6 KB |
| readthedocs.org | dev-reference |  | allowed | 200 | cloudflare | yes | ✗ | no | no | 33 KB |
| akamai.com | bot-defense |  | allowed | 200 | — | no | ✗ | no | yes (status) | 30 KB |
| imperva.com | bot-defense |  | allowed | 200 | — | no | ✗ | no | no | 243 KB |
| datadome.co | bot-defense |  | challenged | 403 | CloudFront | no | ✗ | no | no | 771 B |
| humansecurity.com | bot-defense |  | allowed | 200 | cloudflare | no | ✗ | no | yes (status) | 512 KB |
| fastly.com | bot-defense |  | allowed | 200 | Artisanal bits | no | ✓ | no | yes (size) | 42 KB |
| usa.gov | public-info |  | allowed | 200 | — | no | ✗ | no | no | 46 KB |
| irs.gov | public-info |  | allowed | 200 | — | no | ✗ | no | no | 22 KB |
| nih.gov | public-info |  | allowed | 200 | cloudflare | no | ✗ | no | yes (status) | 61 KB |
| w3.org | public-info |  | allowed | 200 | cloudflare | no | ✗ | no | yes (status) | 50 KB |
| ietf.org | public-info |  | allowed | 200 | cloudflare | no | ✗ | no | no | 83 KB |
| youtube.com | citation | ✓ | allowed | 200 | ESF | no | ✗ | no | no | 512 KB |
| tomsguide.com | citation | ✓ | allowed | 200 | — | no | ✗ | no | no | 475 KB |
| facebook.com | citation | ✓ | robots_disallowed | — | — | no | — | no | — | — |
| apps.apple.com | citation | ✓ | allowed | 200 | daiquiri/5 | no | ✗ | no | no | 91 KB |
| asics.com | citation | ✓ | blocked | 403 | AkamaiGHost | no | ✗ | no | no | 386 B |
| rtings.com | citation | ✓ | allowed | 200 | openresty/1.21.4.3 | no | ✗ | no | no | 262 KB |
| linkedin.com | citation | ✓ | allowed | 200 | cloudflare | no | ✗ | no | no | 15 KB |
| consumerreports.org | citation | ✓ | allowed | 200 | — | no | ✗ | no | no | 471 KB |
| runnersworld.com | citation | ✓ | allowed | 200 | — | no | ✗ | no | no | 512 KB |
| nerdwallet.com | citation | ✓ | allowed | 200 | cloudflare | no | ✗ | no | no | 512 KB |
| play.google.com | citation | ✓ | allowed | 200 | ESF | no | ✗ | no | no | 512 KB |
| g2.com | citation | ✓ | challenged | 403 | cloudflare | no | ✓ | no | no | 2 KB |
| sleepfoundation.org | citation | ✓ | allowed | 200 | nginx | no | ✗ | no | no | 282 KB |
| runningwarehouse.com | citation | ✓ | robots_disallowed | — | — | no | — | no | — | — |
| runrepeat.com | citation | ✓ | allowed | 200 | nginx | no | ✗ | no | no | 372 KB |
| brooksrunning.com | citation | ✓ | blocked | 403 | AkamaiGHost | no | ✗ | no | no | 373 B |
| bankrate.com | citation | ✓ | allowed | 200 | — | no | ✓ | no | no | 286 KB |
| doctorsofrunning.com | citation | ✓ | allowed | 200 | cloudflare | no | ✓ | no | no | 282 KB |
| mcpmarket.com | citation | ✓ | blocked | 429 | Vercel | no | ✗ | no | no | 31 KB |
| businessinsider.com | citation | ✓ | allowed | 200 | — | no | ✗ | no | no | 68 KB |
| naplab.com | citation | ✓ | allowed | 200 | cloudflare | no | ✗ | no | no | 480 KB |
| cnet.com | citation | ✓ | allowed | 200 | nginx | no | ✗ | no | no | 404 KB |
| rei.com | citation | ✓ | blocked | 403 | — | no | ✗ | no | — | 357 B |
| techradar.com | citation | ✓ | allowed | 200 | — | no | ✗ | no | no | 348 KB |
| nike.com | citation | ✓ | allowed | 200 | unified-edge-router | no | ✗ | no | no | 512 KB |
| mattressnerd.com | citation | ✓ | allowed | 200 | AmazonS3 | no | ✗ | no | no | 512 KB |
| trustpilot.com | citation | ✓ | robots_disallowed | — | — | no | — | no | — | — |
| pcmag.com | citation | ✓ | allowed | 200 | cloudflare | no | ✗ | no | no | 512 KB |
| bible.com | citation | ✓ | allowed | 200 | nginx | no | ✗ | no | yes (size) | 89 KB |
| wired.com | citation | ✓ | allowed | 200 | cloudflare | no | ✗ | no | no | 512 KB |
| saatva.com | citation | ✓ | allowed | 200 | CloudFront | no | ✓ | no | no | 512 KB |
| usnews.com | citation | ✓ | error | — | — | no | — | no | — | — |
| code.claude.com | citation | ✓ | allowed | 200 | cloudflare | no | ✓ | no | no | 512 KB |
| goodhousekeeping.com | citation | ✓ | allowed | 200 | — | no | ✓ | no | no | 512 KB |
| casper.com | citation | ✓ | allowed | 200 | cloudflare | yes | ✓ | no | no | 98 KB |
| sleepadvisor.org | citation | ✓ | allowed | 200 | AmazonS3 | no | ✗ | no | no | 496 KB |
| mattressclarity.com | citation | ✓ | allowed | 200 | AmazonS3 | no | ✗ | no | no | 512 KB |
| finance.yahoo.com | citation | ✓ | allowed | 200 | ATS | no | ✗ | no | — | 512 KB |
| fool.com | citation | ✓ | allowed | 200 | cloudflare | no | ✗ | no | no | 346 KB |
| t3.com | citation | ✓ | allowed | 200 | — | no | ✗ | no | no | 512 KB |
| jdpower.com | citation | ✓ | challenged | 403 | cloudflare | no | ✗ | no | yes (size) | 5 KB |
| platform.claude.com | citation | ✓ | allowed | 200 | cloudflare | no | ✓ | no | no | 206 KB |
| whistleout.com | citation | ✓ | allowed | 200 | cloudflare | no | ✗ | no | yes (status) | 76 KB |
| logos.com | citation | ✓ | allowed | 200 | — | no | ✗ | no | no | 512 KB |
| fleetfeet.com | citation | ✓ | allowed | 200 | — | no | ✗ | no | no | 49 KB |
| help.youversion.com | citation | ✓ | allowed | 200 | openresty | no | ✗ | no | no | 43 KB |
| arxiv.org | citation | ✓ | allowed | 200 | Google Frontend | no | ✗ | no | no | 37 KB |
| podcasts.apple.com | citation | ✓ | allowed | 200 | daiquiri/5 | no | ✓ | no | no | 245 KB |
| runningshoesguru.com | citation | ✓ | allowed | 200 | cloudflare | yes | ✗ | no | no | 192 KB |
| believeintherun.com | citation | ✓ | allowed | 200 | cloudflare | no | ✗ | no | no | 201 KB |
| zapier.com | citation | ✓ | allowed | 200 | Vercel | yes | ✓ | no | no | 512 KB |
| sleepopolis.com | citation | ✓ | allowed | 200 | AmazonS3 | no | ✗ | no | no | 512 KB |
| aad.org | citation | ✓ | allowed | 200 | — | no | ✗ | no | no | 5 KB |
| clickup.com | citation | ✓ | allowed | 200 | AmazonS3 | no | ✓ | no | no | 512 KB |
| solereview.com | citation | ✓ | allowed | 200 | cloudflare | no | ✓ | no | yes (status) | 82 KB |
| reviewed.com | citation | ✓ | allowed | 200 | cloudflare | no | ✗ | no | no | 92 KB |
| babygearlab.com | citation | ✓ | allowed | 200 | Apache | no | ✗ | no | no | 202 KB |
| babylist.com | citation | ✓ | allowed | 200 | cloudflare | no | ✓ | no | no | 184 KB |
| hubspot.com | citation | ✓ | allowed | 200 | cloudflare | no | ✓ | no | no | 512 KB |
| cnbc.com | citation | ✓ | blocked | 403 | AkamaiGHost | no | ✗ | no | yes (status) | 366 B |
| thepointsguy.com | citation | ✓ | allowed | 200 | — | no | ✗ | no | no | 94 KB |
| capterra.com | citation | ✓ | challenged | 403 | cloudflare | no | ✗ | no | no | 5 KB |
| blog.hubspot.com | citation | ✓ | allowed | 200 | cloudflare | no | ✓ | no | no | 402 KB |
| warmpeach.com | citation | ✓ | allowed | 200 | cloudflare | no | ✓ | no | no | 137 KB |
| support.anthropic.com | citation | ✓ | allowed | 200 | cloudflare | no | ✓ | no | no | 329 KB |
| behindthename.com | citation | ✓ | allowed | 200 | cloudflare | no | ✗ | no | no | 14 KB |
| newbalance.com | citation | ✓ | blocked | 403 | AkamaiGHost | no | ✗ | no | no | 634 B |
| healthline.com | citation | ✓ | allowed | 200 | — | no | ✗ | yes | no | 341 KB |
| runtothefinish.com | citation | ✓ | allowed | 200 | cloudflare | no | ✗ | no | no | 465 KB |
| irunfar.com | citation | ✓ | allowed | 200 | cloudflare | no | ✓ | no | yes (status) | 219 KB |
| experian.com | citation | ✓ | allowed | 200 |  | no | ✗ | no | no | 280 KB |
| marketwatch.com | citation | ✓ | robots_disallowed | — | — | no | — | no | — | — |
| thezebra.com | citation | ✓ | challenged | 403 | cloudflare | no | ✓ | no | no | 5 KB |
| wallethub.com | citation | ✓ | allowed | 200 | cloudflare | no | ✗ | no | no | 152 KB |
| purple.com | citation | ✓ | allowed | 200 | cloudflare | yes | ✓ | no | no | 510 KB |
| capitalone.com | citation | ✓ | allowed | 200 | — | no | ✗ | no | no | 105 KB |
| nameberry.com | citation | ✓ | allowed | 200 | Vercel | no | ✗ | no | no | 377 KB |

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
| huggingface.co | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| vercel.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| docs.stripe.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| shopify.com | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ |
| cursor.com | ✓ | ✗ | — | ✗ | ✗ | ✗ |
| langchain.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| x.ai | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| cohere.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| deepseek.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| replicate.com | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| docs.anthropic.com | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| developers.cloudflare.com | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| mintlify.com | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| ebay.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| walmart.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| target.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| etsy.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| bestbuy.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| instacart.com | — | — | — | — | — | — |
| wayfair.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| nytimes.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| reddit.com | — | — | — | — | — | — |
| en.wikipedia.org | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| bbc.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| theguardian.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| reuters.com | — | — | — | — | — | — |
| forbes.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| medium.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| substack.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| theatlantic.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| booking.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| expedia.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| airbnb.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| tripadvisor.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| yelp.com | — | — | — | — | — | — |
| zillow.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| opentable.com | — | — | — | — | — | — |
| github.com | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| stackoverflow.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| developer.mozilla.org | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| npmjs.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| pypi.org | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| readthedocs.org | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| akamai.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| imperva.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| datadome.co | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| humansecurity.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| fastly.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| usa.gov | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| irs.gov | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| nih.gov | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| w3.org | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| ietf.org | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| youtube.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| tomsguide.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| facebook.com | — | — | — | — | — | — |
| apps.apple.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| asics.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| rtings.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| linkedin.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| consumerreports.org | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| runnersworld.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| nerdwallet.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| play.google.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| g2.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| sleepfoundation.org | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| runningwarehouse.com | — | — | — | — | — | — |
| runrepeat.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| brooksrunning.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| bankrate.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| doctorsofrunning.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| mcpmarket.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| businessinsider.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| naplab.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| cnet.com | ✗ | ✗ | — | — | — | ✗ |
| rei.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| techradar.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| nike.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| mattressnerd.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| trustpilot.com | — | — | — | — | — | — |
| pcmag.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| bible.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| wired.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| saatva.com | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| usnews.com | — | — | — | — | — | — |
| code.claude.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| goodhousekeeping.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| casper.com | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| sleepadvisor.org | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| mattressclarity.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| finance.yahoo.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| fool.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| t3.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| jdpower.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| platform.claude.com | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| whistleout.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| logos.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| fleetfeet.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| help.youversion.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| arxiv.org | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| podcasts.apple.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| runningshoesguru.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| believeintherun.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| zapier.com | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| sleepopolis.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| aad.org | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| clickup.com | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| solereview.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| reviewed.com | ✗ | ✗ | — | — | — | ✗ |
| babygearlab.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| babylist.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| hubspot.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| cnbc.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| thepointsguy.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| capterra.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| blog.hubspot.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| warmpeach.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| support.anthropic.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| behindthename.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| newbalance.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| healthline.com | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ |
| runtothefinish.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| irunfar.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| experian.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| marketwatch.com | — | — | — | — | — | — |
| thezebra.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| wallethub.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| purple.com | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| capitalone.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| nameberry.com | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **adoption** | 41 (27.9%) | 12 (8.2%) | 3 (2.0%) | 5 (3.4%) | 4 (2.7%) | 0 (0.0%) |

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
| huggingface.co | yes | parsed | no | no | no | no | yes |
| vercel.com | yes | parsed | no | no | no | `search=yes, ai-input=yes, ai-train=no` | yes |
| docs.stripe.com | yes | parsed | no | no | no | `ai-train=yes, search=yes, ai-input=yes` | yes |
| shopify.com | yes | parsed | no | no | no | no | no |
| cursor.com | yes | parsed | no | no | no | no | yes |
| langchain.com | yes | parsed | no | no | no | no | yes |
| x.ai | yes | parsed | 5 (0 disallowed) | no | no | `ai-train=no, search=yes, ai-input=no` | yes |
| cohere.com | yes | parsed | no | no | no | no | yes |
| deepseek.com | yes | parsed | no | no | no | no | yes |
| replicate.com | yes | parsed | no | no | no | `search=yes, ai-train=no, ai-input=yes` | yes |
| docs.anthropic.com | yes | parsed | no | no | no | no | yes |
| developers.cloudflare.com | yes | parsed | no | no | no | `ai-train=yes, search=yes, ai-input=yes` | yes |
| mintlify.com | yes | parsed | no | no | no | no | yes |
| ebay.com | yes | parsed | 10 (9 disallowed) | no | no | no | yes |
| walmart.com | yes | parsed | no | no | no | no | yes |
| target.com | yes | parsed | no | no | no | no | yes |
| etsy.com | yes | parsed | no | no | no | no | no |
| bestbuy.com | yes | parsed | 10 (0 disallowed) | no | no | no | yes |
| instacart.com | yes | parsed | 3 (2 disallowed) | yes | yes | no | no |
| wayfair.com | yes | parsed | no | no | no | no | yes |
| nytimes.com | yes | parsed | 15 (14 disallowed) | no | no | no | yes |
| reddit.com | yes | parsed | no | yes | yes | no | no |
| en.wikipedia.org | yes | parsed | no | no | no | no | yes |
| bbc.com | yes | parsed | 14 (14 disallowed) | no | no | no | yes |
| theguardian.com | yes | parsed | 8 (8 disallowed) | no | no | no | yes |
| reuters.com | yes | parsed | 2 (1 disallowed) | yes | yes | no | yes |
| forbes.com | yes | parsed | 12 (11 disallowed) | no | no | no | yes |
| medium.com | yes | parsed | 6 (6 disallowed) | no | no | no | yes |
| substack.com | yes | parsed | no | no | no | no | yes |
| theatlantic.com | yes | parsed | 15 (13 disallowed) | no | no | `search=yes, ai-input=no, ai-train=no` | yes |
| booking.com | yes | parsed | no | no | no | no | no |
| expedia.com | yes | parsed | 2 (0 disallowed) | no | no | no | no |
| airbnb.com | yes | parsed | 7 (0 disallowed) | no | no | no | yes |
| tripadvisor.com | yes | parsed | 11 (9 disallowed) | no | no | no | yes |
| yelp.com | yes | parsed | 10 (10 disallowed) | yes | yes | no | no |
| zillow.com | yes | parsed | 3 (3 disallowed) | no | no | no | yes |
| opentable.com | no | disallow_all | no | yes | yes | no | no |
| github.com | yes | parsed | no | no | no | no | no |
| stackoverflow.com | no | allow_all | no | no | no | no | no |
| developer.mozilla.org | yes | parsed | no | no | no | no | yes |
| npmjs.com | no | allow_all | no | no | no | no | no |
| pypi.org | yes | parsed | no | no | no | no | yes |
| readthedocs.org | yes | parsed | no | no | no | no | no |
| akamai.com | yes | parsed | 10 (0 disallowed) | no | no | no | yes |
| imperva.com | yes | parsed | no | no | no | no | yes |
| datadome.co | no | allow_all | no | no | no | no | no |
| humansecurity.com | yes | parsed | no | no | no | no | no |
| fastly.com | yes | parsed | no | no | no | no | yes |
| usa.gov | yes | parsed | no | no | no | no | yes |
| irs.gov | yes | parsed | no | no | no | no | yes |
| nih.gov | yes | parsed | no | no | no | no | no |
| w3.org | yes | parsed | no | no | no | no | no |
| ietf.org | yes | parsed | no | no | no | no | no |
| youtube.com | yes | parsed | no | no | no | no | yes |
| tomsguide.com | yes | parsed | 4 (4 disallowed) | no | no | no | yes |
| facebook.com | yes | parsed | 6 (0 disallowed) | yes | yes | no | no |
| apps.apple.com | yes | parsed | no | no | no | no | yes |
| asics.com | yes | parsed | no | no | no | no | yes |
| rtings.com | yes | parsed | no | no | no | no | yes |
| linkedin.com | yes | parsed | no | no | no | no | no |
| consumerreports.org | yes | parsed | 3 (3 disallowed) | no | no | no | no |
| runnersworld.com | yes | parsed | 2 (0 disallowed) | no | no | no | yes |
| nerdwallet.com | yes | parsed | 1 (1 disallowed) | no | no | no | yes |
| play.google.com | yes | parsed | no | no | no | no | yes |
| g2.com | yes | parsed | 9 (1 disallowed) | no | no | no | yes |
| sleepfoundation.org | yes | parsed | no | no | no | no | yes |
| runningwarehouse.com | no | disallow_all | no | yes | yes | no | no |
| runrepeat.com | yes | parsed | no | no | no | no | yes |
| brooksrunning.com | no | allow_all | no | no | no | no | no |
| bankrate.com | yes | parsed | no | no | no | no | yes |
| doctorsofrunning.com | yes | parsed | 8 (8 disallowed) | no | no | `search=yes,ai-train=no,use=reference` | no |
| mcpmarket.com | no | allow_all | no | no | no | no | no |
| businessinsider.com | yes | parsed | 5 (5 disallowed) | no | no | no | yes |
| naplab.com | yes | parsed | no | no | no | no | yes |
| cnet.com | yes | parsed | 14 (14 disallowed) | no | no | no | yes |
| rei.com | no | allow_all | no | no | no | no | no |
| techradar.com | yes | parsed | 4 (4 disallowed) | no | no | no | yes |
| nike.com | yes | parsed | no | no | no | no | yes |
| mattressnerd.com | yes | parsed | no | no | no | no | yes |
| trustpilot.com | yes | parsed | 13 (8 disallowed) | yes | yes | no | yes |
| pcmag.com | yes | parsed | 14 (14 disallowed) | no | no | no | yes |
| bible.com | yes | parsed | no | no | no | no | no |
| wired.com | yes | parsed | 11 (11 disallowed) | no | no | no | yes |
| saatva.com | yes | parsed | no | no | no | no | yes |
| usnews.com | yes | parsed | 15 (15 disallowed) | no | no | no | yes |
| code.claude.com | yes | parsed | no | no | no | `ai-train=yes, search=yes, ai-input=yes` | yes |
| goodhousekeeping.com | yes | parsed | 2 (0 disallowed) | no | no | no | yes |
| casper.com | yes | parsed | no | no | no | no | yes |
| sleepadvisor.org | yes | parsed | no | no | no | no | yes |
| mattressclarity.com | yes | parsed | no | no | no | no | yes |
| finance.yahoo.com | yes | parsed | 11 (11 disallowed) | no | no | no | yes |
| fool.com | yes | parsed | 1 (1 disallowed) | no | no | no | yes |
| t3.com | yes | parsed | 4 (4 disallowed) | no | no | no | yes |
| jdpower.com | yes | parsed | no | no | no | no | yes |
| platform.claude.com | yes | parsed | no | no | no | no | yes |
| whistleout.com | yes | parsed | no | no | no | no | yes |
| logos.com | yes | parsed | no | no | no | no | no |
| fleetfeet.com | yes | parsed | no | no | no | no | no |
| help.youversion.com | yes | parsed | no | no | no | no | yes |
| arxiv.org | yes | parsed | no | no | no | no | no |
| podcasts.apple.com | yes | parsed | no | no | no | no | yes |
| runningshoesguru.com | yes | parsed | no | no | no | no | no |
| believeintherun.com | yes | parsed | no | no | no | no | yes |
| zapier.com | yes | parsed | 5 (0 disallowed) | no | no | `ai-train=yes, search=yes, ai-input=yes` | yes |
| sleepopolis.com | yes | parsed | no | no | no | no | yes |
| aad.org | yes | parsed | no | no | no | no | yes |
| clickup.com | yes | parsed | no | no | no | no | yes |
| solereview.com | yes | parsed | no | no | no | no | yes |
| reviewed.com | yes | parsed | 1 (1 disallowed) | no | no | no | yes |
| babygearlab.com | yes | parsed | 1 (0 disallowed) | no | no | no | yes |
| babylist.com | yes | parsed | no | no | no | no | yes |
| hubspot.com | yes | parsed | no | no | no | no | no |
| cnbc.com | no | allow_all | no | no | no | no | no |
| thepointsguy.com | yes | parsed | no | no | no | no | yes |
| capterra.com | yes | parsed | 5 (0 disallowed) | no | no | no | yes |
| blog.hubspot.com | yes | parsed | no | no | no | no | yes |
| warmpeach.com | yes | parsed | 9 (0 disallowed) | no | no | no | yes |
| support.anthropic.com | yes | parsed | no | no | no | no | yes |
| behindthename.com | yes | parsed | 8 (8 disallowed) | no | no | `search=yes,ai-train=no,use=reference` | no |
| newbalance.com | no | allow_all | no | no | no | no | no |
| healthline.com | yes | parsed | 9 (9 disallowed) | no | no | no | yes |
| runtothefinish.com | yes | parsed | no | no | no | no | yes |
| irunfar.com | yes | parsed | no | no | no | no | yes |
| experian.com | yes | parsed | no | no | no | no | yes |
| marketwatch.com | yes | parsed | 2 (0 disallowed) | yes | yes | no | yes |
| thezebra.com | yes | parsed | no | no | no | no | yes |
| wallethub.com | yes | parsed | 8 (8 disallowed) | no | no | `ai-train=no, search=yes, ai-input=no` | no |
| purple.com | yes | parsed | no | no | no | no | yes |
| capitalone.com | yes | parsed | no | no | no | no | yes |
| nameberry.com | yes | parsed | no | no | no | no | yes |
| **totals** | 145 | | 47 | 9 | 9 | 13 | 117 |

## Method

User-Agent `ClaudeAtlasBot/1.0 (+https://claudeatlas.com/bot)`. Per target: `GET /robots.txt` first, then — only if robots.txt allows us — `GET /` three times (agent UA with an HTML Accept, agent UA with `Accept: text/markdown, text/html;q=0.9`, and a standard browser UA for the single cloaking comparison), then each of 6 fixed well-known paths (`/llms.txt`, `/llms-full.txt`, `/.well-known/agents.json`, `/.well-known/mcp/server-card.json`, `/.well-known/http-message-signatures-directory`, `/ai.txt`), each individually gated by robots.txt. Policy: GET only; ≥3000 ms between consecutive requests to one host (redirect hops included); at most 6 hosts in flight; 15000 ms timeout per hop; ≤5 redirects; ≤512 KB read per response; 1 retry on network error only, never on any HTTP status. A robots.txt 4xx is treated as allow-all, a 5xx/timeout as disallow-all. Only statuses, selected headers, byte counts, robots directives, JSON-LD counts and content-types are recorded — no page text. The per-target result is the agent-UA homepage classification; rates are over targets that answered (excluding network errors and robots-disallowed). The block rate counts both hard blocks (401/403/429/451) and interstitial challenge pages; a 402 anywhere on the target is recorded as a toll.

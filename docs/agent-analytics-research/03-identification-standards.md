# Research report 3: How AI Agents and Crawlers Identify Themselves — State of Play, August 2026

(Verbatim output of research agent 3, 2026-08-04. For an agent-traffic analytics product that must **name the actor** behind each request. Where secondary sources conflict with primary IETF/vendor records, it is flagged.)

---

## 1. IETF Web Bot Auth: the cryptographic identity track

**The spec.** Web Bot Auth builds on RFC 9421 (HTTP Message Signatures). An agent holds an Ed25519 keypair, publishes the public key as a JWKS at `/.well-known/http-message-signatures-directory` on its own domain, and attaches three headers to every request: `Signature-Agent` (the signer's domain, e.g. `Signature-Agent: "https://chatgpt.com"`), `Signature-Input`, and `Signature`. Verifiers fetch the JWKS and check the Ed25519 signature ([Arcjet technical walkthrough with real captured ChatGPT headers, Aug 26 2025](https://blog.arcjet.com/user-agent-strings-to-http-signatures-methods-for-ai-agent-identification/)).

**IETF status (primary source, datatracker).** A **webbotauth working group was chartered in early 2026**. The original architecture draft, [draft-meunier-web-bot-auth-architecture](https://datatracker.ietf.org/doc/html/draft-meunier-web-bot-auth-architecture) (rev -05, March 2 2026; authors Thibault Meunier of Cloudflare and Sandor Major of Google), has been **split and superseded** by [draft-meunier-webbotauth-httpsig-protocol-00 and draft-meunier-webbotauth-httpsig-directory-00](https://datatracker.ietf.org/group/webbotauth/documents/) (both June 2026), plus [draft-meunier-webbotauth-registry-03](https://datatracker.ietf.org/doc/draft-meunier-webbotauth-registry/) (June 26 2026), which defines a "Signature Agent Card" — JSON metadata describing an agent's identity, operator, and purpose. Related drafts in the WG orbit: Google's Gary Illyes on crawler best practices and **JAFAR** (a standardized JSON format for publishing bot IP ranges, draft-illyes-webbotauth-jafar-00), Mark Nottingham's use-cases draft, Ekr's **anonymous bot authentication** draft (rate-limiting without identity), and a hosted-key-directories draft. **All 12 documents are still "I-D Exists" status — nothing is an RFC.** The WG's April 2026 standards-track milestone slipped ([nohacks.co landscape reference, updated July 31 2026](https://nohacks.co/blog/ai-user-agents-landscape-2026)). One secondary source claims a "W3C Web Bot Auth spec finalized May 2026" ([pravinkumar.co](https://www.pravinkumar.co/blog/cloudflare-june-2026-bot-management-webflow-protection-2026)) — this contradicts the IETF datatracker and is almost certainly wrong venue attribution; treat with skepticism.

**Adoption reality (the important part):**
- **OpenAI signs today.** ChatGPT agent traffic carries `Signature-Agent: "https://chatgpt.com"` with keys at chatgpt.com's `.well-known` directory — captured in the wild as early as Aug 2025 ([Arcjet](https://blog.arcjet.com/user-agent-strings-to-http-signatures-methods-for-ai-agent-identification/)). OpenAI was a launch partner of Cloudflare's signed-agents program ([Cloudflare blog, Aug 28 2025](https://blog.cloudflare.com/signed-agents/)) and is named as a backer alongside Cloudflare, Amazon, and Akamai ([Coronium, May 2026](https://www.coronium.io/blog/web-bot-auth-verifiable-ai-agents-2026)). But OpenAI has published **no vendor documentation of its own** about signing ([nohacks.co](https://nohacks.co/blog/ai-user-agents-landscape-2026)).
- **Google**: experimenting with a `https://agent.bot.goog` signing identity for **Google-Agent only** (its user-triggered agentic fetcher). Googlebot proper does **not** sign as of mid-2026 ([nohacks.co](https://nohacks.co/blog/ai-user-agents-landscape-2026)).
- **Amazon**: Bedrock AgentCore Browser can auto-sign outbound requests (preview, Oct 2025); AWS + Cloudflare announced a joint key registry Feb 2026 ([nohacks.co](https://nohacks.co/blog/ai-user-agents-landscape-2026)).
- **Anthropic, Perplexity, Mistral: no first-party Web Bot Auth documentation** as of mid-2026 ([nohacks.co](https://nohacks.co/blog/ai-user-agents-landscape-2026)) — though their agentic *browsers* participate in Cloudflare's verified-agent scheme (below), which implies signing in practice without public docs.
- **Cloudflare-side**: fully implemented as a verification method; Rust/TS reference implementations; Akamai verifies signatures at edge.

**Adjacent proposal:** Cloudflare announced **PACT** (Private Access Tokens-style anonymous attestation of human-in-loop or authorized agent) on June 22 2026 with Chrome, Firefox, Edge, and Shopify named — **no implementation or origin trial yet** ([nohacks.co](https://nohacks.co/blog/ai-user-agents-landscape-2026)).

---

## 2. Cloudflare Verified Bots / Signed Agents — and CDN equivalents

Cloudflare's [Verified Bots program](https://developers.cloudflare.com/bots/concepts/bot/verified-bots/) accepts **three verification methods**: (1) Web Bot Auth signatures, (2) published IP list + consistent UA, (3) reverse DNS. Requirements: honest self-identification + non-abusive behavior (robots.txt respect, sane rates). Bots are classified by behavior (Search, **Agent**, Training, Transact, etc.) and operator type (Direct vs Intermediary). Verified identity is exposed to customers as `cf.verified_bot` / `cf.verified_bot_category` fields in WAF rules; the registry is public via Cloudflare Radar.

**Signed Agents** ([announced Aug 28 2025](https://blog.cloudflare.com/signed-agents/)) extended this to *end-user-directed* agents. Launch cohort: **ChatGPT agent, Goose (Block), Browserbase, Anchor Browser**. In **June 2026** Cloudflare shipped a Bot Management update adding a **"Verified AI Agent" category** — reportedly **19 agents at launch, including ChatGPT Atlas, Claude in Chrome, Perplexity Browser (Comet), Gemini Agent Mode, Brave Leo, and Arc's Browse for Me**, covering an estimated **84% of identified AI-browser traffic**; plus a new **"Challenge Agent"** rule action that asks an agent for a signed token instead of a CAPTCHA. Verified-AI-agent traffic reportedly jumped from 2.8% to 9.4% of bot traffic within 72 hours of launch ([pravinkumar.co, June 2026](https://www.pravinkumar.co/blog/cloudflare-june-2026-bot-management-webflow-protection-2026) — secondary source; the 19-name list and stats appear in multiple secondary writeups but could not be verified against a Cloudflare primary post).

**Other CDNs:** Akamai Bot Manager verifies Web Bot Auth signatures and does intent/identity tagging; AWS is in the standards coalition and added HTTP 402-based AI traffic monetization to its firewall (June 15 2026); Fastly backs RSL (see §5). Community registries: **Known Agents** (formerly Dark Visitors) at knownagents.com ([nohacks.co](https://nohacks.co/blog/ai-user-agents-landscape-2026)). Note the pipeline is congested: Cloudflare community threads report verified-bot submissions via Web Bot Auth stalled since June 16 2026 ([Cloudflare community](https://community.cloudflare.com/t/verified-bot-submission-web-bot-auth-stalled-since-2026-06-16/945395)).

---

## 3. Published UA strings + IP ranges, per vendor

### OpenAI — best-documented vendor ([developers.openai.com/api/docs/bots](https://developers.openai.com/api/docs/bots), verified Aug 4 2026)

| Bot | UA (current) | Purpose | IP JSON |
|---|---|---|---|
| GPTBot | `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot` | training crawl | `openai.com/gptbot.json` |
| OAI-SearchBot | `...Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot` | ChatGPT search index | `openai.com/searchbot.json` |
| ChatGPT-User | `...compatible; ChatGPT-User/1.0; +https://openai.com/bot` | user-triggered fetches in ChatGPT/GPTs | `openai.com/chatgpt-user.json` |
| OAI-AdsBot | `...compatible; OAI-AdsBot/1.0; +https://openai.com/adsbot` | ChatGPT ads page validation (new in 2026) | `openai.com/adsbot.json` |

Operator/agent-mode: server-side browsing signs via Web Bot Auth (`Signature-Agent: "https://chatgpt.com"`) but the bots docs page itself says nothing about Operator/Atlas. **Atlas** (the desktop browser, launched Oct 2025) sent a mix: `ChatGPT Atlas/... CFNetwork/... Darwin/...` for some asset fetches, but **page content via a Chrome-identical UA** ([aisearchoptimization.in](https://www.aisearchoptimization.in/blog/chatgpt-atlas-user-agent-why-youre-suddenly-seeing-it-in-your-server-logs/)). OpenAI announced Atlas's retirement — **shut down Aug 9 2026**, agentic browsing folded into ChatGPT/"ChatGPT Work" ([ppc.land](https://ppc.land/openai-kills-atlas-browser-folds-it-into-new-chatgpt-work-agent/), July 2026).

### Anthropic

Three bots, all honoring robots.txt: **ClaudeBot** (training; `Mozilla/5.0 (compatible; ClaudeBot/1.0; claudebot@anthropic.com)`), **Claude-User** (user-triggered fetches from Claude products), **Claude-SearchBot** (search indexing) ([Anthropic help center](https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)). **Big recent change: in late July 2026 Anthropic published a verification IP list** (reported at `claude.com/crawling/bots.json`), reversing its long-standing "we do not publish IP ranges, we use service-provider public IPs" stance ([crawlerpolicy.com change log, ~July 28 2026](https://crawlerpolicy.com/events/anthropic-publishes-ip-range-list-for-crawler-verification-replacing-we-do-not-p); [unsourced.app](https://unsourced.app/ai-bots/claudebot)). Anthropic still recommends robots.txt over IP blocking. **Claude in Chrome** (extension, launched Aug 26 2025 to Max users — [TechCrunch](https://techcrunch.com/2025/08/26/anthropic-launches-a-claude-ai-agent-that-lives-in-chrome/)) drives the *user's own Chrome* — human UA, user's IP; its named appearance in Cloudflare's Verified AI Agent category (June 2026) implies signature-based identification, but Anthropic has published no Web Bot Auth docs. Claude computer-use via API has no fixed UA at all — the developer supplies the browser/VM.

### Perplexity — the cautionary tale

Documented bots: **PerplexityBot** (`...compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot`) and **Perplexity-User** (user-triggered; Perplexity's docs note it may ignore robots.txt because it acts on direct user request). IP JSONs: `perplexity.com/perplexitybot.json`, `perplexity.com/perplexity-user.json` ([nohacks.co](https://nohacks.co/blog/ai-user-agents-landscape-2026)). **August 2025: Cloudflare accused Perplexity of stealth crawling** — swapping to a generic Chrome/macOS UA, rotating undisclosed IPs and ASNs when blocked — and **delisted it from Verified Bots** ([Cloudflare via SEJ, Aug 4-5 2025](https://www.searchenginejournal.com/cloudflare-delists-and-blocks-perplexity-from-crawling-websites/552899/); [TechCrunch](https://techcrunch.com/2025/08/05/some-people-are-defending-perplexity-after-cloudflare-named-and-shamed-it)). Perplexity blamed misattributed BrowserBase traffic and published "Agents or Bots?" arguing user-directed agents shouldn't be treated as crawlers ([Perplexity blog, Aug 2025](https://www.perplexity.ai/hub/blog/agents-or-bots-making-sense-of-ai-on-the-open-web)). **Aftermath:** by mid-2026 Perplexity was partially rehabilitated — "Perplexity Browser" appears in Cloudflare's June 2026 Verified AI Agent cohort, though some zones reportedly still inherit reputation blocks ([stellagent.ai](https://stellagent.ai/insights/web-bot-auth-cloudflare-ietf)). Perplexity **Comet** (the consumer browser) sends a standard Chrome UA for browsing.

### Google

- **Google-Extended**: robots.txt *control token only* (since Sept 28 2023) — never appears in logs; governs Gemini training use of Googlebot-fetched content.
- **Google-Agent** (new, ~early 2026): UA for agents hosted on Google infra (Project Mariner heritage → **Gemini Agent Mode**); sends standard Chrome UA strings but from a dedicated published range: [`developers.google.com/static/crawling/ipranges/user-triggered-agents.json`](https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers); classed as a user-triggered fetcher, **ignores robots.txt** by design ([Google docs](https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers); [SEJ](https://www.searchenginejournal.com/why-new-google-agent-may-be-a-pivot-related-to-openclaw-trend/570764/)). Also experimenting with Web Bot Auth signing under `agent.bot.goog`.
- Googlebot family: reverse DNS (`*.googlebot.com`) + `googlebot.json` ranges; Google-CloudVertexBot for Vertex AI enterprise fetching.

### Others

- **Meta**: `meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)` — AI training/inference crawler; robots.txt-respecting.
- **Apple**: Applebot (`*.applebot.apple.com` rDNS verification); **Applebot-Extended** is a robots.txt-only training opt-out token (never in logs) ([nohacks.co](https://nohacks.co/blog/ai-user-agents-landscape-2026)).
- **Amazon**: `Mozilla/5.0 (compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)...` — Alexa + generative surfaces; rDNS verification. Bedrock AgentCore Browser previews Web Bot Auth signing.
- **ByteDance**: **Bytespider** — `Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)`; **no official docs, no published IPs, widely observed ignoring robots.txt** ([nohacks.co](https://nohacks.co/blog/ai-user-agents-landscape-2026)).
- **Undocumented tier**: xAI/Grok (spoofed browser UAs, residential IP rotation, zero docs), Cohere (no docs), plus multi-tenant scraper services (Firecrawl etc.).
- **Verification method by vendor**: IP JSON files — OpenAI, Perplexity, Google, Bing (`bing.com/toolbox/bingbot.json`), Common Crawl (`index.commoncrawl.org/ccbot.json`), DuckDuckGo, now Anthropic. Reverse DNS — Google, Apple, Amazon, Microsoft. Signatures — OpenAI (live), Google-Agent (experimental), Amazon (preview), browser-agents via Cloudflare program.

---

## 4. Agentic browsers: mostly invisible in server logs

The core finding: **agentic browsers are built on Chromium and present Chrome-identical UAs from residential/user IPs.** HTTP-level, they are *not* distinguishable from a human ([HUMAN Security, on Atlas vs Comet](https://www.humansecurity.com/learn/blog/chatgpt-atlas-vs-perplexity-comet-agentic-browsers/)).

- **ChatGPT Atlas**: Chrome UA for page loads; a distinctive `ChatGPT Atlas/... CFNetwork/... Darwin/...` UA leaked only on favicon/asset fetches. Retired Aug 9 2026, capabilities absorbed into ChatGPT ([ppc.land](https://ppc.land/openai-kills-atlas-browser-folds-it-into-new-chatgpt-work-agent/)).
- **Perplexity Comet**: Chrome UA; detectable only via fingerprint side-channels (missing extension manifests, missing TTS voice lists, automation event patterns) ([HUMAN Security](https://www.humansecurity.com/ai-agent/perplexity-comet/); [seresa.io](https://seresa.io/blog/ai-bot-filtering/chatgpt-atlas-and-perplexity-comet-are-already-in-your-analytics)).
- **Claude in Chrome**: literally the user's Chrome — human UA, human IP.
- **Dia / Arc (The Browser Company → acquired by Atlassian for $610M, closed Oct 21 2025)**: Chromium UA; no announced agent-identification scheme; Dia is macOS-only mid-2026 with enterprise pivot ([Constellation](https://www.constellationr.com/insights/news/atlassian-buys-browser-co-610-million)).
- **Microsoft Copilot Actions**: standard Edge/Chromium UA, no bot signal at all ([nohacks.co](https://nohacks.co/blog/ai-user-agents-landscape-2026)).
- **The identification plan** for all of these is Web Bot Auth signatures via Cloudflare's Verified AI Agent program (June 2026) — i.e., identity arrives as a *signature header*, not a UA. Off-Cloudflare, these browsers remain anonymous. Behavioral detection research (arXiv, 2026) shows Playwright-driven agents are separable from humans on raw-event features like teleporting cursors ([arxiv.org/html/2607.26935v1](https://arxiv.org/html/2607.26935v1)), but that's client-side instrumentation, not log parsing.

---

## 5. Site-side affordances: what's real vs. dead

| Mechanism | Status mid-2026 | Verdict |
|---|---|---|
| **llms.txt** (Jeremy Howard, Sept 2024) | Publisher adoption: 5.61% of top-10k (HTTP Archive, June 2026, up 5.4× YoY — but Shopify's platform-wide default accounts for most; WordPress organic ~8.7%) ([caseyrb.com](https://caseyrb.com/blog/state-of-llms-txt-adoption/)); 8.7% of top-1000 ([Rankability, June 2026](https://www.rankability.com/data/llms-txt-adoption/)). **Consumption: ~zero.** Across 515M logged LLM-bot events, /llms.txt fetches were statistically negligible ([aeo.press](https://ai.aeo.press/the-state-of-llms-txt-in-2026)); no measurable citation effect across 300k domains; Google formally listed it as a tactic to ignore (May 15 2026). | Supply-side theater; publishers write it, no major agent reads it. |
| **IETF AIPREF WG** (`Content-Usage` header + robots.txt rule; vocab: `train-ai`, `search` with y/n) | Chartered WG, standards-track; vocab draft at rev -06, attachment draft adopted, **Aug 2026 milestone to send to IESG** ([IETF blog](https://www.ietf.org/blog/aipref-wg/); [draft-ietf-aipref-vocab](https://datatracker.ietf.org/doc/html/draft-ietf-aipref-vocab/)) | The most likely *preference* standard — but expresses usage preferences, not identity. No crawler enforcement yet. |
| **Cloudflare Content Signals Policy** (Sept 24 2025; `Content-Signal: search=yes, ai-train=no` in robots.txt) | Auto-deployed to 3.8M+ domains via managed robots.txt; new-domain defaults tighten Sept 15 2026. **But no known crawler/LLM honors it** — Google's John Mueller: no effect ([seroundtable](https://www.seroundtable.com/google-cloudflare-content-signals-41631.html)) | Massive deployment, zero demand-side adoption; likely to be folded into whatever AIPREF ships. |
| **RSL (Really Simple Licensing)** (launched Sept 10 2025; RSL Collective) | Backers: Reddit, Yahoo, People Inc., Ziff Davis, Quora, Medium, O'Reilly, Internet Brands, Fastly, Raptive; RSL 1.0 declared an "official industry standard" Dec 2025, adds pay-per-crawl-style licensing terms ([rslstandard.org](https://rslstandard.org/press); [E&P](https://www.editorandpublisher.com/stories/rsl-ai-licensing-10-now-an-official-industry-standard,259144)) | Real publisher momentum on the *licensing* side; no confirmed AI-vendor payer yet. Pairs with Cloudflare pay-per-crawl (private beta July 2025) and AWS's HTTP 402 monetization (June 2026). |
| **agents.json / ai.txt** | agents.json: v0.1.0 community proposal (`/.well-known/agents.json`, OpenAPI-based action manifests) — not adopted by any standards body ([agentsjson.org](https://www.agentsjson.org/)); ai.txt exists only as individual I-D draft-car-ai-txt-wellknown-00 | Dead-on-arrival tier for identification purposes. |

Note: **none of these name the actor** — they're all site→agent signals. The identification problem lives entirely in §1–4.

---

## 6. MCP / framework layer: near-total anonymity by default

- **No registry or identity convention exists at the framework level.** The closest thing is the Web Bot Auth registry draft's "Signature Agent Card" (§1), which is designed for named operators, not per-developer agents.
- **Playwright/Puppeteer stacks** (browser-use, Stagehand, Skyvern, most LangChain browser tools): default UA is whatever Chromium reports — `HeadlessChrome/xxx` if headless (a real log signal), a normal Chrome UA if headful; trivially overridden. Detection has moved to TLS fingerprinting (JA3/JA4), CDP artifacts, and behavioral signals ([castle.io](https://blog.castle.io/how-to-detect-headless-chrome-bots-instrumented-with-playwright/); [cside](https://cside.com/blog/headless-browser-detection)).
- **Plain HTTP tools** in LangChain/Python agents inherit library defaults (`python-requests/2.x`, `python-httpx/...`, `node`) — generic, not agent-identifying.
- **MCP clients** do identify to *MCP servers*: e.g. Claude Code sends `user-agent: claude-code/2.1.89 (cli)`, but this is inconsistent — Codex CLI shipped with **no** UA on MCP Streamable HTTP requests ([openai/codex#16485](https://github.com/openai/codex/issues/16485)), VS Code and Roo-Code have open issues requesting proper UAs, and MCP's `clientInfo` handshake field is lost in stateless HTTP mode. Server-side, MCP tool fetches to the open web carry no standard identity.
- **Vendor-hosted tool fetches** are the exception: Claude API web fetch/search surfaces as `Claude-User`; ChatGPT tool browsing as `ChatGPT-User`; Google Vertex agents as `Google-CloudVertexBot`. The moment a developer swaps in their own fetching infra, identity vanishes.

---

## (a) What a request from each actor looks like in server logs today (Aug 2026)

| Actor | UA in logs | IP provenance | Extra headers | Nameable from logs alone? |
|---|---|---|---|---|
| OpenAI training crawl | `...compatible; GPTBot/1.4; +https://openai.com/gptbot` | `gptbot.json` ranges | — | Yes (UA + IP check) |
| ChatGPT search index | `...OAI-SearchBot/1.4...` | `searchbot.json` | — | Yes |
| ChatGPT user fetch / tool call | `...ChatGPT-User/1.0...` | `chatgpt-user.json` | often `Signature-Agent: "https://chatgpt.com"` + `Signature`/`Signature-Input` | Yes; cryptographically |
| ChatGPT agent / (ex-)Atlas browsing | Chrome-identical UA (Atlas leaked `ChatGPT Atlas/... Darwin/...` on asset fetches only; Atlas dead Aug 9 2026) | OpenAI infra or user device | Web Bot Auth signature on signed-agent flows | Only via signature or fingerprinting |
| Anthropic training crawl | `Mozilla/5.0 (compatible; ClaudeBot/1.0; claudebot@anthropic.com)` | published as of late July 2026 (`claude.com/crawling/bots.json`) + rDNS `*.anthropic.com` | — | Yes (newly IP-verifiable) |
| Claude user fetch | `...compatible; Claude-User/1.0...` | Anthropic ranges | — | Yes |
| Claude in Chrome / computer use | user's own Chrome UA, user's IP | user device | signature only within Cloudflare's Verified AI Agent program | No (outside CF) |
| Perplexity index | `...PerplexityBot/1.0...` | `perplexity.com/perplexitybot.json` | — | Yes — but history of UA/IP evasion (Aug 2025) |
| Perplexity user fetch | `...Perplexity-User/1.0...` (may ignore robots.txt) | `perplexity-user.json` | — | Yes, when honest |
| Comet browsing | Chrome UA | user IP | signed under CF Verified AI Agent (June 2026) | No (outside CF) |
| Google training control | *(Google-Extended never appears in logs — robots.txt token only)* | — | — | n/a |
| Gemini Agent Mode / Google-Agent | standard Chrome UA | `user-triggered-agents.json` ranges | experimental signing (`agent.bot.goog`) | Yes via IP range only |
| Meta | `meta-externalagent/1.1 (+https://...)` | rDNS | — | Yes |
| Apple | `Applebot/...` (Applebot-Extended = robots token only) | rDNS `*.applebot.apple.com` | — | Yes |
| Amazon | `Mozilla/5.0 (compatible; Amazonbot/0.1; ...)` | rDNS | Bedrock AgentCore: WBA signatures (preview) | Yes |
| ByteDance | `...(compatible; Bytespider; ...)` — when it bothers | undisclosed | — | UA only; unverifiable |
| xAI/Grok | spoofed Safari/Chrome | residential rotation | — | No |
| browser-use/Playwright DIY agents | `HeadlessChrome/...` or normal Chrome UA | cloud/datacenter or proxy | none | No (infer from ASN + TLS fingerprint) |
| Copilot Actions | Edge UA | Microsoft/user | none | No |

## (b) Which signals will exist in 12–24 months

1. **Web Bot Auth signatures become the primary high-trust signal.** Trajectory: chartered IETF WG, Cloudflare + Akamai + AWS verifying, OpenAI signing in production, the big agentic browsers enrolled, an AWS/Cloudflare joint key registry (Feb 2026). Expect RFC publication and `Signature-Agent` parsing to become table stakes for analytics products. **Build signature verification + key-directory caching now** — the `Signature-Agent` domain is exactly the "name the actor" primitive needed.
2. **Signature Agent Cards / registries** (draft-meunier-webbotauth-registry) will give machine-readable operator metadata — name, operator, category, contact — a natural enrichment feed.
3. **IP-range JSON standardization (JAFAR)** will make the per-vendor JSON endpoints uniform; Anthropic's July 2026 capitulation on publishing ranges suggests every major vendor will have one.
4. **AIPREF `Content-Usage`** likely ships as an RFC (IESG milestone Aug 2026) — preference expression, useful for compliance-auditing features ("did GPTBot respect train-ai=n?"), not identification.
5. **UA strings remain, but only as a low-trust hint** for the long tail; the interesting traffic (agentic browsing) will never have honest UAs.
6. **The delegated-identity layer is coming but unsettled**: PACT, anonymous-webbotauth (rate-limit without identity), and OAuth-ish "agent acting for user X" schemes — expect 2027, not 2026.

## (c) Key open problems

1. **The agentic-browser attribution gap.** The fastest-growing traffic class (est. 84% of AI-browser traffic only *within* Cloudflare's verified program) is Chrome-identical from residential IPs. Outside a verifying CDN, no log-level signal names it. This is simultaneously the product's hardest problem and its reason to exist.
2. **Verification is centralizing into CDN gatekeepers.** Cloudflare is de-facto registrar, verifier, and judge (Perplexity delisting proved it). An independent analytics product must verify signatures itself rather than trust `cf.verified_bot`, or it inherits Cloudflare's registry politics — and the registry submission queue is already backlogged.
3. **The long tail is anonymous by design.** DIY Playwright/browser-use agents, MCP tool fetches, and misbehaving vendors (Bytespider, xAI) carry no verifiable identity and no incentive to acquire one; anonymous-attestation drafts explicitly aim to let them stay nameless while proving "not malicious."
4. **Identity ≠ delegation.** Even a signed `Signature-Agent: chatgpt.com` doesn't say *which user*, *what intent* (shopping vs scraping), or *which tier* (training vs inference vs action) — the crawler/agent taxonomy itself (Perplexity's "agents aren't bots" argument) is unresolved at the IETF, and analytics categories will keep shifting under it.
5. **Preference signals have no enforcement loop.** llms.txt is unread, Content Signals unhonored, RSL unpaid-so-far — meaning "compliance monitoring" (who ignored what) is an open product opportunity precisely because no standard closes the loop.

(Sources cited inline throughout.)

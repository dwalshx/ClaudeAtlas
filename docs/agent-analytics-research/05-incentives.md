# Research report 5: What Would Actually Make AI Agents Identify Themselves?

(Verbatim output of research agent 5, 2026-08-04. Context baseline: ClaudeAtlas's pure opt-in `POST /api/v1/agent-ping` advertised in llms.txt received exactly one ping ever — the site's own smoke test. This report explains why that outcome was the statistically expected one, and what mechanisms actually move adoption.)

---

## 1. Historical adoption lessons: why some webmaster standards lived and most died

The pattern across thirty years of web metadata standards is unambiguous. **A standard adopted by millions of small parties succeeds only when (a) a dominant platform consumes it and confers an immediate, visible benefit, and (b) tooling emits it by default so most "adopters" never made a decision at all.**

**The winners:**

- **robots.txt (1994)** solved the *site's own* problem (crawlers overwhelming servers), and the handful of crawlers that mattered voluntarily respected it. It only became an official standard (RFC 9309) in 2022 — 28 years after de facto adoption, driven by Google ([searchengineworld.com](https://www.searchengineworld.com/rfc9309-robots-txt-quietly-became-an-official-internet-standard)). Note the adoption asymmetry: millions of sites, but the *consuming* side was ~5 crawlers.
- **Sitemaps (2005–06)** succeeded because Google, then Yahoo and Microsoft jointly, consumed them and rewarded them with better indexing; the `Sitemap:` line is essentially the only robots.txt extension to reach near-universal parser support ([Wikipedia: Sitemaps](https://en.wikipedia.org/wiki/Sitemaps)).
- **Open Graph (2010)** — Facebook consumed it and instantly rewarded it with rich link previews on the dominant social platform ([ogp.me](https://ogp.me/)).
- **schema.org (2011)** — launched *by* Google, Bing and Yahoo; rich snippets in Google search results were the reward. The ACM history is explicit that adoption jumped when rich-result verticals launched, and that "a key driver of adoption was extensive support from third-party tools such as Drupal and WordPress extensions" — the same phenomenon seen with RSS, where "the number of RSS feeds increased dramatically as soon as tools such as Blogger started outputting RSS automatically" ([ACM Queue, "Schema.org: Evolution of Structured Data on the Web"](https://queue.acm.org/detail.cfm?id=2857276)).

**The losers (all lacked a consuming platform or a default emitter):**

- **security.txt** — an actual IETF RFC (9116, 2022), free to implement, obviously virtuous — and adoption is **under 0.25% of all domains**, ~1.25% of the top million by 2025, with only 44% of published files even RFC-conformant; much of the growth is platform automation, not decisions ([iotdef 240M-domain analysis, 2026](https://blog.iotdef.com/the-state-of-security-txt-adoption-an-analysis-of-240-million-domains-in-2026/); [uriports 2025](https://www.uriports.com/blog/security-txt-in-2025/)). This is the *best case* for a no-carrot standard: single-digit percent after four years.
- **Webmention** — a W3C Recommendation, still niche because no major CMS ships it by default and the network-effect chicken-and-egg never resolved ([indieweb.org/Webmention](https://indieweb.org/Webmention)).
- **agents.json (Wildcard)** — an OpenAPI-based "contract for agents" spec; no new version since February 2025, demos dead, and the company pivoted to GEO ([dawnliphardt.com overview](https://www.dawnliphardt.com/a2a-acp-and-agents-json-whats-next-for-these-agent-based-protocols/)).
- **llms.txt** — the most instructive corpse, covered in §2.

**What this predicts for agent identity:** the millions-of-sites side can never bootstrap it. The consuming side of agent identity is inverted from robots.txt: here the *sites* are the many and the *agents/frameworks* are the few. That is actually good news structurally — you only need ~10 actors (OpenAI, Anthropic, Google, Microsoft, Perplexity, LangChain, browser-use, and the CDNs) to change defaults, exactly the way only 3 search engines had to agree on sitemaps. **Identity must be baked in upstream by model vendors and framework authors, and rewarded by gatekeepers (Cloudflare/Akamai/AWS). An individual site asking politely has the same odds llms.txt had — and llms.txt's number came in.** ClaudeAtlas's single self-inflicted ping is not an anomaly; it's the base rate.

---

## 2. Existing carrot mechanisms — status mid-2026

### a) Cloudflare Signed Agents / Web Bot Auth: "identify → don't get blocked" — **the only carrot demonstrably working, but only for hosted agents**

Mechanism: agents sign HTTP requests with Ed25519 keys per RFC 9421 (HTTP Message Signatures), advertise a `Signature-Agent` header pointing at a `/.well-known/http-message-signatures-directory` JWKS; receiving infrastructure verifies cryptographically ([Cloudflare: "Forget IPs"](https://blog.cloudflare.com/web-bot-auth/); [cloudflare/web-bot-auth on GitHub](https://github.com/cloudflare/web-bot-auth)).

Status as of mid-2026:
- Launch partners for **Signed Agents** (Aug 2025): ChatGPT agent, Block's Goose, Browserbase, Anchor Browser ([Cloudflare signed-agents post](https://blog.cloudflare.com/signed-agents/)).
- Cloudflare folded Message Signatures into its **Verified Bots** program ([Cloudflare](https://blog.cloudflare.com/verified-bots-with-cryptography/)); production edge activation announced March 2026; open key-registry format co-announced with Amazon Bedrock AgentCore in Feb 2026; AWS WAF, Vercel, Shopify, Akamai have implemented support; **Visa TAP and Mastercard Agent Pay adopted Web Bot Auth as their authentication foundation** ([Stellagent overview, 2026](https://stellagent.ai/insights/web-bot-auth-cloudflare-ietf); [Coronium 2026](https://www.coronium.io/blog/web-bot-auth-verifiable-ai-agents-2026)).
- IETF: a Web Bot Auth working group was chartered in early 2026 with Cloudflare, Amazon, Akamai and OpenAI support — but **it missed its April 2026 standards-track milestone; the core drafts remain individual submissions** ([IETF datatracker](https://datatracker.ietf.org/doc/draft-meunier-webbotauth-registry/); [nohacks.co UA landscape, July 2026](https://nohacks.co/blog/ai-user-agents-landscape-2026)).
- Vendor gaps: Google is experimenting (`https://agent.bot.goog` identity for Google-Agent); **OpenAI signs; Anthropic, Perplexity and Mistral have no documented Web Bot Auth support** ([nohacks.co](https://nohacks.co/blog/ai-user-agents-landscape-2026)).

Why the carrot works where it works: Cloudflare fronts ~20% of the web, so "sign or get challenged" is a real threat/reward for cloud-hosted agents. Why it doesn't solve the residential-IP problem: it authenticates the *operator's fleet*, keyed from vendor infrastructure. An agent running on a user's laptop from a residential IP has no fleet key — and the fight over whether it *should* need one is the Cloudflare-vs-Perplexity war (§4).

### b) Pay-per-crawl / TollBit / RSL: "identify → get access you'd otherwise be denied" — **working, but only where money flows**

- Cloudflare made **AI-crawler blocking the default for new sites (July 1, 2025)** and moved Pay-Per-Crawl toward GA; publishers now send **over 1 billion HTTP 402 responses per day** across Cloudflare's network ([TechCrunch](https://techcrunch.com/2026/07/01/cloudflares-new-policy-pushes-ai-companies-to-pay-for-publishers-content/); [Forbes, July 2026](https://www.forbes.com/sites/sandycarter/2026/07/01/cloudflare-moves-to-make-ai-pay-for-the-content-it-consumes/)).
- **TollBit**: ~20% of its publishers have generated revenue, ranging from hundreds to tens of thousands of dollars/month; Arc XP integrated it in April 2026 for mid-size publishers ([Presenc comparison](https://presenc.ai/compare/tollbit-vs-cloudflare-pay-per-crawl); [Security Boulevard, Apr 2026](https://securityboulevard.com/2026/04/the-ai-content-crisis-how-llms-are-draining-media-revenue-and-the-technologies-fighting-back/)).
- **RSL (Really Simple Licensing)**: machine-readable license+fee terms layered on robots.txt, adopted by Reddit, Yahoo, Medium and others ([completeaitraining.com](https://completeaitraining.com/news/ai-crawlers-face-a-new-toll-as-publishers-adopt-rsl/)).

Verdict: payment forces identity as a side effect (you can't bill an anonymous crawler). But the payers are a dozen AI companies with content budgets. **Personal agents will never pay-per-crawl a skills directory**, so this carrot is structurally unavailable to ClaudeAtlas except via x402 micro-amounts (below).

### c) llms.txt: "identify/read this → cheaper tokens, cleaner content" — **failed as an adoption mechanism**

- Site-side adoption: ~10.13% of 300k domains studied — but 39.6% of those are plugin stubs ([derivatex guide citing SE Ranking](https://derivatex.agency/blog/llms-txt-guide/)).
- Consumption side — the part that matters: **server logs across 137k+ domains show ~97% of llms.txt files are never fetched by AI crawlers; a 500M-AI-bot-visit / 90-day sample found only 408 requests targeting llms.txt** ([ariashaw.com evidence review](https://ariashaw.com/does-llms-txt-actually-work); [aeo.press state-of, 2026](https://ai.aeo.press/the-state-of-llms-txt-in-2026)).
- **No major AI company (OpenAI, Google, Anthropic, Meta, Mistral) has committed to reading it**; Google's Gary Illyes said Google won't support it, and John Mueller compared it to the keywords meta tag ([linkbuildinghq](https://www.linkbuildinghq.com/blog/should-websites-implement-llms-txt-in-2026/)).

This is the exact mirror of the agent-ping: a standard the powerless side (sites) adopted and the powerful side (agents) ignored. Directly relevant: **advertising the ping endpoint in llms.txt put it in a file that agents statistically never read.**

### d) x402 / HTTP 402 agent payments — **real infrastructure, inflated usage, watch not build**

Coinbase+Cloudflare's x402 turns 402 into machine-readable payment negotiation (agent pays USDC on Base, retries with receipt header). Coinbase claims 160M cumulative agentic payments, but independent analysis (Artemis) put March 2026 activity at ~131k tx/day worth ~$28k/day, **with roughly half estimated to be self-dealing or wash trading** ([TECHi](https://www.techi.com/coinbase-x402-agent-payments-merchant-side/); [digitalapplied overview](https://www.digitalapplied.com/blog/x402-payment-protocol-ai-agents-pay-coinbase-cloudflare)). Governance moved to a Linux Foundation x402 Foundation (~40 members incl. Visa, Mastercard, Amex, Stripe, Google, AWS, Cloudflare) ([Coinbase](https://www.coinbase.com/developer-platform/discover/launches/x402)). Payment implies identity, so this is a long-run identity vector — but at $28k/day across the whole internet, it moves nothing in 2026.

### e) API keys / mandatory headers — **the oldest proof that identification works when you own something agents want**

GitHub's REST API **rejects any request without a User-Agent header with a 403** ("so GitHub can contact you if there are problems") and has for over a decade ([GitHub REST docs](https://docs.github.com/rest/guides/getting-started-with-the-rest-api)). Nobody calls this an imposition; every client library complies. Lesson: **on an API you control, identification can simply be required — compliance is near-total because the alternative is no service.** The open web is where mandates fail; APIs are where they succeed.

### f) OpenRouter app attribution — **the most relevant prior art for ClaudeAtlas, period**

OpenRouter asks apps calling its API to send two optional headers — `HTTP-Referer` (app URL, the ranking identifier) and `X-Title` (display name). The reward: **your app appears on OpenRouter's public leaderboards (daily/weekly/monthly), is featured on model pages ("apps using this model"), and gets free analytics** ([openrouter.ai/docs/app-attribution](https://openrouter.ai/docs/app-attribution)). Adoption is high enough that downstream tools file bugs when the headers *aren't* sent ([continuedev/continue#12119](https://github.com/continuedev/continue/issues/12119)). This is a niche platform successfully bootstrapping voluntary identification by paying in **marketing visibility** — the one currency a directory has infinite supply of.

---

## 3. The access-tiering play: better service for identified agents

**People are doing it — but the live implementations key on *content negotiation*, not identity.**

- **Vercel** ships the flagship writeup: HTTP content negotiation serving markdown to agents and HTML to humans from the same URL. Measured result on their own post: HTML ~500KB → markdown ~3KB, a **99.37% payload reduction**; they recommend `Accept: text/markdown` detection, markdown sitemaps, and `<link rel="alternate">` discovery ([Vercel: "Making agent-friendly pages with content negotiation"](https://vercel.com/blog/making-agent-friendly-pages-with-content-negotiation)). Vercel also serves every docs page as markdown and treats "agent experience" (AX) as a product surface.
- The "agent-friendly website" literature (2026) converges on: JSON-LD, rate-limit state in headers (`X-RateLimit-*`), machine-actionable 429s with `Retry-After`, structured endpoints ([Apideck: API design for the agentic era](https://www.apideck.com/blog/api-design-principles-agentic-era); [Cintra playbook](https://cintra.run/blog/ai-agent-friendly-website); [prerender.io guide](https://prerender.io/blog/how-to-build-ai-agent-friendly-websites/)).
- Identity-*gated* tiering (higher limits / no challenges for signed agents) exists mainly as the Cloudflare Enterprise ruleset play: sites can write allow-rules against verified signed agents ([Cloudflare signed-agents](https://blog.cloudflare.com/signed-agents/)).

**The uncomfortable insight for the "tiering as identity incentive" theory:** `Accept: text/markdown` gives agents the cheap-tokens benefit *without* identifying who they are. The market discovered that the benefit could be decoupled from identity — and promptly decoupled it. Tiering only produces identification if the *good tier is gated on identity*, which means withholding something — and a small site that withholds gets routed around, not obeyed. Tiering works as an identity carrot only for gatekeepers big enough that agents can't route around them (Cloudflare), or for APIs whose data agents actually need (ClaudeAtlas, partially — see §6).

---

## 4. Framework-level defaults: solving it upstream

**Could the problem be solved by SDK defaults? It's the highest-leverage lever, and it's half-pulled already.**

What's already default (see §5 for strings): Anthropic's Claude Code CLI sends a distinctive `claude-code/<version>` User-Agent from the user's machine; Claude API web fetch sends `Claude-User`; OpenAI sends `ChatGPT-User` and a declared ChatGPT Agent; Perplexity sends `Perplexity-User`; Mistral sends `MistralAI-User` ([agentgrade Claude-User page](https://agentgrade.com/agents/claude-user); [xseek Claude UA docs](https://www.xseek.io/docs/claude-user-agents); [nohacks.co landscape](https://nohacks.co/blog/ai-user-agents-landscape-2026)). Users have even filed feature requests asking Claude Code to let them *change* the UA — currently they can't easily ([anthropics/claude-code#7696](https://github.com/anthropics/claude-code/issues/7696)).

What's default in the *wrong* direction: Google-Agent uses standard Chrome UA strings with no bot signal; Microsoft Copilot Actions uses plain Edge UA; xAI's Grok uses residential IP rotation and spoofed Safari/Chrome UAs; browser-use and other Playwright-based frameworks inherit `HeadlessChrome` UAs and the ecosystem's dominant energy goes into **stealth plugins that erase identification** ([Scrapfly on Playwright stealth](https://scrapfly.io/blog/posts/playwright-stealth-bypass-bot-detection); [vercel-labs/agent-browser#120](https://github.com/vercel-labs/agent-browser/issues/120) — a request to add stealth mode *by default*).

**Why the incentive runs backwards:** every identified agent UA is a blockable UA. The Cloudflare–Perplexity fight (Aug 2025) is the canonical case; Perplexity's defense was that its agents act *for users* and that infrastructure gatekeeping creates "a two-tiered internet where your access depends... on whether your chosen tools have been blessed by infrastructure controllers" ([TechCrunch](https://techcrunch.com/2025/08/05/some-people-are-defending-perplexity-after-cloudflare-named-and-shamed-it); [Contrary Research deep dive](https://research.contrary.com/report/debating-the-open-internet-cloudflare-vs-perplexity); [Fast Company](https://www.fastcompany.com/91381861/ai-agents-war-web-economics-perplexity-cloudflare)). As long as the dominant *use* of identification is blocking, frameworks protect their users by not identifying. **Any proposal to formalize framework identification must be paired with a credible benefit, or it's asking vendors to paint targets on their users.**

**Formal proposals in flight (all enterprise-IAM flavored, none web-traffic flavored):** OpenID Foundation's "Identity Management for Agentic AI" whitepaper (Oct 2025); OIDC-A 1.0 (agent identity/attestation/delegation-chain claims); [draft-sharif-openid-agent-identity-00](https://datatracker.ietf.org/doc/draft-sharif-openid-agent-identity/00/); IETF draft-klrc-aiagent-auth-00 / AIMS (Mar 2, 2026); Microsoft Entra Agent ID ([Microsoft Learn](https://learn.microsoft.com/en-us/entra/agent-id/what-is-agent-id-platform)). These solve "which agent in my company did this," not "which agent visited my website."

**The privacy-preserving middle ground exists and is already the de facto norm where identification happens at all:** identify the *agent type and operator*, never the user. `Claude-Code/2.x` from a residential IP tells you the tool, not the person. Web Bot Auth is likewise operator-level. The genuine residual privacy objection is metadata: even ZK-style schemes can't hide the *pattern* of verification events ([arXiv, "AI Identity: Standards, Gaps," Apr 2026](https://arxiv.org/pdf/2604.23280)). For type-level UA strings this objection is weak — the realistic objection is the blocking asymmetry, not privacy. **A campaign to get LangChain/browser-use to append a passive product token (e.g., `... browser-use/0.x`) is technically trivial and has no user-privacy cost; its obstacle is purely that identified agents get worse treatment today.**

---

## 5. What agents already send accidentally (the formalizable leak)

Distinctive default signals a small site can log **today**, ranked by usefulness:

| Signal | Who sends it | Identifies |
|---|---|---|
| `claude-code/<ver>` UA | Claude Code CLI WebFetch, from user machines/residential IPs | Tool + version, not user ([xseek](https://www.xseek.io/docs/claude-user-agents)) |
| `Claude-User/1.0; +Claude-User@anthropic.com` | Claude API web fetch (Anthropic IPs, published in [bots.json](https://agentgrade.com/agents/claude-user)) | User-initiated Claude fetches |
| `ChatGPT-User`, `OAI-SearchBot`, GPTBot, ChatGPT Agent | OpenAI, vendor IPs, published ranges | Per-purpose ([knownagents](https://knownagents.com/agents/chatgpt-user)) |
| `Perplexity-User`, `MistralAI-User`, DuckAssistBot etc. | Respective vendors | Per-purpose ([nohacks.co](https://nohacks.co/blog/ai-user-agents-landscape-2026)) |
| `Accept: text/markdown` request header | "Many agents already send" it per Vercel | Agent-ness without vendor ([Vercel](https://vercel.com/blog/making-agent-friendly-pages-with-content-negotiation)) |
| `python-requests/2.x`, `axios/1.x`, `node-fetch` | Naive LangChain/custom agents that never set a UA | Automation, ambiguously ([zenrows](https://www.zenrows.com/blog/python-requests-user-agent)) |
| `HeadlessChrome` in UA, `navigator.webdriver` | Un-stealthed Playwright/browser-use | Browser automation ([brightdata](https://brightdata.com/blog/how-tos/avoid-bot-detection-with-playwright-stealth)) |
| Nothing at all | Grok, Copilot Actions, agentic browsers (Claude for Chrome, Comet, ChatGPT Atlas) | ~half of AI traffic is unidentifiable ([nohacks.co](https://nohacks.co/blog/ai-user-agents-landscape-2026)) |

**Persuadability ranking:** Anthropic and OpenAI already identify at type level — the ask there is "keep doing it and formalize it" (near-zero cost, they've shown willingness). Mistral/Perplexity partially. LangChain and browser-use are persuadable in principle (passive product token, one-line PR) but face user pushback because their users are precisely the ones getting blocked. Grok/Copilot Actions/agentic browsers: not persuadable by anyone smaller than Cloudflare.

---

## 6. The MCP/registry angle: can ClaudeAtlas bootstrap a convention?

**Prior art says a niche platform can bootstrap identification — but only on its own API, and only by paying in visibility or capability:**

1. **GitHub API mandatory User-Agent** — a "directory" (of code) making identification a hard requirement of API access; universal compliance ([GitHub docs](https://docs.github.com/rest/guides/getting-started-with-the-rest-api)).
2. **OpenRouter app attribution** — voluntary headers rewarded with public leaderboards and per-model featuring; adopted widely enough that missing headers get bug reports ([OpenRouter docs](https://openrouter.ai/docs/app-attribution)).
3. **MCP official registry** — namespace-verified `server.json` publication became the convention because Claude/clients consume the registry ([registry requirements](https://raw.githubusercontent.com/modelcontextprotocol/registry/refs/heads/main/docs/reference/server-json/official-registry-requirements.md); [glama.ai writeup, Jan 2026](https://glama.ai/blog/2026-01-24-official-mcp-registry-serverjson-requirements)).
4. Counter-example: **llms.txt-advertised opt-in endpoints** — the mechanism already tried; consumption ~0 (§2c).

What's genuinely unusual about ClaudeAtlas's position: **it distributes the code agents run.** Skills are instructions executed inside Claude Code sessions. A convention embedded in the skills themselves — "when this skill calls ClaudeAtlas's API, send `X-Agent-Identity: claude-code/<ver>; skill=<slug>`" — propagates through distribution, not persuasion. That's the schema.org/WordPress-plugin trick (adoption via tooling defaults) applied at directory scale. No other party can teach thousands of skill authors a header convention as cheaply, because the docs page they read is yours.

Honest ceiling: OpenRouter-style success means identification *on your API*, giving clean first-party analytics and a marketable "identified agents" dataset. It does not make agents identify themselves to other sites — unless the convention gets picked up by a framework.

---

## Ranked list: realistic mechanisms for agent self-identification

| # | Mechanism | Who must act | Adoption odds by ~2028 | Notes |
|---|---|---|---|---|
| 1 | **Type-level UA identification baked into vendor tools** (claude-code, Claude-User, ChatGPT-User…) | Model vendors | **Already ~50% of AI traffic; high odds it persists and expands** | The one that already happened. Passive, privacy-clean, blockable — vendors keep it because reputational cost of stealth is high post-Perplexity |
| 2 | **Web Bot Auth via gatekeeper coercion** for hosted/fleet agents | Cloudflare, AWS, Akamai + vendors | **High for major hosted agents (OpenAI in; Anthropic likely follows); IETF standardization slipping** | Missed April 2026 milestone; production reality is ahead of standards. Does nothing for personal-machine agents |
| 3 | **Payment-linked identity** (pay-per-crawl, TollBit, RSL, x402, Visa TAP/Mastercard Agent Pay) | AI cos + payment networks | **Medium-high where money flows; near-zero for free content/APIs** | 1B daily 402s proves the plumbing; x402 volumes still tiny and partly wash-traded |
| 4 | **Mandatory identification on valuable APIs** (GitHub model) | Any API owner | **Proven ~100% compliance — but only proportional to your leverage** | Works instantly; requires having something agents need |
| 5 | **Attribution-for-visibility** (OpenRouter model: header → leaderboard) | Any directory/platform | **Proven at niche scale; the only mechanism a small player can run unilaterally** | Pays in marketing, the currency directories mint |
| 6 | **Framework default headers in OSS SDKs** (LangChain/browser-use product tokens) | Framework maintainers | **Low-medium; stealth demand pulls the other way** | One-line PRs, but the ecosystem's paying customers want less identification, not more |
| 7 | **Personal-machine agent identity** (the dream: laptop agents raising hands) | OS/browser/model vendors | **Very low without vendor buy-in; partially delivered as a side effect of #1** (claude-code UA comes from laptops) | Agentic browsers are currently going the *opposite* way — indistinguishable from the human's browser |
| 8 | **Pure opt-in ping endpoints / llms.txt-advertised requests** | Sites, hoping | **~0. Empirically dead** (97% of llms.txt never fetched; the n=1 smoke test) | The control group |

---

## Recommendation

**What requires platform cooperation (don't bet the product on it):** universal signed identity for personal-machine agents; IETF Web Bot Auth standardization; frameworks adding identity headers against their users' blocking-avoidance interests. Track these; do not depend on them. If you want to nudge, the cheapest high-EV moves are (a) a polite PR/issue to browser-use and LangChain proposing a *passive* product token in the UA, framed as "sites are starting to give markdown and higher limits to declared agents" — it will likely stall, but costs an afternoon; (b) public support for Anthropic formalizing claude-code's UA as a documented, stable identifier (they already leak it; ask them to bless it).

**What a small player should actually do (all unilateral, all this quarter):**

1. **Kill the ping endpoint; measure the leak instead.** ~Half of AI traffic already self-identifies passively. Log UA (claude-code/*, Claude-User, ChatGPT-User, Perplexity-User, python-requests, HeadlessChrome), `Accept: text/markdown`, and `Signature-Agent` headers. The agent-traffic analytics product should be built on what agents *already send*, with an explicit "identified vs. unidentified" split as the honest headline metric — that split is itself the story customers want.
2. **Ship content negotiation as the carrot** (Vercel pattern: markdown at the same URLs, ~99% payload reduction, markdown sitemap). This makes ClaudeAtlas demonstrably agent-friendly and gives agents' tooling a reason to touch it preferentially.
3. **Run the OpenRouter play on the API.** Document `X-Agent-Identity` (or reuse UA + an optional `skill=` parameter); reward it with a public "Agents using ClaudeAtlas" leaderboard, per-skill usage attribution for skill authors, and a fatter JSON response tier. Require it (GitHub-style 403) only on the highest-value endpoints once volume exists, never on day one.
4. **Embed the convention in the skills you distribute.** ClaudeAtlas's unique wedge: the install snippets, docs, and top skills on claudeatlas.com can carry the header convention into thousands of agent sessions. Adoption-via-tooling-default is the only pattern that has ever worked for the small side of a standard.
5. **Verify Web Bot Auth signatures now.** It's a few dozen lines against the JWKS directory format, makes ClaudeAtlas one of the first *directories* rewarding signed agents (early-mover positioning in every future writeup), and future-proofs the analytics product for the fleet-agent traffic that will be signed.

The one-sentence version: **history says nobody adopts identification because a site asked; they adopt because the tool they use already sends it, or because someone with leverage pays/blocks — so a small player's only winning move is to instrument the accidental identification that already exists, and to use its distribution channel and marketing surface to make deliberate identification profitable.**

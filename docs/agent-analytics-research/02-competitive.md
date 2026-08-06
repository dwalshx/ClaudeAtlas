# Research report 2: Competitive landscape (verbatim, 2026-08-04)

# Competitive Landscape: Bot / AI-Agent Traffic Classification & Analytics (as of August 2026)

Research method: 19 web searches + page fetches across vendor docs, changelogs, pricing pages, and 2026 comparison reviews. All claims sourced at the bottom. Honest bottom line up front: **the "log-based agent analytics" space is no longer empty — it got crowded fast in late 2025/2026 — but the specific cell of (dev-first drop-in) × (named-agent semantics) × (cheap/free) × (analytics-first, not blocking-first) has exactly one direct incumbent (Known Agents, née Dark Visitors) and a lot of adjacent giants.** Details below.

---

## 1. Infra / CDN incumbents

### Cloudflare — the 800-lb gorilla, and it moved fast
- **AI Crawl Control** (rebranded from AI Audit, Sept 2025): available on **all plans including Free**. Shows which AI services access your content, crawler activity/request patterns, robots.txt compliance tracking, allow/block per named crawler. ([developers.cloudflare.com/ai-crawl-control](https://developers.cloudflare.com/ai-crawl-control/))
- **Pay Per Crawl**: still **private beta** as of the June 16, 2026 changelog. Minimum $0.01/crawl, Stripe payouts, dynamic pricing via response header or Worker, a discovery API for crawler operators, per-URI configuration rules. ([changelog 2026-06-16](https://developers.cloudflare.com/changelog/post/2026-06-16-pay-per-crawl-advanced-configuration/), [docs](https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/))
- **Bot analytics ladder**: Bot Fight Mode free; Super Bot Fight Mode with per-category actions on Pro; the dedicated Bot Analytics dashboard is **Business+**; per-request bot scores are **Enterprise Bot Management** only. ([developers.cloudflare.com/bots](https://developers.cloudflare.com/bots/), [bot-analytics](https://developers.cloudflare.com/bots/bot-analytics/))
- **AI Labyrinth** (poison misbehaving crawlers with generated content): opt-in on all plans incl. Free. ([blog.cloudflare.com/ai-labyrinth](https://blog.cloudflare.com/ai-labyrinth/))
- **Radar**: free public stats — as of mid-2026: bots = 35.2% of all traffic, 57.5% of HTML traffic; AI crawlers ≈ 20.3% of verified-bot traffic + 6.5% AI-search; Anthropic is the #2 bot operator (13.2%), ahead of Meta and ~2× OpenAI. ([radar.cloudflare.com/bots](https://radar.cloudflare.com/bots), [radar.cloudflare.com/ai-insights](https://radar.cloudflare.com/ai-insights))
- **Web Bot Auth / Signed Agents**: Cloudflare-led IETF-draft standard (RFC 9421 HTTP Message Signatures + Ed25519 keys + `Signature-Agent` header + JWKS directory); IETF WG chartered 2026; backed by Amazon, Akamai, OpenAI; verification live on Free/Pro. Claude, ChatGPT, Perplexity, Common Crawl already sign. ([blog.cloudflare.com/signed-agents](https://blog.cloudflare.com/signed-agents/), [github.com/cloudflare/web-bot-auth](https://github.com/cloudflare/web-bot-auth))
- **Does NOT do**: anything off-Cloudflare. You must proxy your DNS through them. Deep analytics still paywalled at Business/Enterprise; AI Crawl Control shows crawlers, not clean "human vs. agent vs. scraper" product analytics.

### Vercel
- **BotID**: invisible bot challenge; Basic mode free on all plans; **Deep Analysis $1/1,000 calls** (powered by Kasada — note: Vercel licenses a bot-detection vendor rather than building its own ML). Was free Nov 5 2025–Jan 15 2026 as a promo. ([vercel.com/docs/botid](https://vercel.com/docs/botid), [changelog](https://vercel.com/changelog/free-botid-deep-analysis))
- **Bot observability**: Edge Requests dashboard now breaks traffic down **by bot name, category, and verification status, on all plans**; verification badges shown; queryable in Observability Plus. Firewall has a maintained "AI Bots" ruleset (log or deny). Vercel also published a "three types of AI bot traffic" taxonomy (training / search-index / user-request). ([changelog: bot activity in Observability](https://vercel.com/changelog/bot-activity-and-crawler-insights-now-in-observability), [changelog: bot verification data](https://vercel.com/changelog/view-and-query-bot-verification-data-in-vercel-observability), [blog](https://vercel.com/blog/the-three-types-of-ai-bot-traffic-and-how-to-handle-them))
- **Does NOT do**: work off-Vercel; page-level content analytics tying agents to content; referral-side (human-from-ChatGPT) attribution.

### Fastly
- **AI Bot Management** launched as a paid add-on (contact sales; requires a paid delivery contract — no free tier). Detects/blocks/intercepts named AI bots; partnered with **TollBit** for monetization redirects. Publishes strong research (Aug 2025: AI crawlers ≈ 80% of AI bot traffic; Meta leads crawling). ([docs.fastly.com/products/bot-management](https://docs.fastly.com/products/bot-management), [tollbit.com/blog/fastly-partnership](https://tollbit.com/blog/fastly-partnership/))
- **Does NOT do**: self-serve or cheap; analytics is an enterprise console, not a product-analytics view.

### Akamai
- **Bot Manager** + dedicated **AI scraper-bot protection** solution: verified allowlists, behavioral analysis, block-AI-by-default option; also partnered with TollBit for "monetizing AI bots at the edge." Reported AI bot traffic up 300%+ since tracking began. Enterprise-only, sales-priced. ([akamai.com/products/bot-manager](https://www.akamai.com/products/bot-manager), [akamai blog](https://www.akamai.com/blog/security/from-scraping-paying-monetizing-ai-bots-edge))

### Netlify
- Auto-blocks bot scans on all plans (2.9B PHP-probe requests blocked since Dec 2025); a **User Agent Blocker** edge-function extension for AI crawlers; for *measurement* their own guidance is "use **Log Drains** (paid) to ship server logs to Datadog/S3/AEO platforms" — i.e., they explicitly punt analytics to third parties. ([netlify.com/blog/tracking-ai-search-traffic](https://www.netlify.com/blog/tracking-ai-search-traffic/), [docs](https://docs.netlify.com/build/build-with-ai/block-ai-crawlers/))

---

## 2. Bot-detection vendors

- **DataDome** — Forrester Wave Q2 2026 Leader ("Bot and Agent Trust Management" — note the category itself was renamed around agents). Rebranded core as "Agent Trust"; edge/CDN deployment; publishes pricing (unusual) but effectively enterprise custom. Strong on API/mobile, e-commerce, "Priority Protect" queue management for drops. **Not** a dev drop-in; blocking-first, analytics secondary. ([cside comparison, 2026](https://cside.com/blog/best-bot-and-agent-trust-management-platforms-compared), [prosopo](https://prosopo.io/blog/top-datadome-alternatives))
- **HUMAN Security** — Leader; shipped **AgenticTrust** for session-level AI-agent intelligence. Enterprise, ad-fraud-adjacent. Same story: protection product, sales-led.
- **Kasada** — Leader; network-layer, policy-driven; notable as the ML engine behind Vercel BotID Deep Analysis. Enterprise only.
- **Arcjet** — the one dev-first player: SDK-in-code (Node/Next/Bun/Deno, etc.), bot detection + rate limiting + WAF + email validation; 2026 additions: **local AI bot/attack detection model** and **Advanced Bot Signals** (browser telemetry, no CAPTCHA). **Free: 5 rules/3 devs; Pro $25/mo; Enterprise custom.** ([arcjet.com/pricing](https://arcjet.com/pricing), [blog.arcjet.com](https://blog.arcjet.com/new-features-to-protect-your-site-from-ai-scrapers-and-other-bots/), [Yahoo Finance PR](https://finance.yahoo.com/news/arcjet-introduces-local-ai-bot-130000588.html))
- **What Arcjet does NOT do** (this matters): it is a *protection* SDK. Its output is allow/deny/challenge decisions, not an analytics product — no named-agent traffic dashboard, no LLM-referral attribution, no content-level "which pages do agents read" reporting. Nearest gap-adjacent incumbent, but pointed at security, not measurement.
- **cside, Arkose, Prosopo** — newer/browser-layer or challenge-based entrants rounding out the 2026 category; none analytics-first.

---

## 3. AI-crawler-specific tools

- **Known Agents (formerly Dark Visitors — rebranded early 2026)** — **the closest direct competitor to the proposed package.** Agent Analytics (real-time crawler/agent visits with named actors + operator + verification status), LLM Referral Tracking (human traffic from ChatGPT/Claude/Gemini/Copilot/Perplexity/Meta AI/DeepSeek/Mistral), Automatic robots.txt (auto-updates as new agents appear), Agent Identification API. Deployment: platform connectors (Cloudflare, AWS, GCP, Vercel, Fastly, Akamai, WordPress) + **Node.js SDK** + REST API. **Pricing: Free 100k events/mo/1 project; $29/mo 1M events/3 projects; $299/mo 10M/10 projects; Enterprise custom.** ([knownagents.com](https://knownagents.com/), [rebrand post](https://knownagents.com/posts/dark-visitors-is-now-known-agents), [analytics docs](https://darkvisitors.com/docs/analytics))
  - Does NOT do: blocking/enforcement itself (it feeds robots.txt and classification; enforcement is your job), self-hosting (SaaS backend), or deep product analytics (funnels, content-level SEO tie-ins).
- **TollBit** — bot paywall/licensing marketplace: detect AI bots, enforce robots.txt, redirect to a paid endpoint; publishers set per-page/per-query rates and keep 100% (AI buyer pays TollBit a transaction fee); **free for publishers to start**; ~7,000 sites, ~20% earning (hundreds to tens of thousands $/mo); distribution deals with **Arc XP** (Washington Post's CMS, Mar 2026), **Fastly**, and **Imperva**; quarterly "State of the Bots" reports (scraping +29% Q2→Q3, +20% Q3→Q4 2025). ([Digiday](https://digiday.com/media/the-washington-posts-arc-xp-adds-tollbit-to-help-publishers-make-money-from-ai-bot-traffic/), [Arc XP PR, 2026-03-23](https://www.arcxp.com/2026/03/23/arc-xp-partners-with-tollbit-to-help-publishers-monitor-control-and-monetize-ai-bot-traffic/), [Imperva blog](https://www.imperva.com/blog/imperva-partners-with-tollbit-to-power-ai-traffic-monetization-for-content-owners/)). Analytics is a means to monetization, not the product.
- **ScalePost** — deal-broker between AI companies (notably Perplexity) and publishers; onboarding, pricing, legal; plus AI-search appearance analytics. Publisher/media-focused, not dev-tool. ([scalepost.ai](https://www.scalepost.ai/), [Adweek](https://www.adweek.com/media/meet-scalepost-the-ai-firm-helping-perplexity-strike-deals-with-publishers/))
- **ProRata / Gist.ai** — different model: attribution-based rev-share inside its own licensed-content answer engine (~400 partners; 50/50 ad split). Not site-side analytics at all. ([Press Gazette](https://pressgazette.co.uk/publishers/digital-journalism/prorata-publishers-ai-start-up-news-widget-answers/))
- **llms.txt analytics**: no real product category — and notably, 2026 field data says AI crawlers **almost never fetch /llms.txt** (GPTBot, ClaudeBot, PerplexityBot overwhelmingly skip it). Tracking it is a server-log grep, not a market. ([limy.ai guide](https://limy.ai/blog/llms.txt-in-2026-the-full-guide), [nicklafferty.com](https://nicklafferty.com/blog/llm-tracking-tools/))

---

## 4. Analytics products' AI features

- **Plausible** — ships native **AI traffic monitoring** for *referral* visits from ChatGPT/Perplexity/Claude (client-side, human sessions). Bots filtered server-side and discarded — agents are noise to remove, not a report. ([inimino comparison, 2026](https://inimino.org/plausible-vs-umami-vs-goatcounter-privacy-first-analytics-compared-for-2026/))
- **Matomo** — **v5.8 (March 2026) added "AI Assistants Tracking"**: dedicated reports segmenting visits from ChatGPT, Perplexity, Claude, Copilot etc., and separating non-human LLM visits from human AI referrals. The most agent-aware of the privacy analytics tools, but still JS-tracker-based, so most crawler traffic (no JS execution) never reaches it. ([matomo.org blog, 2026-03](https://matomo.org/blog/2026/03/new-feature-matomo-ai-assistants-tracking/), [2026-07 guide](https://matomo.org/blog/2026/07/ai-chatbot-traffic-guide-for-web-analytics-in-2026/))
- **Fathom** — proprietary opaque bot filtering; no AI-specific reporting. ([usefathom.com/docs/features/bot-detection](https://usefathom.com/docs/features/bot-detection))
- **Umami** — JS-only, so bots self-exclude; community workaround is Cloudflare-side filtering. No agent reports.
- **GA4** — **May 13, 2026: Google added a native "AI Assistant" default channel** (medium `ai-assistant`) recognizing ChatGPT, Gemini, DeepSeek, Copilot, Grok — **but not Perplexity**; 35–70% of AI referrals still land in Direct (missing referrer). And GA4 *filters bot/crawler hits out by design*, so agent visits themselves are invisible. ([digitalapplied.com GA4 playbook](https://www.digitalapplied.com/blog/ga4-ai-assistant-channel-2026-measure-ai-traffic-playbook), [terminusapp.com](https://www.terminusapp.com/blog/ai-traffic-channel-in-ga4/))
- **Ahrefs Brand Radar / Semrush AI Toolkit** — prompt-sampling visibility, not logs. Brand Radar: $199/platform/mo or $699 bundle on top of $129 base; Semrush AI Toolkit: $99/mo add-on; Semrush also audits sites for AI-crawler blockers. Reviewers explicitly note that for AI-agent *log* analysis "a specialist tool will go deeper than Brand Radar does today." ([bloggerjet.com comparison](https://bloggerjet.com/semrush-ai-toolkit-vs-ahrefs-brand-radar/), [layer3labs review](https://www.layer3labs.io/guides/ahrefs-brand-radar-review))

**Key takeaway**: every analytics product treats agents either as pollution to filter (GA4, Fathom, Umami) or measures only the *human referral* side (Plausible, Matomo, GA4's new channel). **None does server/edge-side classification of agent requests themselves.**

---

## 5. AEO/GEO citation-monitoring startups — and the log-based question

Category funding: $200M+ disclosed by early 2026 ([nicklafferty.com AEO tools](https://nicklafferty.com/blog/best-aeo-tools-answer-engine-optimization/)).

| Company | Funding | Pricing | Measurement | **Log-based agent measurement?** |
|---|---|---|---|---|
| **Profound** | $96M Series C @ $1B (Feb 2026, Lightspeed); ~$155M total | Growth $399/mo (3 engines, 100 prompts); enterprise five-figure/yr | Prompt-sampling + **Agent Analytics** | **YES** — CDN/log integrations: Cloudflare Logpush (Enterprise CF required), Fastly, Akamai, Vercel, Shopify. UA + IP-range verification. The category's log-based leader. |
| **Scrunch** | $26M; **acquired by Sitecore June 3, 2026** | From $250/mo (125 prompts) | Prompt-sampling + **Agent Traffic** | **YES** — reads CDN/host logs (Cloudflare, Akamai, Vercel, WordPress); classifies retrieval vs. indexer vs. training; AXP even serves agents optimized pages. Enterprise trajectory post-acquisition. |
| **Peec AI** | mid-market | €89–495/mo | Prompt-sampling | **YES (new, 2026)** — "Crawl Insights" reads server logs for 40+ AI bots + free robots.txt crawlability checker ([peec.ai blog, 2026-07-16](https://peec.ai/blog/why-server-logs-are-crucial-for-ai-search-strategy)) |
| **Otterly.ai** | Gartner Cool Vendor 2025 | from $29/mo | Prompt-sampling, GA integration | No (referral side only) |
| **Goodie AI** | — | $399–495/mo | Prompt-sampling + content production | No |
| **AthenaHQ** | — | $295/mo | Prompt-sampling | No |
| **Evertune** | $19M ($15M Series A, Aug 2026, Felicis) | from $3,000/mo | Panel-based brand measurement | No |

**Honest read**: the "nobody does log-based" thesis is ~9 months stale. Profound, Scrunch, and Peec all shipped log-based agent measurement in late 2025–mid 2026. **But** all three deliver it as a feature inside a marketing-priced AEO suite ($250–$5,000+/mo), via *CDN log integrations that often require enterprise CDN plans* (Cloudflare Logpush = CF Enterprise), sold to marketing/SEO teams — not as a $0–29 npm-installable package for developers.

---

## 6. Open source

- **isbot** (omrilotan) — the standard UA-string bot detector npm package; community-maintained, "good bots that self-identify" scope. No agent semantics (no operator, no purpose, no verification). ([github.com/omrilotan/isbot](https://github.com/omrilotan/isbot))
- **crawler-user-agents** (monperrus) — JSON regex list of crawler UAs, community-maintained, includes AI crawlers; data, not a product. ([npm](https://www.npmjs.com/package/crawler-user-agents))
- **matomo/device-detector, ua-parser** — general UA parsing; bots incidental.
- **Newer AI-specific OSS (all small)**:
  - **Loamly** ([github.com/loamly/loamly](https://github.com/loamly/loamly)) — MIT, ~21 stars — the most interesting technically: RFC 9421 **signature verification** (100% accuracy tier) + UA + behavioral ML + nav-timing; four deployment modes (managed proxy, Cloudflare Worker, Next.js edge middleware, JS tracker). Validates the exact architecture but has no traction yet.
  - **@apideck/agent-analytics** (npm) — drop-in Next.js/Vercel middleware detecting ClaudeBot, GPTBot, PerplexityBot, Google-Extended, Cursor, Windsurf etc., piping to PostHog/webhooks. Direct proof of demand for the package shape. ([npm](https://www.npmjs.com/package/@apideck/agent-analytics))
  - **Cairrot cloudflare-ai-crawler-tracker** — open-source CF Worker logging AI crawler hits to your own backend. ([github](https://github.com/Cairrot-Inc/cloudflare-ai-crawler-tracker))
  - **cloudflare/web-bot-auth** — official signing/verification libraries; the verification primitive is free and open.
- **Gap in OSS**: nothing combines maintained agent taxonomy (named actor + operator + purpose: training/search/user-request) + signature/IP verification + a real analytics backend. Each project has one leg.

---

## Gap analysis

Scoring the four axes — **(A)** dev-friendly drop-in, **(B)** agent-semantic naming (actor/operator/purpose), **(C)** log/server-side (not prompt-sampling, not client JS), **(D)** cheap/free:

| Player | A drop-in | B semantics | C server-side | D cheap | Miss |
|---|---|---|---|---|---|
| Cloudflare AI Crawl Control | ✗ (must be on CF) | ✓ | ✓ | ✓ free | CF lock-in; deep analytics = Business+ |
| Vercel observability | ✗ (Vercel-only) | ✓ | ✓ | ✓/paid | platform lock-in |
| Fastly/Akamai | ✗ | ✓ | ✓ | ✗ | enterprise sales |
| Arcjet | ✓ SDK | partial | ✓ | ✓ $0–25 | **protection, not analytics** |
| DataDome/HUMAN/Kasada | ✗ | ✓ | ✓ | ✗ | enterprise |
| Profound / Scrunch / Peec | ✗ (CDN log integrations, often needing enterprise CDN) | ✓ | ✓ | ✗ ($250–5k/mo) | marketing-suite pricing, not dev distribution |
| TollBit | ✗ | ✓ | ✓ | ✓ free | monetization-first, publisher CMS distribution |
| Plausible/Matomo/GA4 | ✓ | ✗ | ✗ (JS; agents invisible or filtered) | ✓ | wrong layer entirely |
| **Known Agents** | **✓ SDK+connectors** | **✓** | **✓** | **✓ free–$29** | closest incumbent; SaaS-only, Node-only SDK, no enforcement, low brand awareness post-rebrand |
| OSS (isbot, Loamly, apideck) | ✓ | partial | ✓ | ✓ | fragmentary, unmaintained-risk, no backend |

**The unoccupied (or thinly occupied) wedge:**

1. **Known Agents is the direct competitor and must be the benchmark** — it occupies A×B×C×D. The differentiation questions against it specifically: self-hostable/OSS core (it's closed SaaS), multi-language SDKs (it's Node + REST), Web Bot Auth signature verification depth, enforcement hooks (it only classifies), and privacy/data-residency (its model ships your request events to their cloud).
2. **The verification layer is the fresh ground.** Web Bot Auth (RFC 9421) went from draft to IETF WG + OpenAI/Anthropic/Perplexity signing in under a year, with AWS WAF, Vercel, Shopify, Akamai support. UA-string classification is commoditizing; **cryptographic verification + intent taxonomy (training vs. search-index vs. live user-request, per Vercel's/Scrunch's taxonomy) as a portable OSS library** is not owned by anyone platform-neutral. Loamly (21 stars) proves the shape but hasn't won it.
3. **The AEO log-based players validated the value but priced out developers and small sites** — $250–5,000/mo, marketing buyers, CDN-enterprise log pipelines. An open-source, `npm install`-grade equivalent that later upsells hosted dashboards is the classic Plausible-vs-GA wedge replayed against Profound.
4. **Analytics tools structurally can't follow**: JS trackers never see crawlers; GA4 deletes them. CDNs can't follow off-platform. Security vendors won't cheapen into analytics. That leaves the framework-middleware layer (Next/Express/Django/Rails/Caddy plugins) genuinely contested only by Known Agents and micro-OSS.
5. **Timing risk to name honestly**: Cloudflare gives the core visibility away free to its ~20%+ of the web, and the standards it drives reduce classification to "verify a signature" — eroding proprietary-detection moats over time. The durable asset is therefore the *analytics product and taxonomy* (what did agents read, which operator, what purpose, what converted), not detection itself.

### Sources
- Cloudflare: [AI Crawl Control docs](https://developers.cloudflare.com/ai-crawl-control/) · [Pay Per Crawl changelog 2026-06-16](https://developers.cloudflare.com/changelog/post/2026-06-16-pay-per-crawl-advanced-configuration/) · [bots docs/plans](https://developers.cloudflare.com/bots/) · [AI Labyrinth](https://blog.cloudflare.com/ai-labyrinth/) · [Radar bots](https://radar.cloudflare.com/bots) · [Signed agents](https://blog.cloudflare.com/signed-agents/) · [web-bot-auth repo](https://github.com/cloudflare/web-bot-auth)
- Vercel: [BotID docs](https://vercel.com/docs/botid) · [free Deep Analysis changelog](https://vercel.com/changelog/free-botid-deep-analysis) · [bot activity in Observability](https://vercel.com/changelog/bot-activity-and-crawler-insights-now-in-observability) · [bot verification data](https://vercel.com/changelog/view-and-query-bot-verification-data-in-vercel-observability) · [three types of AI bot traffic](https://vercel.com/blog/the-three-types-of-ai-bot-traffic-and-how-to-handle-them)
- Fastly/Akamai/Netlify: [Fastly Bot Management](https://docs.fastly.com/products/bot-management) · [Fastly 2025 threat research](https://markets.financialcontent.com/concordmonitor/article/bizwire-2025-8-19-new-fastly-threat-research-reveals-ai-crawlers-make-up-almost-80-of-ai-bot-traffic-meta-leads-ai-crawling-as-chatgpt-dominates-real-time-web-traffic) · [Akamai Bot Manager](https://www.akamai.com/products/bot-manager) · [Akamai+TollBit](https://www.akamai.com/blog/security/from-scraping-paying-monetizing-ai-bots-edge) · [Netlify AEO log drains](https://www.netlify.com/blog/tracking-ai-search-traffic/) · [Netlify PHP-scan blocking 2026-02-27](https://www.netlify.com/changelog/2026-02-27-php-scan-blocking/)
- Bot vendors: [cside 2026 comparison](https://cside.com/blog/best-bot-and-agent-trust-management-platforms-compared) · [Prosopo DataDome alternatives](https://prosopo.io/blog/top-datadome-alternatives) · [Arcjet pricing](https://arcjet.com/pricing) · [Arcjet blog](https://blog.arcjet.com/new-features-to-protect-your-site-from-ai-scrapers-and-other-bots/) · [Arcjet local model PR](https://finance.yahoo.com/news/arcjet-introduces-local-ai-bot-130000588.html)
- AI-crawler tools: [Known Agents](https://knownagents.com/) · [rebrand post](https://knownagents.com/posts/dark-visitors-is-now-known-agents) · [TollBit/Arc XP](https://www.arcxp.com/2026/03/23/arc-xp-partners-with-tollbit-to-help-publishers-monitor-control-and-monetize-ai-bot-traffic/) · [Digiday](https://digiday.com/media/the-washington-posts-arc-xp-adds-tollbit-to-help-publishers-monitor-control-and-monetize-ai-bot-traffic/) · [Imperva+TollBit](https://www.imperva.com/blog/imperva-partners-with-tollbit-to-power-ai-traffic-monetization-for-content-owners/) · [ScalePost](https://www.scalepost.ai/) / [Adweek](https://www.adweek.com/media/meet-scalepost-the-ai-firm-helping-perplexity-strike-deals-with-publishers/) · [ProRata/Gist](https://pressgazette.co.uk/publishers/digital-journalism/prorata-publishers-ai-start-up-news-widget-answers/) · [llms.txt reality](https://limy.ai/blog/llms.txt-in-2026-the-full-guide)
- Analytics: [Matomo AI Assistants 2026-03](https://matomo.org/blog/2026/03/new-feature-matomo-ai-assistants-tracking/) · [Matomo AI chatbot guide 2026-07](https://matomo.org/blog/2026/07/ai-chatbot-traffic-guide-for-web-analytics-in-2026/) · [Fathom bot detection](https://usefathom.com/docs/features/bot-detection) · [privacy-analytics comparison](https://inimino.org/plausible-vs-umami-vs-goatcounter-privacy-first-analytics-compared-for-2026/) · [GA4 AI Assistant channel](https://www.digitalapplied.com/blog/ga4-ai-assistant-channel-2026-measure-ai-traffic-playbook) · [Terminus GA4](https://www.terminusapp.com/blog/ai-traffic-channel-in-ga4/) · [Semrush vs Brand Radar](https://bloggerjet.com/semrush-ai-toolkit-vs-ahrefs-brand-radar/)
- AEO: [Profound Series B PR](https://www.prnewswire.com/news-releases/profound-raises-35m-series-b-as-ai-search-becomes-the-next-platform-shift-302527764.html) · [Profound Cloudflare Logpush docs](https://docs.tryprofound.com/agent-analytics/cloudflare_logpush) · [Profound Agent Analytics](https://www.tryprofound.com/features/agent-analytics) · [Scrunch agent traffic API docs](https://developers.scrunch.com/integrations/agent-traffic) · [Scrunch AXP](https://scrunch.com/blog/agent-experience-platform/) · [Peec server logs 2026-07-16](https://peec.ai/blog/why-server-logs-are-crucial-for-ai-search-strategy) · [Peec alternatives roundup](https://blog.timsoulo.com/14-peec-ai-alternatives-for-ai-search-visibility-tracking-2026/) · [AEO tools 2026](https://nicklafferty.com/blog/best-aeo-tools-answer-engine-optimization/) · [Evertune review](https://bestaeotools.com/tool/top-geo-platform-evertune-ai)
- OSS: [isbot](https://github.com/omrilotan/isbot) · [crawler-user-agents](https://www.npmjs.com/package/crawler-user-agents) · [Loamly](https://github.com/loamly/loamly) · [@apideck/agent-analytics](https://www.npmjs.com/package/@apideck/agent-analytics) · [Cairrot CF worker](https://github.com/Cairrot-Inc/cloudflare-ai-crawler-tracker)

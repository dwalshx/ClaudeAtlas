# Research report 6: Machine-Native Navigation as an Agent Identifier ("the fishing net")

(Verbatim output of research agent 6, 2026-08-04. Evaluates the idea: offer agents a "path of least resistance" — a machine-native navigation layer — such that *usage of that layer* becomes a self-selecting behavioral identifier.)

---

## 1. Prior art on machine-preferred paths

### llms.txt — high adoption, near-zero consumption

The single most important empirical dataset is Ahrefs' server-log study (published June 15, 2026, analyzing 137,210 domains during May 2026):

- 28% of analyzed domains published a valid llms.txt file, but **97% of those files received zero requests in May 2026**. Only ~1,100 domains saw any requests at all.
- Of requests that did occur: 96% were bots, and **77% of bot traffic was non-AI tooling** — SEO audit tools led at 21.7%, general crawlers 13.1%, tech-profiling tools 11.6%. AI retrieval bots (Perplexity, OAI-SearchBot, Claude's crawler) were just **1.1%**; GPTBot 4.51%, ClaudeBot 0.80% among training crawlers.
- Killer line: *"Zero requests came from AI bots for llms.txt files that don't exist. They never go looking."* Agents do not probe for it — they only fetch it when a human or tool config points them at it.
- Sources: https://ahrefs.com/blog/llmstxt-study/ (2026-06-15); adoption context: ~8.7–10% of top domains per https://www.rankability.com/data/llms-txt-adoption/ (June 2026) and https://ppc.land/llms-txt-adoption-rises-8-8x-but-97-of-files-get-zero-ai-requests/

Google's John Mueller publicly compared llms.txt to the dead keywords meta tag (https://www.searchenginejournal.com/google-says-llms-txt-comparable-to-keywords-meta-tag/544804/). The important nuance from multiple 2026 retrospectives: where llms.txt *does* get used is **IDE/coding agents (Claude Code, Cursor, Copilot, Windsurf) and MCP-based doc servers**, i.e., task-driven agents in developer workflows — exactly claudeatlas's audience (https://ai.aeo.press/the-state-of-llms-txt-in-2026).

### Markdown content negotiation — the one mechanism agents actually use unprompted

Checkly's measured test ("The Current State of Content Negotiation for AI Agents," Feb 2026, https://www.checklyhq.com/blog/state-of-ai-agent-content-negotation/) found **3 of 7 major coding agents send `Accept: text/markdown` on web fetches**:

- Claude Code v2.1.38: `Accept: text/markdown, text/html, */*`
- Cursor 2.4.28 and OpenCode 1.2.5: markdown preferred via quality factors
- OpenAI Codex, Gemini CLI, GitHub Copilot, Windsurf: generic `Accept: */*`
- Payoff measured on Checkly's own docs: 615.4 KB HTML (180,573 tokens) vs 2.3 KB markdown (478 tokens) — 99.7% token savings.

Platform support is now mainstream:

- **Cloudflare "Markdown for Agents"** launched Feb 11, 2026: edge-side HTML→markdown conversion when a client requests `text/markdown`, with a token-estimate response header; ~80% token reduction (https://thenewstack.io/cloudflares-markdown-for-agents-automatically-make-websites-more-aifriendly/, https://developers.cloudflare.com/changelog/post/2026-02-16-markdown-for-agents-improvements).
- **Vercel** published content-negotiation guides and converted its own blog/changelog, plus `sitemap.md` for agent discovery (https://vercel.com/blog/making-agent-friendly-pages-with-content-negotiation).
- **Mintlify** auto-generates llms.txt, llms-full.txt, and a root `skill.md`, serves clean markdown via Accept header, and — critically — **prepends an instruction blockquote to every markdown response telling agents to fetch the full documentation index.** It also offers `<Visibility for="agents">` content that only appears in markdown output (https://www.mintlify.com/blog/context-for-agents, https://www.mintlify.com/docs/ai/markdown-export).

The Mintlify pattern is the key design insight: **the only discovery channel guaranteed to reach the model is the content body itself** — instructions inside the payload the agent already fetched. Headers are stripped by most fetch tools before the model sees them; well-known files require the agent to go looking (they don't).

### NLWeb, agents.json, Schema.org

- **Microsoft NLWeb**: real but early. Adopters include Tripadvisor, Shopify, O'Reilly, Eventbrite, Allrecipes, Hearst; Cloudflare added managed NLWeb deployment via AutoRAG in early 2026. Analyst consensus (VentureBeat): "2–3 years for any substantial adoption"; a 2025 security flaw in the reference implementation dented confidence (https://venturebeat.com/ai/the-battle-to-ai-enable-the-web-nlweb-and-what-enterprises-need-to-know, https://en.wikipedia.org/wiki/NLWeb).
- **agents.json** (Wildcard): community spec on top of OpenAPI describing invocable flows. Referenced by Cloudflare's Agent Readiness Score and Lighthouse Agentic Browsing audits, but **no empirical adoption numbers** — evidence is "what audits measure," not observed agent behavior (https://github.com/wild-card-ai/agents-json).
- **Schema.org/JSON-LD** is the quiet winner precisely because it needs no discovery: it rides inside HTML the agent already fetched. GEO vendors claim 40–60% higher AI citation rates with comprehensive schema (vendor-flavored, treat with salt) (https://llmfy.ai/blog/schema-for-llm-complete-guide). The lesson generalizes: **in-band beats out-of-band**.
- **Agent Skills standard**: Anthropic released Agent Skills (SKILL.md) as an open standard in Dec 2025 at agentskills.io; Microsoft, OpenAI, Cursor, GitHub, Figma adopted it. Cloudflare's Agent Skills Discovery RFC defines `/.well-known/agent-skills/index.json` (https://www.unite.ai/anthropic-opens-agent-skills-standard-continuing-its-pattern-of-building-industry-infrastructure/). Note however: a Claude Code feature request to support `/.well-known/agent-skills` as a remote skill source was **closed as not planned** (https://github.com/anthropics/claude-code/issues/61513) — client-side support hasn't landed yet.

## 2. The Agent Experience (AX) movement

- Matt Biilmann (Netlify) coined "AX" in early 2025; on **April 22, 2026 Netlify launched netlify.ai — a site built purely for agents** (plain-text/markdown onboarding, no human UI) (https://www.netlify.com/blog/netlify-for-agents/).
- Netlify open-sourced **AXIS** (axis.run, github.com/netlify/axis) — "Lighthouse for AX": runs 22 real agents (Claude Code, Codex, Gemini, Cursor-Agent...) against scenarios and scores 0–100 across goal achievement, service quality, environment, agent behavior (https://www.netlify.com/blog/how-we-measure-netlify-agent-experience/).
- **Cloudflare Agent Readiness Score** (blog 2026-04-17, isitagentready.com): 16 checks across Discoverability, Content, Bot Access Control, Capabilities, Commerce — covering robots.txt, sitemap, RFC 8288 Link headers, markdown negotiation, Web Bot Auth, MCP Server Card, API Catalog, agent skills, x402/UCP/ACP. Their measured claim: agents pointed at Cloudflare's optimized docs consumed **31% fewer tokens and reached correct answers 66% faster** than on unoptimized sites (https://blog.cloudflare.com/agent-readiness/).
- **Scrunch AXP**: edge middleware that detects AI visits in real time and serves a parallel token-light site. Validated by exit: **Sitecore acquired Scrunch June 3, 2026 for a reported $225M** (https://scrunch.com/blog/agent-experience-platform/).
- Caveat: nearly all "measured results" in AX are vendor-produced (Cloudflare measuring Cloudflare, Netlify measuring Netlify). Independent evidence of increased agent traffic/conversions from agent-legibility is thin. The strongest independent-ish number: Shopify reporting **more than 1 in 10 orders now starting with an AI assistant**, with Storefront-MCP-enabled stores showing lower drop-off (https://stellagent.ai/insights/mcp-server-ecommerce-shopify-commercetools).

## 3. How agents actually navigate today

- **Chat-assistant browsing** (ChatGPT/Claude/Perplexity search modes): fetch HTML (or markdown when negotiated), read it. They do not spontaneously fetch llms.txt (Ahrefs), do not read response headers into context in most harnesses, and no mainstream agent calls WebMCP tools yet.
- **Agentic browsers**: OpenAI Atlas's CUA layers screenshots + DOM + **accessibility-tree parsing, explicitly prioritizing ARIA roles/labels**; Perplexity Comet uses a Chromium extension with direct DOM access plus accessibility-tree snapshots and selective vision (https://www.humansecurity.com/learn/blog/chatgpt-atlas-vs-perplexity-comet-agentic-browsers/). Research cited in the AX community: Claude achieved 78% task success on accessible sites vs 42% under degraded (keyboard-only) conditions — semantic HTML/ARIA measurably helps (https://nohacks.co/blog/how-ai-agents-see-your-website).
- **Benchmarks**: WebArena/BrowserGym standardize on accessibility-tree observations; Mind2Web/Browser-Use scaffolds parse DOM to element lists. The research consensus is that agents perform better on lower-noise structured representations — which supports the premise that a structured layer helps *if the agent lands on it*.
- **WebMCP** (W3C Web ML CG; navigator.modelContext): Chrome origin trial in Chrome 149–156 (mid/late 2026), Edge behind a flag, Google+Microsoft-edited spec — but "**no mainstream agent calls WebMCP tools yet**" (https://www.spronta.com/blog/state-of-webmcp-july-2026/).
- **Discovery mechanism ranking** (synthesized): (1) **content negotiation on the same URL** — zero discovery cost, already used by Claude Code/Cursor/OpenCode; (2) **inline instructions in the returned content** (Mintlify's index blockquote) — reliably enters model context; (3) `<link rel>` in HTML body — visible to DOM-parsing agents, sometimes surfaced; (4) HTTP Link headers / robots.txt pointers — machine-visible, model-invisible in most stacks; (5) `.well-known` files — correct long-term, ~dead today (llms.txt evidence). A YAML manifest advertised **only** via a response header would be nearly invisible to current agents.

## 4. The identification-signal angle

- **Prior art on positive identification via differential affordances: essentially none.** Honeypots (hidden links/fields) are the classic *negative* detector — "humans can't see this, so whoever touched it is a bot" (https://workos.com/blog/stop-bots-with-honeypots). No established product uses structured-path usage as a *positive* "this is a legitimate task agent" identifier. The closest things: bot-analytics vendors (Fingerprint, HUMAN, cside, Quantum Metric) classifying agents via header combinations and behavior — and notably, `Accept: text/markdown` is already a de facto agent fingerprint, since per Checkly only agent tooling sends it. **The idea is a real gap, not a crowded space.**
- **The declared-identity channel is being standardized instead**: **Web Bot Auth** (HTTP Message Signatures per RFC 9421 + Signature Agent Cards) is now an IETF working group; Cloudflare, AWS WAF, Vercel, Shopify, and Akamai support verification; it is explicitly "the first way to selectively allow agent traffic while blocking scrapers" (https://blog.cloudflare.com/web-bot-auth/, https://blog.cloudflare.com/signed-agents/).
- **Contamination risk is empirically confirmed, not hypothetical.** The llms.txt data is a preview of the fishing net catching the wrong fish: 77% of traffic to llms.txt files is non-AI bots — SEO auditors, profilers, generic crawlers. Structured, predictable, cheap-to-parse endpoints are scraper candy; the whole LLM-scraper tool ecosystem (Firecrawl, ScrapeGraphAI, Bright Data) is built to prefer markdown/JSON outputs (https://www.akamai.com/blog/security/rise-llm-ai-scrapers-bot-management). Raw "fetched the manifest" is therefore a weak signal.
- **What survives contamination is behavioral compliance, not access.** A bulk crawler fetches the index and sweeps everything breadth-first. A task agent reads instructions and follows a protocol. Signal-preserving designs: (a) put a per-session token *in* the manifest with an instruction to echo it in a header on subsequent requests — only a client that read and obeyed natural-language instructions will comply (**an instruction-following handshake is a positive Turing-style test for LLM-driven clients**); (b) rate-limit and pattern-score: targeted search→fetch→stop sessions vs exhaustive traversal; (c) accept Web Bot Auth signatures as the gold tier; (d) x402/pay-per-crawl-style gating exists if a hard economic filter is ever needed (Cloudflare Monetization Gateway waitlist 2026-07-01, min $0.01/retrieval; AI bots blocked-by-default on new zones from 2026-09-15: https://blog.cloudflare.com/monetization-gateway/).

## 5. Cloaking / SEO risk

- Google's spam policy still prohibits cloaking, defined as showing *different content* to crawlers vs users; content served to Googlebot must be "substantially equivalent" to what users see (https://developers.google.com/search/docs/essentials/spam-policies). 2026 enforcement is described as binary — verified cloaking gets a manual action (https://www.conductor.com/academy/aeo-cloaking/).
- **Format transformation of identical content is broadly treated as safe**: Cloudflare shipped Markdown for Agents to millions of zones and, despite "SEOs on alert" coverage (https://searchengineland.com/cloudflare-markdown-for-agents-469246), the consensus is that same-content-different-serialization via Accept header — never triggered by Googlebot, which doesn't send `Accept: text/markdown` — is not cloaking. Mintlify explicitly keeps markdown variants out of search indexes.
- **Scrunch's position**: AXP "is not cloaking" because it targets only LLM retrieval bots, never Googlebot/Bingbot, and optimizes clarity not manipulation — while acknowledging "the line is thinner than it looks" (https://scrunch.com/faqs/). iPullRank has openly argued *for* LLM-cloaking as a tactic (https://ipullrank.com/cloaking-for-llms), which tells you where the gray zone is.
- **For this specific idea the risk is near zero**, because an *additive* machine layer (separate JSON/markdown endpoints, publicly linked, same underlying catalog data) is architecturally identical to sitemaps/RSS/APIs — a pattern Google has always endorsed. Risk only appears if (a) the machine layer contains materially different claims than the HTML, or (b) you sniff Googlebot and vary the HTML itself. Don't do either; add `rel=alternate` links and keep machine endpoints noindexed.

## 6. MCP-as-front-door

- **Adoption is real and accelerating**: official MCP Registry launched Sept 2025; by May 24, 2026 it counted ~9,652 latest server records (https://www.digitalapplied.com/blog/mcp-adoption-statistics-2026-model-context-protocol). Shopify's Storefront MCP went GA early 2026 and is auto-enabled for eligible stores; Stripe runs mcp.stripe.com. Content/commerce sites fronting themselves with MCP is now a normal pattern.
- **Discovery is being standardized**: SEP-1649 (`/.well-known/mcp/server-card.json`) and SEP-1960 (`/.well-known/mcp`) have broad support and early client implementations (https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/1147). Cloudflare's Agent Readiness Score already checks for MCP Server Cards.
- **Identification quality**: strongest of all options. Every MCP connection is by definition an agent; the `initialize` handshake carries `clientInfo` (client name + version), sessions are stateful, and OAuth can bind identity. Zero contamination from SEO crawlers — no SEO tool speaks MCP.
- **The catch is discovery friction**: agents still don't spontaneously discover-and-connect to a site's MCP server mid-task; a human typically installs it (`claude mcp add ...`). For claudeatlas that's mitigated two ways: its audience literally lives in MCP-capable clients, and an inline instruction ("connect to `https://claudeatlas.com/mcp` for structured search") in every markdown response gives the agent the one-liner to propose to its user. Claude Code can execute that addition in-session with user approval.

---

## Honest assessment

### (a) Would agents actually use an offered structured path today, and via which discovery mechanism?

**Yes — but only through three mechanisms, and a header-advertised YAML manifest is not one of them.** The evidence is unambiguous that out-of-band advertisement fails: 97% of llms.txt files get zero requests, agents "never go looking," and response headers rarely reach model context. What demonstrably works in 2026:

1. **Markdown content negotiation on existing URLs** — Claude Code, Cursor, and OpenCode already send `Accept: text/markdown` on every fetch. This requires no discovery whatsoever, and claudeatlas's core audience (Claude Code users) is precisely the population that sends it. This is the free win.
2. **Inline instructions in the returned content** (the Mintlify pattern) — a short machine-directed preamble in every markdown/HTML response pointing at the structured index. This is the only *advertising* channel that reliably enters the model's context, and it bootstraps everything else.
3. **MCP, human-installed once** — high-friction to acquire, but claudeatlas's users are the rare population that installs MCP servers recreationally.

The hierarchical-manifest idea itself is sound (agents do perform better on low-noise structured representations — WebArena/a11y-tree evidence, Cloudflare's 31%-fewer-tokens/66%-faster numbers), but express it as markdown+JSON endpoints discovered in-band, not YAML-over-headers.

### (b) How strong is structured-path usage as an identification signal, and how do you protect it?

**Mere access: weak. Behavioral compliance: strong. MCP: near-perfect.** The llms.txt traffic data proves cheap structured files get majority-contaminated by SEO auditors and bulk crawlers within months. So tier the signal:

- **Tier 0 (weak)**: fetched `/agent/index` or sent `Accept: text/markdown`. Suggestive (per Checkly, only agent tooling sends the markdown Accept header today) but spoofable and scraper-attractive.
- **Tier 1 (moderate-strong)**: *followed the protocol* — read the index, echoed the per-session token the index instructed it to send, made targeted search→fetch→stop requests rather than exhaustive sweeps. Instruction-following is expensive to fake for dumb crawlers and free for LLM clients; this is the "net that catches only the fish you want," and it's genuinely novel — no prior art found on differential affordances as a *positive* identifier (honeypots are all negative detectors).
- **Tier 2 (strong)**: Web Bot Auth signature (IETF WG, already verified by Cloudflare/Vercel/Akamai/AWS) or an MCP session with clientInfo.

Protection: per-IP rate limits on the structured path sized for task traffic not bulk export (a task agent needs 5–50 records, a scraper wants 35k); traversal-shape scoring; publish a bulk-export file separately (**a labeled dataset dump is a honeypot for scrapers** — anything bulk goes there, keeping the interactive path clean); monitor composition monthly against the Ahrefs baseline.

### (c) Concrete v1 for claudeatlas.com

Cheapest-first, all additive, no cloaking exposure (site is already on Cloudflare Workers):

1. **Week 1 — content negotiation + llms.txt.** Pre-render a `.md` sibling for every skill/category page at build time (Astro makes this trivial); route `Accept: text/markdown` to it in the Worker (or simply enable Cloudflare's Markdown for Agents as a stopgap). Generate `/llms.txt` as a compact index. Cost ≈ 0.
2. **Week 1–2 — the structured layer.** `/agent/index.json` (mirror at `/.well-known/agent-skills/index.json` to align with the Cloudflare RFC and the Anthropic Agent Skills standard — claudeatlas's catalog *is* SKILL.md files, so this spec fit is unusually good): hierarchy of index → categories → per-skill JSON records (name, description, score, tier, install command). JSON, not YAML — every agent stack parses JSON natively.
3. **Week 2 — in-band advertising + handshake.** Prepend 2–3 lines to every markdown response and an HTML comment/`<link rel="alternate">` in every page: "Agents: structured catalog at /agent/index.json; include header `X-ClaudeAtlas-Agent: <token>` from the index on subsequent requests." The token is the identification instrument — logged, per-session, rotating. Instrument logs to segment: token-bearing sessions / markdown-Accept sessions / plain crawlers.
4. **Week 3–4 — MCP front door.** Wrap the existing `/api/v1/search` (Vectorize) plus `get_skill` in a remote MCP server on the same Worker; publish `/.well-known/mcp/server-card.json`; list it in the official MCP Registry and Claude directory contexts. Log `clientInfo` per session.
5. **Skip for v1**: WebMCP (no consuming agents yet), NLWeb (2–3 years out), agents.json (no measured consumption), Web Bot Auth *verification* as a requirement (accept it opportunistically, don't require).

**Success metric (60-day gate):** share of non-Googlebot bot sessions that reach Tier 1 (token echoed OR MCP-connected), plus distinct client count from MCP clientInfo and User-Agents on the structured path. Meaningful signal: ≥5% of bot sessions at Tier 1 with ≥10 distinct legitimate clients, and a targeted-vs-sweep ratio above ~2:1. Failure looks exactly like the Ahrefs picture — structured endpoints fetched almost exclusively by SEO auditors and unidentified crawlers; if that's what the logs show at day 60, keep the markdown layer (it's free UX for Claude Code users regardless) and kill the token/manifest ceremony. A secondary metric worth tracking from day 1 because it needs zero adoption: **the percentage of fetches already arriving with `Accept: text/markdown` — that's the organic agent-share baseline, measurable immediately.**

(Key sources cited inline throughout: Ahrefs llms.txt study 2026-06-15 · Checkly content-negotiation Feb 2026 · Cloudflare Agent Readiness 2026-04-17 · Cloudflare Markdown for Agents Feb 2026 · Mintlify context-for-agents · Vercel content negotiation · Netlify for Agents / AXIS · Scrunch AXP + Sitecore acquisition · Google spam policies · State of WebMCP Jul 2026 · MCP .well-known discussions · MCP adoption stats · HUMAN Security Atlas/Comet internals · NLWeb enterprise coverage · Agent Skills standard · honeypot detection prior art · Akamai on LLM scrapers.)

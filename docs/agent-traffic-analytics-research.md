# Agent-Traffic Analytics — Deep Research Synthesis

**Purpose:** The research phase that follows
[agent-traffic-analytics-handoff.md](./agent-traffic-analytics-handoff.md).
Six parallel research agents swept the space on 2026-08-04: demand signals,
competitive landscape, identification standards, detection state of the art,
incentive design for agent self-identification, and the "agent-native
navigation as identifier" idea. Full reports with all sources live in
[docs/agent-analytics-research/](./agent-analytics-research/). This document
is the synthesis: what the evidence says, how it changes the plan, and the
experiment portfolio for the build phase.

**Author:** ClaudeAtlas main session (owner: Dan Walsh). **Date:** 2026-08-04.

---

## TL;DR — the ten findings that matter

1. **The pain is real and viral; the dashboard is not the product.** AI-crawler
   suffering produces 770-point HN threads (Wikimedia +50% bandwidth, SourceHut,
   iFixit); indie "see your AI bot traffic" tools land at 1–5 points. People
   upvote the problem and buy the *outcome* — visibility, monetization,
   relief — not the traffic report. (Report 1)
2. **Raw bot-visibility is being commoditized to free by whoever owns the
   logs.** Cloudflare AI Crawl Control (all plans incl. free), Vercel
   Observability bot breakdowns (all plans), Ahrefs Bot Analytics (free beta).
   A standalone paid "see your bots" SaaS must survive that. (Reports 1–2)
3. **The money is adjacent:** AI-visibility/AEO (Profound: $155M raised, $1B
   valuation; Peec: ~300 customers/month) and bot monetization (TollBit: 730%
   growth, Akamai/Fastly/Imperva integrations). All three AEO leaders
   (Profound, Scrunch, Peec) shipped **log-based agent measurement** in
   2025–26 — but as $250–5,000/mo marketing-suite features requiring
   enterprise CDN log pipelines. The handoff's "nobody does log-based" claim
   is ~9 months stale. (Report 2)
4. **There is exactly one direct incumbent in our wedge:** Known Agents
   (rebranded Dark Visitors, Feb 2026) — dev drop-in, named-agent semantics,
   server-side, free–$29/mo. Its rebrand from "block the bots" to "AI agents
   as a growth channel" is the market telling us which framing sells. It is
   closed SaaS, Node-only SDK, no self-hosting, thin verification. (Report 2)
5. **Identity is moving from inference to declaration.** Web Bot Auth
   (RFC 9421 signatures + `Signature-Agent` header) has a chartered IETF WG;
   OpenAI signs in production; Cloudflare/Akamai/AWS verify; Visa/Mastercard
   adopted it for agent payments; ~19 agentic browsers are in Cloudflare's
   Verified AI Agent program. Anthropic published crawler IP ranges in late
   July 2026. Signature verification is the "name the actor" primitive — and
   it's free to implement (Cloudflare's OSS libs). (Report 3)
6. **~Half of AI traffic already self-identifies passively** — claude-code/*,
   Claude-User, ChatGPT-User, Perplexity-User UAs, `Accept: text/markdown`.
   The other half (agentic browsers, Claude-in-Chrome, computer use, stealth
   Playwright) is Chrome-identical from residential IPs. **The
   identified-vs-unidentified split is itself the headline metric customers
   want.** (Reports 3–5)
7. **Detection research (four 2026 arXiv papers) says:** binary human/bot
   classifiers mislabel LLM agents as human 30–39% of the time — three-class
   (human/agent/crawler) + first-class `unknown` fixes it; server-side-only
   classification reaches ~82–97% F1; the durable behavioral signal is
   automation-API *event-generation structure* (survives even replayed human
   mouse trajectories); and OS-level input injection + extension agents are
   **structurally unknowable** — say so out loud. Observation beats blocking:
   observers escape the evasion arms race, can spend latency, and can relabel
   with hindsight. (Report 4)
8. **Pure opt-in self-ID asked for by sites has a ~0% base rate.** llms.txt:
   97% of files get zero requests, agents "never go looking"; security.txt:
   <0.25% adoption despite an RFC; our agent-ping n=1 was the expected
   outcome, not an anomaly. What works: tooling defaults (schema.org via
   WordPress plugins), platform-conferred benefit (sitemaps→Google), API
   mandates (GitHub's 403-without-UA), and visibility rewards (OpenRouter's
   leaderboard-for-headers). (Report 5)
9. **The fishing-net idea is sound but must be re-plumbed.** Out-of-band
   advertisement (headers, .well-known) fails; **in-band beats out-of-band**
   (Mintlify's inline-instruction pattern). The novel, unclaimed mechanism:
   an **instruction-following handshake** — a per-session token inside the
   structured index that the content asks agents to echo back. Free for LLM
   clients, expensive for dumb crawlers; no prior art exists on differential
   affordances as a *positive* identifier. MCP is the purest signal (every
   MCP client is an agent, with clientInfo). (Report 6)
10. **ClaudeAtlas has one lever nobody else has:** it distributes the code
    agents run. Install snippets, docs, and skills can carry an identification
    convention into thousands of Claude Code sessions — adoption via
    distribution, not persuasion. (Reports 5–6)

---

## 1. Is anyone asking for this? (Demand verdict)

Yes — but parse what they're asking for. Three distinct demand streams:

| Stream | Strength | Who pays | Evidence |
|---|---|---|---|
| "My server is being hammered / it's costing me money" | Viral, sustained | Pays for **blocking/relief** (Anubis, CF) | Wikimedia, SourceHut, iFixit, 770-pt HN thread |
| "Is ChatGPT citing me / sending me customers?" | Strongest commercial pull | Marketing budgets, $99–$10k/mo | Profound $1B, Peec, GA4 AI-channel how-to industry |
| "Show me what machines are doing on my site" | Real but weakly monetizing | Mostly served free by platforms | Indie Show HNs at 1–5 points; CF/Vercel/Ahrefs free tiers |

The strategic read: **the third stream is the wedge, not the business.** It's
the honest, demo-able capability ("GA saw zero of these requests") that earns
attention, but durable demand attaches to what the data enables — AI-search
attribution, agent-readiness insight, compliance auditing ("did GPTBot respect
my robots.txt?"), or monetization. Dark Visitors' rebrand to Known Agents
("understand and optimize for AI agents as a growth channel") is the closest
competitor conceding exactly this.

One additional demand pocket the incumbents ignore: **instrumentation health.**
Our own PostHog EU/US mismatch dropped 100% of events silently for months.
No analytics product leads with "we tell you when your measurement is broken."
Lesson 5 from the handoff survives contact with the market.

## 2. Where's the gap? (Competitive verdict)

Scoring axes: (A) dev-first drop-in · (B) agent-semantic naming
(actor/operator/purpose) · (C) server/edge-side · (D) cheap/free ·
(E) verification-forward (signatures, rDNS, IP ranges) · (F) observation-first
(probabilistic, non-enforcing, honest `unknown`).

- **CDNs** (Cloudflare, Vercel, Fastly, Akamai): B+C strong, locked to their
  platform; deep analytics paywalled; enforcement-shaped.
- **Bot-security vendors** (DataDome, HUMAN, Kasada, Arcjet): enterprise or
  protection-shaped; Arcjet is dev-first but outputs allow/deny, not analytics.
- **AEO suites** (Profound, Scrunch/Sitecore, Peec): B+C via enterprise CDN log
  pipelines at $250–5k/mo for marketing buyers.
- **Known Agents**: occupies A×B×C×D. Gaps vs. it: closed SaaS (privacy/data
  residency — it ships your request events to their cloud), Node-only SDK, no
  Web Bot Auth verification depth, no self-hosting, no E/F posture.
- **OSS**: fragments — isbot (UA lists), Loamly (RFC 9421 + behavioral, 21
  stars), @apideck/agent-analytics (Next.js middleware → PostHog). Each has
  one leg; none has taxonomy + verification + backend.

**The thinly-occupied cell: A×B×C×D×E×F — an open-source, self-hostable,
verification-forward, observation-first agent classifier with an honest
`unknown` bucket, replaying the Plausible-vs-GA playbook against Profound
(and the open-core playbook against Known Agents).** Detection research
(report 4 §6) supplies the technical differentiation: three-class + unknown,
evidence-bearing verdicts, interaction-level (not session-level) labels,
calibrated confidence. Nobody ships that today.

Timing risk stated honestly: Cloudflare gives core visibility away free to
~20% of the web and drives the standards that reduce classification to
signature verification. The durable asset is the **taxonomy, the analytics
layer, and neutrality** (an independent verifier not entangled in Cloudflare's
registry politics — the Perplexity delisting showed why that matters), not
proprietary detection.

## 3. How do we identify agents? (The layered answer)

Merge of reports 3, 4, 6 into one classification architecture:

- **L0 — Cryptographic (confidence 1.0):** verify Web Bot Auth signatures
  (`Signature-Agent` + JWKS at the agent's `.well-known`). OpenAI signs today;
  the tier will grow from ~2% toward 30%+ of traffic. Build first; evangelize.
- **L1 — Declared identity + verification (0.9–0.99):** UA lists (isbot,
  crawler-user-agents, Known Agents catalog) hardened by FCrDNS / published
  IP-range JSONs (OpenAI, Anthropic *(new, July 2026)*, Perplexity, Google
  `user-triggered-agents.json`, Bing, CCBot). Three outputs: verified /
  unverified-claim / **impersonation_suspected** (the Perplexity-shaped
  label nobody surfaces well).
- **L1.5 — Affordance signals (the fishing net; 0.6–0.95):**
  `Accept: text/markdown` (only agent tooling sends it), structured-path
  usage, **instruction-following token handshake** (novel; Tier-1 signal),
  MCP sessions with clientInfo (near-perfect). ClaudeAtlas-specific edge:
  conventions embedded in distributed skills.
- **L2 — Transport coherence (0.7–0.9):** ASN class, JA4 where the platform
  exposes it, header-order/Client-Hints/Sec-Fetch contradictions (Browser Use
  violates Sec-Fetch semantics in 100% of requests). Count contradictions;
  three concurrent ≈ decisive.
- **L3 — Session shape from logs, no JS (0.6–0.85):** path-coverage shape
  (breadth-first sweep vs. goal-shaped funnel), asset-load ratio,
  conditional-GET ratio, inference-latency interval plateaus, favicon
  heuristic, cross-request UA correlation (the Atlas CFNetwork leak class).
  Path-shape is commercially unexploited — defensible.
- **L4 — Optional consent-gated JS beacon (0.9–0.99):** minimal validated
  feature set (`mouse_event_rate`, `teleport_click_ratio`,
  `click_duration_std` + 2). Decaying asset (12–24 month half-life); never
  ship a single behavioral feature alone.
- **Unknowable, permanently:** OS-level input injection (computer use),
  extension agents synthesizing trusted input (Claude in Chrome), agentic
  browsers doing pure DOM work on user machines. **`unknown` is a first-class
  output and the product's integrity.** Never default silent traffic to
  "human" — that's the measured 30–39% failure mode of binary classifiers.

**Residential-IP agents specifically** (Dan's core question): fingerprinting
does not and will not solve this class. The answers are (a) passive leak
harvesting — claude-code/* UAs *do* come from laptops; (b) affordance
self-selection — markdown negotiation, token handshake, MCP; (c) the
declaration trajectory — signatures for enrolled agentic browsers; (d) honest
`unknown` for the rest. This reframes "detect them" into "give them a reason
and a way to be counted" — which is exactly the experiment portfolio below.

## 4. Why agent-ping failed, and what replaces it

The historical pattern (report 5): standards succeed when a dominant platform
confers benefit and tooling emits by default; they die when the powerless side
(sites) asks the powerful side (agents) to volunteer. llms.txt is the
control group: ~10% of sites publish it; 97% of files never get fetched.
agent-ping was llms.txt-advertised opt-in with no carrot — the n=1 result was
the base rate, not bad luck.

What works, ranked by adoption odds (report 5): vendor-tool UA defaults
(already happened, ~50% of AI traffic), gatekeeper-coerced signatures (Web Bot
Auth), payment-linked identity, **API mandates** (GitHub's mandatory UA:
~100% compliance), **visibility rewards** (OpenRouter's
header→leaderboard: proven at niche scale, the only mechanism a small player
runs unilaterally), framework default headers (low-medium; blocked by the
blocking asymmetry), and pure opt-in (~0).

Actions: kill agent-ping; measure the leak; reward identification with the
currencies a directory mints — visibility (leaderboard, per-skill attribution
for authors) and capability (richer JSON, higher rate limits) — and embed the
convention in the skills we distribute.

## 5. The experiment portfolio (the build-phase agenda)

Per Dan's framing: direction falls out of experimentation, not research alone.
Launch several; expect most to fail; each failure is itself publishable data.
All run on ClaudeAtlas's live traffic (~98k req/day). Ordered by
(cost ↑, dependency).

| # | Experiment | What it tests | Success signal | Cost |
|---|---|---|---|---|
| **E1** | **Worker-side request logging + classifier v0** — log path, UA, ASN, country, `Accept`, `Signature-Agent`, Sec-Fetch coherence to D1 (daily-salted ip_hash); classify L1+L2 | The product seed itself; baseline identified-vs-unknown split | Working per-actor daily report; the "what agent traffic really looks like" essay dataset | Small — few hundred lines in `worker/index.js` (handoff §6 already scoped it) |
| **E2** | **Markdown content negotiation** — `.md` siblings at build time, Worker routes `Accept: text/markdown` (Cloudflare Markdown-for-Agents as stopgap) | Whether task agents preferentially consume the cheap path; organic agent-share baseline | % of fetches with markdown Accept header (measurable from day 1, zero adoption needed) | Small |
| **E3** | **Token handshake (the fishing net)** — `/agent/index.json` + in-band instructions in every markdown/HTML response: "echo `X-ClaudeAtlas-Agent: <token>`" | The novel positive-identification mechanism; instruction-following as agent proof | 60-day gate: ≥5% of bot sessions echo the token, ≥10 distinct clients, targeted:sweep >2:1 | Small-medium |
| **E4** | **MCP front door** — wrap `/api/v1/search` + `get_skill` as a remote MCP server on the Worker; `/.well-known/mcp/server-card.json`; registry listing | Purest agent channel; clientInfo = named clients | Distinct clientInfo count; sessions/week; % of search volume via MCP | Medium |
| **E5** | **Web Bot Auth verification** — verify signatures in the Worker (Cloudflare OSS libs); publish "signed agents welcome" | The declaration trajectory; early-mover directory positioning | Any verified `Signature-Agent` traffic (even trace amounts are a story) | Small |
| **E6** | **Attribution-for-visibility (OpenRouter play)** — document `X-Agent-Identity`; reward with public "Agents using ClaudeAtlas" leaderboard + per-skill usage stats for authors; embed header convention in install snippets/docs | Whether visibility rewards bootstrap voluntary ID; the distribution lever | Voluntary header adoption trend; skill authors citing their stats | Medium |
| **E7** | **Retire agent-ping** — formally; document as the control group | — | — | Trivial |

Sequencing: E1 is the foundation and precedes everything (it's also the
measurement substrate for E2–E6). E2+E3+E5 can ship together as one Worker
change-set. E4 and E6 follow once E1 shows the baseline. The
"what agent traffic actually looks like in 2026" essay is the demand test
riding on E1's data — if it travels and readers ask "how do I see this for my
site," that's the adoption signal the handoff said we couldn't get from
dogfooding alone.

Also fix in passing (pre-existing, cheap, needed for clean measurement):
PostHog EU/US region mismatch (still dropping 100% of human events), the D1
search-logging ambiguity, and Google Search Console setup for the human side.

## 6. Positioning recommendation for the spec session

- **Product shape:** open-source, self-hostable, drop-in classifier +
  analytics ("Plausible for agent traffic"), with an optional hosted backend.
  Three-class + `unknown`, evidence-bearing verdicts, interaction-level
  labels, verification-forward (Web Bot Auth first-class). Adopt Cloudflare's
  Search/Agent/Training taxonomy rather than inventing one.
- **Framing:** lead with "know which agents, doing what, and whether they
  can even use your site" (agent-legibility/AX + attribution) — not "bot
  dashboard." The classifier is the engine; the story is the growth channel.
- **Wedge vs. incumbents:** open-core + self-hosting + neutrality vs. Known
  Agents; price + dev distribution vs. Profound/Scrunch/Peec; observation +
  analytics vs. Arcjet/CDN enforcement.
- **Moat honesty:** detection commoditizes; the compounding assets are the
  taxonomy/dataset, the identified-agent conventions we help spread (E3/E6 —
  ClaudeAtlas's distribution is the unique accelerant), and trust
  (calibration, honest `unknown`, privacy-by-architecture: hashed short-TTL
  session keys, no identity joins, GDPR-clean server-log-first design).
- **Riskiest assumptions to keep testing:** (1) genuine agent traffic
  materializes at meaningful volume (our machine-endpoint numbers are still
  tiny; Cloudflare Radar says AI-agent share is real and growing, but our own
  corner must prove it); (2) anyone adopts the handshake/identity conventions
  (E3/E6 are the falsifiers); (3) the analytics-vs-AX-vs-monetization framing
  question — let the essay's reception and E1's data pick.

---

*Full evidence and sources: [01-demand.md](./agent-analytics-research/01-demand.md) ·
[02-competitive.md](./agent-analytics-research/02-competitive.md) ·
[03-identification-standards.md](./agent-analytics-research/03-identification-standards.md) ·
[04-detection-sota.md](./agent-analytics-research/04-detection-sota.md) ·
[05-incentives.md](./agent-analytics-research/05-incentives.md) ·
[06-agent-native-navigation.md](./agent-analytics-research/06-agent-native-navigation.md)*

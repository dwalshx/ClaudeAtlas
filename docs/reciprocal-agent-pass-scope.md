# Reciprocal Pass — Scope (first narrow experiment)

**Status:** SCOPE ONLY — not built. Approved to scope by Dan 2026-09-07.
**One-liner:** A signed, polite "good-agent" makes a single read-only pass over the
operators whose bots scrape ClaudeAtlas, and records **how the web treats a
declared agent** — the reciprocal of our own inbound-traffic findings.

## Why (the vantage this fills)
Everything we've built observes the agent web from one spot: our logs watch
agents *coming to us*; the AEO tool probes what AI chats *say back*. We cannot
see the reciprocal — **how the rest of the web treats an agent** — without
becoming one. This pass flips us from observed to observer. It's the direct
mirror of our signature finding ("what came calling when we left the walls
down") → "and here's what happens when *we're* the one calling."

## Targets (v1 — deliberately tiny and poetic)
The **named operators/vendors whose bots appear in our request_log**, resolved
to a primary domain. ~20–40 domains. The reflexive angle is the hook: *"we
watched your bots crawl us — here's how your site treats ours."*
Seed set (finalize from the live log's top orgs): ahrefs.com, semrush.com,
dataforseo.com, openai.com, anthropic.com, perplexity.ai, google.com,
amazon.com, apple.com, microsoft.com, alibaba.com, tencent.com, huawei.com,
bytedance.com, meta.com, cloudflare.com, + the next tier by volume.
(NOT the anonymous scraper farms — they have no crawlable site. NOT a general
web crawl — that's commodity + expensive; the value is the agent-lens on a
defined set.)

## The agent's behavior — "be Ahrefs" (good-citizen posture is non-negotiable)
- **Honest declared UA:** `ClaudeAtlasBot/1.0 (+https://claudeatlas.com/bot)`.
- **Read-only, meta-only:** GET only; we measure headers/robots/structure, NOT
  harvest content for reuse. No forms, no logins, no auth walls.
- **Respect robots.txt** — fetch and honor it (and record what it says; that's
  data). Rate-limit hard (≤1 req / few seconds per host, low concurrency).
- **Transparency:** ship a public `/bot` page on claudeatlas.com — who the agent
  is, its purpose, how to block it, a contact.
- **v2 adds Web Bot Auth signing** (see Sequencing) — dogfoods E5 from the
  sender side and makes us a *verifiable* agent; v1 runs declared-UA-only.

## Signals recorded per target (the agent-lens payload)
Per domain, a fixed small probe set:
- **Block behavior:** does the homepage return 200 to our declared agent, or
  403 / challenge / CAPTCHA / CF-block? → the **headline block-rate**.
- **robots.txt:** present? names AI bots (GPTBot/ClaudeBot/etc.)? `Sitemap:`?
  Cloudflare Content-Signal / AI rules? disallows our UA or all bots?
- **Markdown negotiation:** send `Accept: text/markdown` → markdown or HTML?
  (AX-readiness — the thing WE ship).
- **Agent-web standards present (200?):** `/llms.txt`, `/llms-full.txt`,
  `/.well-known/agents.json`, `/.well-known/mcp/server-card.json`,
  `/.well-known/http-message-signatures-directory` (do THEY sign?), `/ai.txt`.
- **Response size** (bytes) of the homepage to an agent — bloat proxy.
- **Structured data:** JSON-LD / schema.org present in the HTML?
- **Light cloaking check:** response to our agent UA vs a vanilla-browser UA —
  materially different status/size? (one weak cloaking signal, not proof).
- **Toll:** any HTTP 402 / pay-per-crawl.

## Output
- `data/reciprocal-pass.json` — per-target signals + an aggregate block:
  block-rate, markdown-negotiation rate, standards-adoption counts, cloaking
  incidence, "who signs their own requests," size distribution. Small bounded
  sidecar (allowlist like the others).
- A console/markdown report. This IS the first "how the web treats a declared
  agent" dataset — postable, and the reflexive framing (crawlers vs a crawler)
  is the story.

## Architecture
- **Outbound crawler = NOT the live site worker.** A standalone Node script
  (`scripts/reciprocal-pass.js`), run locally (win32-arm64 is fine for Node;
  no wrangler needed) or via a GitHub Action. Uses global fetch.
- v2 signing: generate an Ed25519 keypair, publish the public JWKS at
  `claudeatlas.com/.well-known/http-message-signatures-directory` (a worker
  route or static file), sign outbound requests per RFC 9421. Private key in a
  GH secret / .env, never committed.
- Data: committed `data/reciprocal-pass.json`. No PII (we're recording *sites'*
  public metadata, not people).

## Honest constraints / risks
- **Politeness is the whole posture** — read-only, meta-only, robots-respecting,
  rate-limited, transparent. It's ethics AND method: when we later publish "who
  blocks a polite declared agent," we must be unimpeachable. (Bonus: we become a
  test subject — we'll see who blocks even a good agent.)
- **Getting blocked is DATA, not failure.** Expect CF-fronted targets to
  challenge; that's a headline number.
- **Signing is a real prerequisite for the differential test** ("do they treat a
  *signed* agent better?") — hence v2, kept out of v1 to stay small.
- **Scope discipline:** fixed target list, fixed probe set, one pass. Not a
  general crawler; resist scope creep into "crawl the web."

## Success criteria
- Produces the per-target + aggregate dataset; we can answer *"of the operators
  that scrape us, what share block / allow / challenge a declared agent, and how
  agent-ready are they?"*
- The build teaches the good-agent stack end-to-end.
- **Decision gate:** interesting distribution → candidate 4th pillar + a post,
  and proceed to v2 (signing + broader content-site sample). Flat/boring → we
  spent ~a day and learned the sender-side stack cheaply. Either outcome is a win.

## Sequencing
- **v1 (this scope):** declared-UA good-agent, the fixed probe set over ~20–40
  named-operator domains, the JSON dataset + report, the `/bot` transparency
  page. Small.
- **v2:** add Web Bot Auth signing (dogfood E5 as sender) + re-run to measure
  the **signed-vs-unsigned differential**; expand targets to a curated
  content-site sample for a real agent-readiness distribution.
- **v3 (maybe):** longitudinal re-runs → "is the web getting more/less
  agent-friendly over time" — the trend nobody publishes.

## Build entry point (when Dan says go)
`/gsd:quick` — single plan, ~3 tasks: (1) the probe module + per-target signal
collectors (pure, testable) + fixtures; (2) the crawler runner (polite,
robots-respecting, rate-limited) + `data/reciprocal-pass.json` writer + lint
allowlist; (3) the `/bot` transparency page + a report. v1 = no signing, no live
worker change beyond the static `/bot` page.

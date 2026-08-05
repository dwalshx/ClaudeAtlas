# Agent-Traffic Analytics — Learnings & Product Handoff

**Purpose:** A self-contained condensation of everything ClaudeAtlas learned about
**human-vs-agent web traffic** — the empirical findings, the instrumentation we
stood up, what worked, what was broken, what we deliberately skipped, and the
lessons — plus a **problem statement and goal** for a potential *agent-traffic
analytics package*. This is **NOT a spec.** It is a briefing so a fresh session
can write the spec without re-deriving the context, while the main ClaudeAtlas
session stays on its own roadmap.

**Author:** ClaudeAtlas main session (owner: Dan Walsh). **Date:** 2026-08-04.

---

## TL;DR

- ClaudeAtlas's real traffic is **~99% machines**, not humans: ~98,000 HTTP
  requests/day, of which only ~5,000 are JS-executing "pageviews." Mobile is
  **0.06%**. Named bots (SEO crawlers, AI-training crawlers, a headless-Chrome
  scraper farm) dominate; genuine human and genuine *agent-API* usage are both
  tiny.
- **The central insight:** standard web analytics (Cloudflare RUM, PostHog, GA)
  are **structurally blind to agent traffic** — they only fire on JS-executing
  human browsers. The growing majority of traffic (crawlers, AI agents,
  scrapers, and all API/JSON/`llms.txt` requests) is **invisible** unless you
  read **server-/edge-side request logs**.
- That blind spot is the product thesis: **teams building for the agent era
  cannot see or classify their agent traffic**, and the tools they already use
  won't show it to them.
- Recommended MVP path (per the "build-cost-has-flipped" reasoning below):
  **build a minimal real tool and dogfood it on ClaudeAtlas first** (zero
  cold-start, real 98k-req/day data, doubles as the demo and as AEO content),
  then open it up.

---

## 1. What we learned about human vs. agent traffic

All figures are from ClaudeAtlas (claudeatlas.com), a static Astro site on
Cloudflare Workers. Two windows: Cloudflare **RUM / Web Analytics** (30 days,
JS-beacon) and Cloudflare **zone-level HTTP analytics** (1 day, all requests).

### 1a. The RUM picture (JS-beacon; 30 days)

- ~**95,500 pageviews**. **Singapore = 86,900 (91%)**, then Vietnam 4,770, Brazil,
  India, US, Philippines… **Korea absent.**
- **Mobile = 60 of 95,470 (0.06%).** Real human populations are ~40–60% mobile;
  this is not humans.
- Referrers: **~99.99% none (direct)**. Only real external referrer:
  **`chatgpt.com` (30)** — i.e., LLMs beginning to cite us.
- The Singapore block is **100% desktop, 100% Chrome** — the signature of a
  **headless-Chrome scraper farm** in a datacenter (executes JS → fires the RUM
  beacon), not human visitors.
- Traffic **kept climbing while the site was frozen** on stale data for a week
  (a July cron outage) — humans notice staleness; crawlers don't. Another
  confirmation the audience is automated.

### 1b. The zone-level HTTP picture (ALL requests; 1 day)

This is ~20× richer than RUM because it counts every request, not just JS loads.

- **~97,900 requests/day.** Status: 200 = 84,853; 404 = 6,502; **204 = 5,201**
  (the `/cdn-cgi/rum` beacon — *this* is why RUM only "sees" ~5k/day). GET 92,602
  / POST 5,294 (POST ≈ the RUM beacon, not API calls).
- **Country flips to US #1 (31,245)** at the request level — the SEO/AI crawlers
  run from US/DE datacenters and **don't fire the JS beacon**, so RUM never saw
  them. SG (17,051) is the JS-executing scraper farm; DE 10,302; VN 3,847;
  FR 3,750; BR 3,398; CN 1,911.
- **User-agents are almost entirely named bots:**
  | User-agent | req/day | kind |
  |---|---|---|
  | DataForSeoBot | 10,048 | SEO data aggregator |
  | SemrushBot | 6,890 | SEO tool |
  | AhrefsBot | 3,649 | SEO backlinks |
  | rotating Chrome/Edge 142–149 (many UA strings) | ~40,000 | scraper farm (UA-cycling) |
  | Amazonbot / Bytespider / meta-externalagent / Applebot | ~3,700 | **AI-training crawlers** |
  | HeadlessChrome/149 | 1,087 | automation |
  | PetalBot / Baiduspider / bingbot | ~1,800 | search engines |
  - Plus a steady drip of **vulnerability scanners** probing `/private/.env`,
    `/google-credentials.json`, `/wp-admin/`, `.php` shells — all correctly
    404ing (no exposure), just internet background noise.
- **Machine-readable / agent endpoints are barely touched** (per day):
  `/api/v1/search` **26**, `/llms.txt` **4**, `/registry.json` **4**,
  `/skills-registry.json` **0**, `/plugins-registry.json` **0**,
  `/api/v1/agent-ping` **0**. → **Agents are not meaningfully consuming the API.**
- The distribution across individual `/skills/…` pages is **even** (nothing
  concentrates) — the shape of a **crawler scraping the whole catalog**, not an
  agent serving user queries (which would hit `/api/v1/search` or a few
  high-value pages).

### 1c. The honest synthesis

ClaudeAtlas's measurable audience today is **crawlers** — SEO tools indexing it,
AI-training bots ingesting it, a scraper farm copying it — **not humans browsing
and not agents querying**. Directionally positive signals: heavy SEO-crawler
coverage implies real Google index presence (check Google Search Console — the
one place a real human/organic signal, incl. the "Singapore/Korea" question,
would surface); and AI-training crawlers ingesting us means our content is
entering the AI knowledge substrate (soft influence, if not traffic).

---

## 2. The core insight (this is the product thesis)

**Standard analytics measure the wrong layer for the agent era.**

- **RUM / PostHog / GA fire a JS beacon in the browser.** They therefore only
  count clients that (a) load HTML and (b) execute JavaScript — i.e., human
  browsers and headless browsers. They are **blind** to: plain HTTP crawlers,
  API/JSON clients, `llms.txt`/registry consumers, and any agent that fetches
  without a full JS runtime.
- The traffic that is **invisible** to those tools is exactly the traffic that
  is **growing** and that teams increasingly need to understand.
- Seeing it requires **server-/edge-side request data** (Cloudflare zone HTTP
  logs, Worker logs, reverse-proxy logs) plus **classification** by user-agent +
  path + behavior. Most teams never look there, and when they do it's raw and
  unclassified.

That gap — *"who is actually hitting me, which are agents vs. scrapers vs.
humans, and what are they doing"* — is the unmet need.

---

## 3. Instrumentation inventory (what exists on ClaudeAtlas today)

| System | What it captures | State / gotchas |
|---|---|---|
| **Cloudflare Web Analytics (RUM)** | JS-beacon pageloads: country, referrer, path, device/browser. 30-day retention. | Works. "Automatic Setup" (edge-injected beacon). **Only sees JS-executers** → misses ~95% of real traffic. Site token in `.env` as `PUBLIC_CF_ANALYTICS_TOKEN` (may be JSON-wrapped). |
| **Cloudflare zone HTTP analytics** (`httpRequestsAdaptiveGroups` GraphQL) | EVERY request: path, user-agent, status, method, country. | The real picture. **Free-plan zone caps the query window to 1 day** (dimensions still available). Needs a **zone-scoped API token** (Zone→Read + Zone→Analytics→Read). Zone id: `a9cbc25a700d1e6e803fae2db854a5c7`. |
| **Cloudflare D1** `claudeatlas-search-log` (binding `DB`, id `d4e341fa-17d6-4069-8a00-3b6a8d698ab9`) | `search_events(timestamp, query, ip_hash, country)` + `agent_pings(timestamp, agent, purpose, user_agent, bot_category, country)`. `ip_hash` = daily-salted SHA-256 (no cross-day tracking). | Schema in `worker/schema.sql`. **Nearly empty** (see §4). Write path is in `worker/index.js`. |
| **PostHog** (EU cloud, `eu.i.posthog.com`) | Client events: `$pageview`, `copy_install_command`, search interactions. | Wired in `src/lib/analytics.js` / `BaseLayout.astro`, gated on `PUBLIC_POSTHOG_KEY`. **Misconfigured** (see §4). |
| **Agent-ping affordance** (`POST /api/v1/agent-ping`) | Opt-in agent self-identification, invited via `/llms.txt`. | Live (returns 405 on GET). Feeds `agent_pings`. Low-volume by design; **essentially unused** so far. |

`.env` keys present (read-credentials): `CF_API_TOKEN` (now zone-scoped),
`CF_ACCOUNT_ID`, `PUBLIC_POSTHOG_KEY`, `PUBLIC_CF_ANALYTICS_TOKEN`,
`POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, `OPENAI_API_KEY`,
`GITHUB_TOKEN`.

---

## 4. What we found empty or broken

- **D1 `search_events`: 3 events total, ever** — `"memory"` (×2) and
  `"hello-from-dan"` (test strings), all US. The search bar is either not wired
  to log real queries, or genuinely almost never used. **Unresolved which.**
- **D1 `agent_pings`: 1 event** — a `claude-code-smoke` "verify endpoint live"
  ping. Zero real agents.
- **PostHog: 0 events.** Root cause: the site **ingests to EU**
  (`eu.i.posthog.com`) but the personal key / project id resolve to the **US**
  region. Events go one place; the queryable project is another. We've had **no
  real human-behavior data the whole time.** (Fix: reconcile region — either an
  EU personal key + EU project, or repoint ingestion.)

---

## 5. Changes we made this session

- **Added Zone→Read + Zone→Analytics→Read** to the Cloudflare API token so the
  zone-level HTTP analytics (the agent-visible layer) became queryable. This is
  what revealed §1b — the finding that reframed the whole project.
- Wrote throwaway pull scripts (D1 REST, PostHog HogQL, CF RUM GraphQL, CF zone
  HTTP GraphQL) to extract the numbers above. **These lived in a scratchpad and
  are ephemeral** — the reusable queries are preserved in the Appendix so they
  aren't lost.
- Diagnosed the **RUM-vs-HTTP gap** (the 5k-vs-98k discrepancy) and the
  **PostHog region mismatch**.

*(Separately, unrelated reliability work on the ClaudeAtlas cron happened this
session — not part of this handoff.)*

---

## 6. What we deliberately did NOT do (open threads for the spec)

- **Did not build Worker-side request logging.** ClaudeAtlas *owns* the Worker
  serving every request (incl. `/api`, `/llms.txt`, registries). A few lines in
  `worker/index.js` logging path + user-agent + country to D1 (mirroring
  `search_events`/`agent_pings`) would give **plan-independent, owned,
  fully-classified agent-usage data** — the cleanest possible signal, and
  arguably the seed of the product itself. **Paused intentionally** to spec the
  product first. This is likely the natural first build.
- **Did not fix the PostHog region mismatch** (events still dropping).
- **Did not determine** whether D1 search-logging is broken vs. search genuinely
  unused.
- **Did not set up Google Search Console** — the missing *human / organic-search*
  signal (where the "Singapore vs. Korea" impressions question, and any real
  human-demand story, would show). Recommended next read for the human side.
- **Did not filter/block the scraper traffic** (e.g., CF Bot Management / WAF).
  Doing so would clean up ClaudeAtlas's own analytics — and is itself a feature
  the product could offer.

---

## 7. Lessons learned (these ARE the product's reason to exist)

1. **Standard web analytics are blind to agent traffic.** JS-beacon tools miss
   the majority of (and the fastest-growing) traffic.
2. **The agent-visible layer is server/edge request logs** — and they're raw,
   unclassified, and rarely looked at. Even *naming* the traffic (which bot /
   agent / tool) requires user-agent analysis most teams skip.
3. **API / `llms.txt` / registry consumption is doubly invisible** — no HTML, no
   beacon, so programmatic agent use leaves no trace in normal analytics.
4. **Classification is non-trivial:** human vs. verified-crawler vs. AI-agent
   vs. scraper vs. SEO-bot requires UA + path + behavior signals, and the UA
   space is messy (scraper farms rotate real-browser UA strings; AI crawlers
   are only sometimes verifiable).
5. **Instrumentation is fragile and fails silently** — the PostHog EU/US mismatch
   dropped 100% of events with no error. A good tool should make its own
   health obvious.
6. **The "audience" of a modern web property is increasingly machines** — and
   teams currently have no easy, out-of-the-box way to see or reason about it.

---

## 8. Problem statement (for the agent-traffic analytics package)

> Teams building websites, docs, and APIs in the agent era **cannot see or
> classify the agent, crawler, and bot traffic hitting them.** The analytics they
> already run (RUM / PostHog / GA and similar) only capture JS-executing human
> browsers, and therefore miss the growing majority of traffic that is
> automated — AI crawlers, agents acting on behalf of users, scrapers, and SEO
> bots. That traffic is invisible, unclassified, and unmeasured, so teams can't
> answer basic, increasingly-important questions: *How much of my traffic is
> agents? Which ones? Are they consuming my API and content, or scraping it? Is
> it valuable agent usage or extractive copying? Is my site even legible to the
> agents I want to reach?*

## 9. Goal / vision for the package

A **tiny, drop-in package** — the "Segment.io for agent traffic" — that:

- **Classifies every incoming request** as human / verified-crawler / AI-agent /
  scraper / SEO-bot / API-client, with the specific actor named where possible
  (GPTBot, ClaudeBot, PerplexityBot, DataForSeoBot, a headless scraper, …).
- **Runs server-/edge-side** so it sees everything RUM/JS analytics can't
  (crawlers, API/JSON, `llms.txt`, non-JS agents).
- **Surfaces clean analytics** on the agent share of traffic, which agents,
  which paths/endpoints they hit, and human-vs-machine trends over time.
- Is **easy to deploy** (drop-in SDK / middleware / edge worker) — the adoption
  ergonomics are the wedge, since "is this a bot?" at the raw infra layer is
  increasingly commoditized; the differentiation is **agent-semantic**
  classification + developer experience + enrichment.

### Recommended build strategy (rationale for the spec session)

- **Build the MVP; skip the fake-door landing page.** The cost of building an
  MVP has flipped: building is now cheap (agent labor), while *attention* is the
  scarce resource. A working tool is a **stronger** demand test than a landing
  page — it measures real *use and retention*, not clicks on a promise, and it's
  easier to extract real data from a tool than from a waitlist.
- **Dogfood on ClaudeAtlas first.** ClaudeAtlas is the ideal first user: we
  already need this (we did §1–§4 by hand), it has **real 98k-req/day traffic**
  for zero cold-start, and instrumenting it produces (a) real product data, (b)
  a "what agent traffic actually looks like in 2026" essay that doubles as
  AEO/marketing content, and (c) a live demo. Only open it up after it's proven
  on our own traffic.
- **Keep the MVP genuinely minimal** — a deployed tool in others' systems is a
  real maintenance/security commitment even when the code is cheap. The riskiest
  assumption is **adoption**, not buildability; design the MVP to test adoption
  and retention, and keep the surface small until signal appears.
- **Know the incumbents.** Cloudflare (verified-bot categories, AI-crawler
  controls, pay-per-crawl), Vercel, and Fastly already classify bots at the
  infra layer. The wedge must be what they *don't* own: agent-*semantic*
  classification ("an agent acting for a user, doing X, via tool Y"), drop-in
  developer ergonomics across stacks, and enrichment (e.g., mapping a
  UA/behavior to a *known* tool/skill — a place ClaudeAtlas's catalog could
  uniquely help).

---

## Appendix — reusable instrumentation-read recipes

The scratchpad pull-scripts were ephemeral; these are the essential queries so
they can be recreated. All use credentials already in `.env`.

**Cloudflare zone HTTP analytics (the agent-visible layer)** — GraphQL to
`https://api.cloudflare.com/client/v4/graphql`, `Authorization: Bearer $CF_API_TOKEN`.
Free-plan zone requires a **≤1-day** `datetime_geq/leq` window. Resolve the zone
id first via `GET /client/v4/zones?name=claudeatlas.com` (needs Zone→Read).

```graphql
query {
  viewer { zones(filter: {zoneTag: "a9cbc25a700d1e6e803fae2db854a5c7"}) {
    httpRequestsAdaptiveGroups(
      filter: { datetime_geq: "<ISO-24h-ago>", datetime_leq: "<ISO-now>" },
      limit: 40, orderBy: [count_DESC]
    ) { count dimensions {
        userAgent            # swap for: clientRequestPath | edgeResponseStatus |
                             # clientRequestHTTPMethodName | clientCountryName
    } }
  } }
}
```
Path filter for machine endpoints: add `clientRequestPath_like: "/api/v1/search%"` etc.

**Cloudflare Web Analytics (RUM)** — same GraphQL endpoint, account-scoped:
```graphql
query { viewer { accounts(filter: {accountTag: "$CF_ACCOUNT_ID"}) {
  rumPageloadEventsAdaptiveGroups(
    filter: { date_geq: "<YYYY-MM-DD>", date_leq: "<YYYY-MM-DD>" },
    limit: 30, orderBy: [count_DESC]
  ) { count sum { visits } dimensions {
      countryName          # or: refererHost | requestPath | deviceType | userAgentBrowser
  } }
} } }
```

**D1 search-log** — REST: `POST /client/v4/accounts/$CF_ACCOUNT_ID/d1/database/d4e341fa-17d6-4069-8a00-3b6a8d698ab9/query`, body `{ "sql": "..." }`, `Authorization: Bearer $CF_API_TOKEN` (needs Account→D1→Read). Never select `ip_hash`.
```sql
SELECT LOWER(query) q, COUNT(*) n FROM search_events GROUP BY 1 ORDER BY 2 DESC LIMIT 40;
SELECT country, COUNT(*) n FROM search_events GROUP BY 1 ORDER BY 2 DESC;
SELECT agent, purpose, bot_category, country, COUNT(*) n FROM agent_pings GROUP BY 1,2,3,4;
```

**PostHog (HogQL)** — `POST https://<region>.posthog.com/api/projects/$POSTHOG_PROJECT_ID/query/`,
`Authorization: Bearer $POSTHOG_PERSONAL_API_KEY`, body
`{ "query": { "kind": "HogQLQuery", "query": "SELECT ..." } }`. **Confirm the
region matches ingestion (EU) — the mismatch in §4 is why this returned 0.**
```sql
SELECT event, count() FROM events GROUP BY event ORDER BY 2 DESC;
SELECT properties.$geoip_country_name, count() FROM events WHERE event='$pageview' GROUP BY 1 ORDER BY 2 DESC;
```

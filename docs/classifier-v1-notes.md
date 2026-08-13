# Classifier v1 — L1 network-aware upgrade (2026-08-12)

**Quick task:** `quick-260812-p3b`. Upgrades `worker/classify.js` from v0 (trusts
surface signals: UA lists + Sec-Fetch coherence) to **L1 network-aware**
classification per `docs/agent-analytics-research/04-detection-sota.md` §7
(L1 + L2). Additive, entirely inside the non-blocking `ctx.waitUntil` logging
path — no response-path work, no new network I/O.

## What production data proved (2026-08-12)

The v0 classifier trusted the User-Agent and never looked at the **network**
(ASN / asOrganization). Two false-positive classes fell out of that blind spot:

### (A) Impersonation — spoofed agent UAs from the wrong network

Credential scanners send a known-agent UA while originating from a network the
claimed operator does not run on, and rotate the impersonated operator daily:

- **92** requests carrying an "OpenAI" agent/crawler UA (ChatGPT-User, GPTBot)
  arriving from **Google Cloud AS396982** and Microsoft space — hitting paths
  like `/web/.env` and `/vendor/aws/credentials`. OpenAI runs on **Azure**, not
  Google Cloud.
- **41** requests carrying a "Mistral" UA (MistralAI-User) from **Cloudflare's
  ASN (AS13335)** — hitting `/service_account.json` and `/wp-json`.

v0 labeled all of these `agent` / `crawler` at confidence 0.9. They are
credential scanners wearing an agent costume.

### (B) False humans — a datacenter headless-browser farm

A headless-Chrome scraper farm sends **coherent** browser headers (valid
Sec-Fetch) from a datacenter, so header coherence alone labeled it `human`:

- **~5.9k / 24h** requests classified `human`, of which **5,008** came from
  **Kingsoft Cloud** and **5,057** from a **Singapore** datacenter range — a
  headless browser farm, not real people.

## What L1 now does

New pure module `worker/asn-class.js` (zero imports, zero I/O, heuristic):

- `classifyAsn(asn, asOrg)` → `hosting | isp_residential | unknown`. Seeded from
  a hosting-ASN set (`HOSTING_ASNS`, superset of classify.js `DATACENTER_ASNS`)
  plus case-insensitive substring keyword lists over asOrganization. Bare
  `GOOGLE` deliberately stays non-hosting (Googlebot's own org) while
  `google cloud` / `gcp` key hosting.
- `matchesOperatorNetwork(operator, asn, asOrg)` → `true | false | null`. Only
  AI operators carry a published-network hint (`OPERATOR_NETWORK_HINTS`); SEO
  and unknown operators return `null` (no opinion → never flagged).

`worker/classify.js` consumes both:

- **Impersonation (L1):** an agent/crawler UA hit runs through
  `checkOperatorNetwork`. A **hosting** ASN whose asOrganization fails the
  claimed operator's network hint (`matchesOperatorNetwork === false`) →
  `class='impersonation_suspected'`, `method='ua_asn_mismatch'`,
  `confidence 0.8`. A matching network, a `null` hint (SEO tools), or a
  non-hosting/residential ASN all fall through to the declared verdict.
- **Datacenter human (L2):** the browser-UA path now downgrades a **coherent**
  browser from a hosting ASN to `class='automated_unknown'`,
  `method='coherent_datacenter'` (renamed from `asn_heuristic`) — catching the
  Kingsoft / Singapore farm. Real residential coherent browsers and plain-GOOGLE
  orgs still classify `human`.
- **WBA override:** when `wbaStatus === 'verified'` (from
  `worker/web-bot-auth.js`, now resolved BEFORE classification in
  `worker/request-log.js`), cryptographic identity dominates — the request is
  **never** flagged impersonation, even from a mismatched hosting ASN.

New analytics column: `request_log.asn_class` (`hosting|isp_residential|unknown`),
added via the established lazy `COLUMN_MIGRATIONS` / `MISSING_COLUMN_RE` path
(no regression to the 2026-08-09 dual-phrasing incident fix). Lets us separate
spoofed agents and datacenter "browsers" from real actors in the analytics.

## Documented follow-up (NOT shipped in v1)

L1 is asOrganization-keyword + ASN-set heuristic only. The stronger signal is
**CIDR IP-range verification** against the operators' published range JSONs:

- `https://openai.com/chatgpt-user.json`
- `https://claude.com/crawling/bots.json`
- `https://www.perplexity.com/perplexity-user.json`
- `https://developers.google.com/search/apis/ipranges/user-triggered-agents.json`

Fetching + caching those CIDR sets and matching the connecting IP would let us
verify the network positively (not just heuristically reject a mismatch). That
is a deliberate future task — see
`docs/agent-analytics-research/03-identification-standards.md` §3 — and is
explicitly out of scope for this v1 to keep the classifier I/O-free inside the
`ctx.waitUntil` path.

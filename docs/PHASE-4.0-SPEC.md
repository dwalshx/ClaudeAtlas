# Phase 4.0 — Data Feeds: APIs and Public Datasets

**Status:** DRAFT (2026-11-01), decisions 1 and 8 resolved 2026-11-02 (embed everything; fork to `feat/v4.0-data-feeds`, APIs first). Not yet registered as a GSD milestone.
**Rough effort:** 4-6 focused sessions across ~8 phases
**Depends on:** v3.0 pipeline (polymorphic envelope, per-type registries, KV/Vectorize search, plugins + MCP live)
**Research input:** `.planning/research/2026-11-01-data-feeds-sources.md` (source inventory, landscape, demand)

---

## Mission statement

> **If ClaudeAtlas is where you find the right tool for an agent, it should also be where you find the right data for it.** Index every public API and public dataset we can discover automatically, record *where it is, what it costs, how fast you can hit it, how you authenticate, and what license it carries*, score each on transparent signals, and link every feed to the skills, plugins, and MCP servers that already consume it.

Decision test: **"Does this help a human or an agent pick a trustworthy data source for a task in under 30 seconds?"**

## What "same coverage as skills" means here

Skills coverage is "everything real on GitHub." Data has no single host, so coverage is defined per type:

| Type | Universe | Coverage target | How |
|---|---|---|---|
| **API** | every API with a public OpenAPI spec or a listing in an open catalog | ~25-45k discoverable; **v1 ≈ 6-7k** from open catalogs, **v2 ≈ 25k+** once GitHub spec discovery lands | APIs.guru + data.gouv.fr + UK catalogue + public-apis mirror (v1); GitHub code search for `openapi.*`/`swagger.*` (v2) |
| **Dataset** | millions (HF 1.1M, data.europa.eu 1.85M, data.gov 535k, Zenodo 764k) | **everything from curated registries** (AWS ODR, OpenML, UCI ≈ 9k) **plus top-N by popularity from bulk portals** (HF, data.gov, Zenodo/Dryad), ≈ **20-30k in v1** | registry pulls + popularity floors; percentile tiers do the curation, exactly as for skills |

The honest framing: for datasets "coverage" is *every dataset anyone actually uses*, not every dataset that exists. Bulk tails beyond the embedded set can be added later as keyword-only KV records if demand shows up.

## Strategic context

Landscape research (2026-11-01) found four things nobody combines: (a) broad automated coverage, (b) structured cost + rate limit + auth fields, (c) a published scoring methodology, (d) cross-links to the tools that consume each source. Only marketplaces that own billing (RapidAPI, ApyHub, Apify, x402 bazaars) have (b). Nobody has (d). Demand signals: Anthropic's Tool Search, Postman and Jentic shipping per-API "agent readiness" grades, Cloudflare's Agent Readiness score, Dataline ($10.6M, 2026-10-31) and AIR ($50M, 2026-09) raising for agent data/tool vetting.

**Our wedge is (d) + (b).** We already parse ~90k skills, ~14k plugins and ~170 MCP servers; the hosts they call are in that text today (`scripts/mine-apis.js` already builds a 69-service graph from a hand dictionary). A real API catalog turns that into "17 skills and 4 MCP servers call api.open-meteo.com," which no directory has. Structured access metadata layers on top with per-field provenance so we never claim precision we don't have.

**Explicitly not competing on:** raw breadth (Postman, Google Dataset Search), payments (x402 players are funded and volatile), commercial data marketplaces (no sanctioned programmatic pricing path).

---

## Entity model

### Two entity types, one nav section

- `entity_type: 'api'` — a callable HTTP service (REST/GraphQL/gRPC-web) with a base URL.
- `entity_type: 'dataset'` — a downloadable or queryable data product (files, tables, bulk endpoints).

Not one `data_feed` type: the `extra` shapes, scorers, sources and page layouts differ as much as skill vs plugin do. They share a nav entry ("Data"), the `access` block below, and the search chip group.

### Envelope change: non-GitHub origins (the real design seam)

`EntityCommon` today requires `repo_full_name`, `repo_stars`, `repo_pushed_at`, etc. Most APIs and datasets are not GitHub repos. Phase 4.1 makes the `repo_*` group **nullable** for `api`/`dataset` and adds:

```typescript
origin: {
  kind: 'github' | 'registry' | 'portal' | 'manual';
  source: string;            // 'apis.guru' | 'data.gouv.fr' | 'huggingface' | 'data.gov' | 'github' | ...
  source_id: string;         // native id in that source
  source_url: string;        // where we read the record
  also_listed_in: string[];  // other sources that carried the same feed (after cross-source merge)
};
home_url: string;            // landing page
docs_url: string | null;
```

ID scheme: `api:<primary-host>/<service>` (e.g. `api:api.stripe.com/stripe`), `dataset:<source>/<native-id>` (e.g. `dataset:huggingface/squad`). Slug keeps the `provider/name` convention so `assignSlugs()` collision logic is reused unchanged.

Skills, plugins and MCPs are untouched: `origin.kind = 'github'` is implied and `repo_*` stays required for them (lint rule).

### Shared `access` block (the product)

Every `api` and `dataset` record carries:

```typescript
access: {
  cost: {
    model: 'free' | 'freemium' | 'paid' | 'pay_per_call' | 'unknown';
    free_tier: string | null;        // "1,000 req/day", "first 10k rows"
    price_notes: string | null;      // short extracted text
  };
  rate_limit: {
    requests: number | null;
    per: 'second' | 'minute' | 'hour' | 'day' | 'month' | null;
    notes: string | null;
    headers_observed: string[];      // e.g. ['RateLimit-Policy', 'X-RateLimit-Limit']
  };
  auth: {
    type: 'none' | 'api_key' | 'bearer' | 'oauth2' | 'http_basic' | 'openid' | 'unknown';
    signup_url: string | null;
  };
  license: { spdx: string | null; name: string | null; url: string | null };
  formats: string[];                  // 'json', 'csv', 'parquet', 'xml', 'graphql', ...
  transport: string | null;           // api: 'rest' | 'graphql' | 'grpc' | 'soap'; dataset: 'download' | 'api' | 'sql' | 's3'
  provenance: Record<string, {        // keyed by field path, e.g. 'cost.model'
    method: 'declared' | 'spec' | 'probed' | 'extracted' | 'manual';
    source_url: string | null;
    confidence: number;               // 0-1
    checked_at: string;               // ISO
  }>;
}
```

Provenance is non-negotiable: the research showed **no open source exposes pricing or rate limits as values** (data.gouv.fr is the lone exception for rate limits). Every number we show carries how we got it. `unknown` is a first-class value, never a blank.

### `ApiExtra` / `DatasetExtra`

```typescript
interface ApiExtra {
  type: 'api';
  base_urls: string[];               // OpenAPI servers[] or catalog base_api_url
  spec_url: string | null;           // OpenAPI/Swagger if known
  spec_version: string | null;       // '3.1.0'
  endpoint_count: number | null;
  categories_src: string[];          // source-native categories (x-apisguru-categories etc.)
  provider: string;                  // 'stripe.com'
  status_page_url: string | null;
  sdks: string[];                    // v2, inferred
  consumed_by: { skills: string[]; plugins: string[]; mcp_servers: string[] };   // ids; Phase 4.6
}

interface DatasetExtra {
  type: 'dataset';
  download_urls: string[];
  size_bytes: number | null;
  size_bucket: string | null;        // HF '1K<n<10K' when bytes unknown
  record_count: number | null;
  update_frequency: string | null;   // DCAT accrualPeriodicity / AWS ODR UpdateFrequency, normalized when possible
  temporal_coverage: string | null;
  publisher: string;
  popularity: { downloads: number | null; views: number | null; likes: number | null; citations: number | null; window: string | null };
  schema_url: string | null;         // croissant / DCAT / openapi.json
  consumed_by: { skills: string[]; plugins: string[]; mcp_servers: string[] };
}
```

---

## Scoring — 7 signals, 0-100, no stars

Skill scoring leans on GitHub stars and pushes. Data feeds get their own transparent composite, published on `/methodology`:

| Signal | Weight | What it measures | Source |
|---|---|---|---|
| **Access clarity** | 20% | auth type known (⅓), cost model known (⅓), rate limit known (⅓); each weighted by provenance confidence | `access.*` |
| **Reachability** | 15% | rolling 30-day success rate of the daily probe on `home_url` + first `base_url`/`download_url`; starts neutral at 0.7 until 7 days of history | Phase 4.4 probe |
| **Documentation** | 15% | docs URL present and reachable; machine-readable spec/schema present (OpenAPI, Croissant, DCAT); description length | spec + probe |
| **License** | 15% | declared (any) → open/permissive → commercial use allowed | `access.license` |
| **Freshness** | 15% | days since spec/dataset `modified`; cliff 180d (api) / 365d (dataset) | source metadata |
| **Popularity** | 15% | source-normalized percentile: HF/Zenodo/Dryad/Socrata downloads, GitHub stars when a repo exists, APIs.guru `x-preferred`, catalog `popularity` | source metadata |
| **Ecosystem adoption** | 5% | count of indexed skills/plugins/MCPs that reference this host | Phase 4.6 cross-link |

Tiers: same percentile rule as every other type (top 10% Featured, next 30% Solid, rest Listed), computed **within** each entity type. Same `assignPercentileTiers()`; a per-type `RENDERABLE_CAP` budget is needed because the static-page ceiling is shared (see Budget).

---

## Pipeline

Mirrors the plugin/MCP path. Each type gets a `filter-<type>.js`, a scorer in `scripts/lib/scorers/`, an embedding-input builder, a rule pack, and a slot in the daily workflow gated by a `DATA_FEEDS_ENABLED` flag.

```
daily-scrape.yml (additions, all gated DATA_FEEDS_ENABLED && event != push)
  ├─ harvest-apis.js        → data/apis-raw.ndjson       (APIs.guru list + specs via ETag; data.gouv.fr; UK CSV; public-apis mirror)
  ├─ harvest-datasets.js    → data/datasets-raw.ndjson   (AWS ODR; OpenML; UCI; HF top-N; data.gov Catalog API with popularity floor; Zenodo/Dryad optional)
  ├─ probe-feeds.js         → data/feed-history/YYYY-MM-DD.json  (HEAD/GET, robots-first, reuses reciprocal-probe politeness; sniffs RateLimit-* headers)
  ├─ filter-apis.js         → data/apis.ndjson           (cross-source merge by host, gates, access block, score, tiers)
  ├─ filter-datasets.js     → data/datasets.ndjson
  ├─ link-consumers.js      → consumed_by[] on feeds + uses_feeds[] back-edge on skills/plugins/MCP (PRESERVED_FIELDS, like bundled_in_plugins)
  ├─ embed (--entity-type api|dataset)  → *-vectors.ndjson
  ├─ enrich (dedup + novelty)           → same contract as plugins
  ├─ upload-vectors (loop gains two files)
  ├─ publish:kv (Listed-tier records)
  └─ build (pages) → deploy → commit data/feed-history/<today>.json
```

Raw files are GHA-cached like `plugins-raw.ndjson`, with a one-time bootstrap release asset. All writes go through `writeNdjsonStreaming`; `check:patterns` applies.

### Embedding input

- api: `name + provider + description + categories + first 10 endpoint summaries` (~300 chars)
- dataset: `name + publisher + description + tags/task_categories + formats` (~300 chars)

### Cross-source merge (APIs)

Key = normalized primary host (`api.stripe.com` → `stripe.com`) + name stem. APIs.guru record wins as canonical (it has the spec); catalog listings fold into `origin.also_listed_in` and contribute their fields (data.gouv.fr rate limits, public-apis auth/CORS flags). Embedding dedup from `enrich.js` runs after, as for skills.

### Access-metadata extraction ladder (Phase 4.7)

1. **spec** — `securitySchemes` → auth; `info.license` → license; media types → formats. Free from OpenAPI. (~2.5k APIs on day one, 20k+ after 4.8)
2. **declared** — catalog fields (data.gouv.fr `rate_limiting`, `access_type`; HF `license`, `gated`; DCAT `accrualPeriodicity`, `license`).
3. **probed** — `RateLimit-Policy` / `X-RateLimit-Limit` / `Retry-After` headers from the daily probe; 401/403 on unauthenticated GET ⇒ auth required.
4. **heuristic** — regex over fetched docs/pricing page text ("free tier", "requests per minute", "$/month"), low confidence (≤0.5).
5. **extracted** — bounded LLM pass (cheapest Claude model) over docs/pricing pages for Featured/Solid APIs only, with a quoted source span and confidence; daily cap. **Needs Dan's cost approval** (see Open decisions).
6. **manual** — corrections file `data/feed-overrides.json`, highest precedence, surfaced as "verified" on the page.

Steps 1-3 are v1. Steps 4-6 are 4.7.

---

## Site surfacing

- `/apis/` — **upgrades the existing page** (today: 69 dictionary services) into the API index; `/apis/<provider>/<name>/` detail pages replace `/apis/[service]`. Old service slugs 301 to the matching API entity.
- `/datasets/` and `/datasets/<source>/<name>/`.
- Nav: "Data" entry (dropdown or two links) alongside Skills | Plugins | MCP.
- Detail page = access card (cost / rate limit / auth / license / formats, each with a provenance chip), reachability sparkline, "Used by N skills · M MCP servers" with links, source badges, spec/docs links, score breakdown.
- Search: `?type=api|dataset` chips on the homepage search bar and `/api/v1/search`; Vectorize `metadata.entity_type` already flows through.
- Skill / plugin / MCP pages gain a "Data sources used" section (back-edge).
- Worker: generalize the `/skills/*` Listed-tier KV render fallback to `/apis/*` and `/datasets/*` (plugins/MCP are static-only today; `run_worker_first` list grows).
- Agent surfaces: `llms.txt` catalog line + field docs; `/registry.json` gains both types; feeds carry `type_chip: 'api' | 'dataset'`; MCP front door gains a `find_data_source` tool (query + optional constraints: free only, no auth, min rate limit, license).
- Methodology page: new "Data feed scoring" section with the table above and the provenance legend.

---

## Phase breakdown

| Phase | What | Effort | Depends on |
|---|---|---|---|
| **4.1** Envelope generalization | nullable `repo_*` for api/dataset, `origin` + `home_url` + `access` types, scorer / embedding-input / rule-pack registry slots, lint rule, `DATA_FEEDS_ENABLED` flag plumbing, fixtures | 1 session | — |
| **4.2** API harvest v1 | `harvest-apis.js` (APIs.guru + data.gouv.fr + UK + public-apis mirror), `filter-apis.js` with cross-source merge, `api.scorer.js`, embed + enrich + upload wired; calibration pass with Dan eyeballing tier distribution | 1-2 sessions | 4.1 |
| **4.3** API pages + search | `/apis/` upgrade, detail pages, nav, search chips, KV fallback route, llms.txt / registry / feeds, methodology section. **Ship APIs visibly here.** | 1 session | 4.2 |
| **4.4** Reachability probe + history | `probe-feeds.js` (politeness from `reciprocal-probe.js`), `data/feed-history/`, header-sniffed rate limits → provenance `probed`, Reachability signal goes live | 0.5 session | 4.2 |
| **4.5** Dataset harvest v1 + pages | `harvest-datasets.js` (AWS ODR, OpenML, UCI, HF top-N, data.gov floor; Zenodo/Dryad if budget allows), `filter-datasets.js`, `dataset.scorer.js`, `/datasets/` pages | 1-2 sessions | 4.1, 4.3 patterns |
| **4.6** Consumer graph | `link-consumers.js`: host extraction from skill bodies / MCP configs / plugin manifests matched to API `base_urls` and dataset `download_urls`; replaces `mine-apis.js` dictionary; `consumed_by` + `uses_feeds` back-edge; Ecosystem-adoption signal live; "Data sources used" on skill pages | 1 session | 4.2, 4.5 |
| **4.7** Access extraction ladder | heuristic pass, bounded LLM pass on Featured/Solid, overrides file, provenance chips polished | 1 session | 4.3, cost approval |
| **4.8** GitHub OpenAPI discovery | code-search partitioned enumeration (10 req/min bucket), noise gates, spec fetch via existing ETag machinery, incremental like Phase 3.4; the lever from ~7k to 25k+ APIs | 1-2 sessions + measurement | 4.2, cron audit |

Recommended order: **4.1 → 4.2 → 4.3** (APIs live on the site within ~3 sessions) → 4.4 → 4.5 → 4.6 → 4.7 → 4.8. 4.4 and 4.5 can run in parallel worktrees once 4.3 lands (seam: nav + methodology page, assign to 4.5).

---

## Budget impact

| Resource | Today | v1 addition (4.1-4.7) | Notes |
|---|---|---|---|
| GitHub REST (5,000/hr) | Track 1 ~500-800/day fresh + plugins refresh | ~0 for v1 (catalogs are not GitHub); 4.8 adds ETag-cached spec fetches | Code search is a **separate 10 req/min bucket** |
| Third-party harvest calls | — | APIs.guru 1 + ≤4k spec GETs (ETag) ; HF ≤1,100 pages ; data.gov ≤540 pages ; Zenodo 30/min | all within published limits, all polite UA |
| Probe traffic | reciprocal pass 157 hosts | ~30-40k HEAD/GET per day at concurrency 6, robots-first | ~30-45 min; declared on `/bot` |
| Cron wall time | ~2.5h steady | +45-75 min (harvest + probe + filter + embed delta) | 330-min ceiling holds on paper; **needs a measured run** like `3.2-CRON-AUDIT.md` |
| Embedding (OpenAI) | — | ~35k records × ~300 chars one-time ≈ cents; deltas thereafter | `EMBED_DRY_RUN=1` for CI |
| **Vectorize stored dims** | ~104k records × 1,536 ≈ 160M dims ≈ **$0.08/month** | +35k records ≈ +54M dims ≈ **+$0.03/month** | Verified 2026-11-02 against developers.cloudflare.com/vectorize/platform/pricing: Workers Paid includes 10M stored dims, then **$0.05 per 100M dims/month**; 50M queried dims/month included, then $0.01 per 1M. CLAUDE.md's "$0.05/M" is 100× too high and should be corrected in 4.1. **Not a governor: embed everything.** |
| KV writes (1M/day paid) | ~21k Listed publish | +~20k Listed records on first publish, deltas after | fine |
| Static pages (18k cap) | skills + plugins consume most of it | needs a per-type renderable budget, e.g. 2,000 api + 3,000 dataset pages; rest via KV render | `RENDERABLE_CAP` becomes per-type |
| LLM extraction (4.7) | — | bounded; Featured/Solid APIs only | **needs explicit approval** per the ~$102/yr constraint |

---

## Open decisions for Dan (discuss-phase gray areas)

1. ~~Catalog size vs embedding cost.~~ **DECIDED 2026-11-02: embed everything.** Verified Vectorize pricing makes the whole v1 catalog (~35k records) ≈ $0.03/month in stored dims; even 4.8's 60k+ is pennies. Semantic `?type=api|dataset` search ships from day one.
2. **LLM extraction budget for pricing/rate limits (4.7).** Yes/no and a monthly cap. Without it, `cost.model` stays `unknown` for most commercial APIs; with it, we become the only neutral directory with structured pricing. Recommendation: yes, Featured/Solid only, hard daily cap, after 4.3 ships.
3. **Dataset popularity floors.** HF: downloads ≥ N in 30 days (N ≈ 1,000 gives roughly 15-20k). data.gov: `popularity` top 5k. Zenodo/Dryad: downloads ≥ 100. These set the v1 dataset count; percentile tiers do the rest.
4. **Commercial APIs with public docs** (Stripe, Twilio, OpenAI) are in via APIs.guru and will score well. Commercial *datasets* (Datarade, Snowflake, AWS Data Exchange) are out: no sanctioned programmatic path. Confirm.
5. **Kaggle.** Only via the Apache-2.0 Meta Kaggle bulk dump, after a ToS read. Include in v1 or defer?
6. **URLs and naming.** Reuse `/apis/` (existing page becomes the index, old service slugs redirect) and add `/datasets/`; nav label "Data". Entity type names `api` and `dataset` (not `data_feed`).
7. **Probe politeness.** Same policy as the reciprocal pass (robots-first, declared UA, 3s/host, GET-only, 512KB body cap); `/bot` page updated to describe the feed probe. Any host that blocks us gets `reachability = null`, not a penalty, for 30 days.
8. ~~Where this sits in the roadmap.~~ **DECIDED 2026-11-02: fork and go APIs-first.** Data Feeds becomes milestone **v4.0** on its own branch/worktree (`feat/v4.0-data-feeds`) so it never contends with the open 3.5-3.9 UI work on main. Order: 4.1 → 4.2 → 4.3 (APIs live), datasets after. 4.3's nav/search-chip touches are kept additive (new entries, no restyle) so 3.5 can land independently either side of it. 3.5-3.9 stay on the roadmap, unchanged.

---

## What "done" looks like for Phase 4.0

- [ ] `api` and `dataset` are first-class entity types in the daily pipeline, gated by `DATA_FEEDS_ENABLED`
- [ ] ≥ 6k APIs and ≥ 20k datasets indexed, scored, tiered, searchable via `/api/v1/search?type=`
- [ ] Every record shows cost / rate limit / auth / license / formats with a provenance chip; `unknown` is explicit
- [ ] Daily reachability history compounding in `data/feed-history/`
- [ ] Every API/dataset page lists the skills, plugins and MCP servers that use it; every skill page lists its data sources
- [ ] `/apis/`, `/datasets/`, detail pages, nav, methodology section, llms.txt, registry, feeds and the MCP `find_data_source` tool live
- [ ] Cron measured under the 330-min ceiling with data feeds enabled
- [ ] GitHub OpenAPI discovery (4.8) measured and either enabled or documented as deferred with the measured gap

---

## Non-goals (v4.0)

- Executing calls or brokering payments (x402 etc.)
- Hosting or mirroring data
- User-submitted listings (overrides file is maintainer-only in v1)
- Commercial data marketplaces
- Scraping RapidAPI, Postman, Kaggle pages, or Google Dataset Search

# Data feeds — source inventory & landscape (researched 2026-11-01)

Input to `docs/PHASE-4.0-SPEC.md`. Three parallel research passes: API sources,
dataset sources, directory landscape. Counts are live as of 2026-11-01 unless noted.

---

## A. API discovery sources

| Source | Count | Access | Structured fields | Reuse terms | Verdict |
|---|---|---|---|---|---|
| **APIs.guru** OpenAPI Directory | 2,529 APIs / 3,992 specs / 677 providers / 108,837 endpoints (skewed: azure 1,829, google 464, aws 286) | `https://api.apis.guru/v2/list.json` (8.8 MB), `/v2/metrics.json`, `/v2/providers.json`, `added.rss`; each entry → `swaggerUrl` | `x-providerName`, `x-serviceName`, `x-apisguru-categories` (93%), `x-origin`, `x-logo`, `x-unofficialSpec`, `x-preferred`; `info.termsOfService` (1,064), `info.license` (886); **auth type from `components.securitySchemes`** (only source where auth is fully structured) | CC0-1.0 directory | **Anchor set** |
| **public-apis** canonical | ~1,400 rows, 51 categories | Markdown table (API/Description/Auth/HTTPS/CORS) | Auth ∈ {No, apiKey, OAuth, X-Mashape-Key, User-Agent}; HTTPS; CORS | MIT | Sporadic maintenance, ~20% dead links; `api.publicapis.org` is dead (NXDOMAIN) |
| **marcelscruz/public-apis** (publicapis.dev) | 1,959 | `db/resources.json` (`API, Description, Auth, Cors, Link, Category`) + `db/categories.json`, raw fetch | coarse auth/CORS | MIT | **Cheap overlay** |
| public-api-lists/public-api-lists | 730+ | `public-api-lists.github.io/public-api-lists/api/all.json` | same columns | MIT | alt overlay |
| **data.gouv.fr dataservices** (api.gouv.fr merged in) | 1,277 | `https://www.data.gouv.fr/api/1/dataservices/` | `access_type`, **`rate_limiting`**, `rate_limiting_url`, `base_api_url`, `machine_documentation_url` (OpenAPI), `technical_documentation_url`, `availability`, `license`, `authorization_request_url`, `metadata_modified_at` | Licence Ouverte 2.0 | **Richest access/rate-limit fields of any source** |
| **UK co-cddo/api-catalogue** | ~1.8k lines | `data/catalogue.csv` (`dateAdded,dateUpdated,url,name,description,documentation,license,maintainer,areaServed,startDate,endDate,provider`) | docs URL, license, maintainer | OGL v3 + MIT | easy add |
| api.data.gov | ~450 APIs / 25 agencies | no machine-readable member list (catalog.data.gov search `format=API` partial) | uniform 1,000 req/hr/key default | public domain | low effort, small |
| EU | no central API catalog (DCAT-AP dataset catalogs only) | — | — | — | skip for APIs |
| **GitHub code search** `openapi.*` / `swagger.*` | `filename:openapi.yaml` 124,928; `openapi.json` 79,616; `swagger.json` 77,056; `swagger.yaml` 89,344; `openapi.yml` 15,584; `apis.json` 25,440. Root-level `path:/ filename:openapi.yaml` 13,776. Realistic distinct non-vendored repos **20–40k** | code search = **10 req/min** bucket (separate from 5,000/hr REST), 1,000 results/query → partition by `size:` bands / `language` / `org:` → ~300–600 queries ≈ 30–60 min/day; content fetch via ETag-cached REST | `securitySchemes` (auth), `servers[]` (base URL), `info.license/termsOfService/contact`, media types | per-repo | **The only path to "thousands"**; needs noise filters (root-level or `size:>5000`, exclude forks/test/vendor, dedupe by `info.title`+`servers[0].url`) |
| apis.json / APIs.io | 156 providers / 462 APIs publishing authoritative apis.json (showcase 2026-10-20). APIs.io claims 36,936 providers / 179,524 APIs / 5,273 MCP but `/developer/` 404s | `api.apievangelist.com/v1/search?q=` (free key, full bodies Pro) | property types `Authentication`, `Pricing`, `TermsOfService`, `SDKs`, `StatusPage`, `OpenAPI` — all **URL pointers, not values** | ToS forbids anything that "substantially replicates APIs.io" | reference only (follow `Pricing`/`Authentication` URLs as extraction targets) |
| Postman Public API Network | no public count since 2021 | undocumented `www.postman.com/_api/*` | — | ToS prohibits automated access | **skip** |
| RapidAPI Hub (Nokia since 2024-11-13) | ~40,000 | JS SPA over GraphQL; no public feed | pricing tiers + quotas shown per listing | scraping violates Terms | **skip** (reference for field design only) |
| apitracker.io (Apideck) | 18,498 API profiles, ~168k MCP listings | `llms.txt` only, no JSON | none numeric; "Source reviewed" dates | unknown | reference |
| apilist.fun / publicapis.io / API Bouncer / free-for.dev | 1.5k / 1.2k / ~147 | HTML / markdown | none | mixed | skip |

**Metadata standards (APIs):** OpenAPI has **no registered** rate-limit or pricing extension (vendor one-offs only). IETF `draft-ietf-httpapi-ratelimit-headers-11` (May 2026) still WG; defines `RateLimit-Policy` / `RateLimit` response headers → **probeable at runtime**. schema.org `WebAPI` pending-tier: only `documentation`, inherited `termsOfService`/`offers`. RFC 9727 `api-catalog` well-known URI (June 2025): adoption early.

**Fields no API source exposes structurally** → heuristics / LLM extraction / probe: pricing model & price points (only RapidAPI's walled garden), rate limits (only data.gouv.fr natively + api.data.gov blanket default; else docs extraction or `RateLimit-*`/`X-RateLimit-*` header sniffing), SDK list (infer from org repos / npm / PyPI), update frequency (spec `x-origin` re-fetch diffs), status (HEAD probe on `servers[0].url` + status-page URL). Auth type and formats are machine-readable wherever an OpenAPI spec exists; license/ToS ~40% populated in specs.

---

## B. Dataset discovery sources

| Source | Count | Access | Structured fields | Limits / terms | Verdict |
|---|---|---|---|---|---|
| **Hugging Face datasets** | 1,112,084 | `GET /api/datasets?limit=1000&full=true` (cursor via `Link`); per-dataset `/api/datasets/{id}/croissant` (Croissant JSON-LD; 400 on gated) | `downloads, likes, trendingScore, lastModified, createdAt, gated, tags, cardData{license, size_categories, task_categories, language}`; exact bytes/formats only via croissant | 500 req/5 min anon, 1,000 auth (`RateLimit-Policy` header); ToS has no anti-crawl clause; ~30–40% of cards declare a license | **"The skills of data"**; tier by downloads; cap by popularity floor |
| **data.gov** | 535,272 (345,858 federal / 159,516 state / 19,588 county / 10,315 city) | **CKAN `api/3` is gone (404)**; new Catalog API `https://catalog.data.gov/search?q=&per_page=1000&after=<cursor>` (`/openapi.json`, `/api/dataset/{slug}`, `/api/organizations`, `/api/publishers`, `/api/keywords`) | DCAT-US 3: `dcat.license`, `accrualPeriodicity`, `modified`, `temporal`, `distribution[].mediaType/format/downloadURL/accessURL`, plus `has_download`, `popularity`, `last_harvested_date` | no key, no published limit; public domain | ≈540 calls for full catalog; use `popularity` floor |
| data.gov.uk | 59,841 | `ckan.publishing.service.gov.uk/api/action/package_search` (classic CKAN) | CKAN standard | OGL | easy |
| open.canada.ca | 48,203 | `/data/api/action/package_search` | CKAN | OGL-Canada | easy |
| **data.europa.eu** | 1,850,034 | `https://data.europa.eu/api/hub/search/search?filter=dataset&limit=…`; SPARQL | DCAT-AP: `accrual_periodicity`, `modified`, `issued`, `distributions[].format/byte_size/license` | metadata CC0 | already harvests EU national portals → dedup on `landing_page`; cap top-N |
| **AWS Open Data Registry** | 1,245 YAML | `awslabs/open-data-registry/datasets/` (git tree / clone) | `Name, Description, License, UpdateFrequency, Tags, Resources[{ARN/URL,Type,Region}], Citation, Contact, DeprecatedNotice` | Apache-2.0 | **best UpdateFrequency anywhere** (free text) |
| Google Cloud public datasets | ~200–300 | requires GCP project (Analytics Hub `listings.list`) | — | — | skip v1 |
| Azure Open Datasets | being retired | — | — | — | skip |
| Snowflake Marketplace | ~3,400 listings / 820 providers | only `SHOW AVAILABLE LISTINGS` inside an account | free/paid flag exists | no public API | skip |
| Kaggle | 400–500k | `kaggle datasets list` (key, 20/page) or **Meta Kaggle** bulk `Datasets.csv` (TotalViews/Downloads/Votes/LicenseName, daily, **Apache 2.0**) | size, downloads, votes, usability, license | site scraping historically forbidden; API / Meta Kaggle sanctioned | Meta Kaggle only, after ToS review |
| **Zenodo** | 763,884 dataset-type | `/api/records?type=dataset` (25/page anon, 100 auth, **30 req/min**, 10k deep-page window); OAI-PMH for bulk | `metadata.license.id`, `files[].size`, `stats.downloads/views`, `updated` | metadata CC0 | academic coverage |
| **Dryad** | 72,994 | `/api/v2/datasets` (100/page, no key) | `license`, `storageSize`, `metrics.views/downloads/citations`, `lastModificationDate` | CC0 | cleanest repository schema |
| Harvard Dataverse | 307,282 | `/api/search?type=dataset` | list: `fileCount`, dates; license/size per-dataset | — | phase 2 |
| Figshare | ~1.3M dataset DOIs (via DataCite `client-id=figshare.ars`) | `/v2/articles?item_type=3` lacks total/license/size → OAI-PMH / DataCite | — | — | via DataCite |
| DataCite umbrella | 78.25M dataset DOIs | `api.datacite.org/dois?resource-type-id=dataset` | `rightsList, sizes, formats, dates, citationCount` | — | overlaps all repositories; phase 2 |
| **Socrata Discovery** | 100k+ assets | `api.us.socrata.com/api/catalog/v1?only=datasets`; **`resultSetSize` capped at 10,000**, offset+limit ≤10k → per-domain or `scroll_id` | `resource.download_count`, `page_views`, `columns_*`, `metadata.license`, `domain_metadata` (Update-Frequency), `permalink` | optional app token (~1k/hr) | **richest popularity signals**; phase 2 |
| OpenDataSoft | 102,985 | `/api/explore/v2.1/catalog/datasets` (`include_app_metas=true` → `api_call_count`) | `metas.default.license`, `records_count`, `modified`, DCAT | — | phase 2 |
| **OpenML** | 7,030 active | `/api/v1/json/data/list/status/active` (one call) | per-dataset `licence`, `format`, `upload_date`, qualities | — | tiny, curated |
| **UCI** | 691 | `archive.ics.uci.edu/api/datasets/list`, `/api/dataset?id=` | instances/features/DOI; CC BY 4.0 site-wide | — | tiny, curated |
| Papers with Code | shut down July 2025 | static dump (`paperswithcode/paperswithcode-data`, HF mirrors) | — | — | skip |
| awesome-public-datasets | 2,245 unique URLs | markdown | none | — | seed list only |
| datahub.io | few hundred | no public API | — | — | skip |
| dataportals.org | 702 portals | CSV/JSON export | portal URLs | — | **CKAN/Socrata seed list** |
| Google Dataset Search | ~30M schema.org pages | **no API, never had one** | — | scraping disallowed | skip |
| Datarade / AWS Data Exchange | ~4k products / 3,500+ | no public pricing API (Marketplace Catalog API returns only your own offers) | — | — | skip; no sanctioned cost path |

**Standards (datasets):** schema.org `Dataset` → `license`, `isAccessibleForFree`, `temporalCoverage`, `dateModified`, `distribution→DataDownload{contentUrl, encodingFormat, contentSize}` (no frequency/price). DCAT adds `dct:accrualPeriodicity`, `dcat:byteSize`, `dcat:mediaType`, `accessURL/downloadURL`, `accessService`. Croissant 1.0 requires `license, datePublished, distribution(FileObject: contentUrl, contentSize, encodingFormat, sha256)`, recommends `dateModified, version`, adds `isLiveDataset, citeAs`.

**Reliably structured:** landing/download URL, license (government + repositories; ~60% HF), size (Zenodo/Dryad/DCAT; HF bucket only), format, modified date, downloads/views (HF, Socrata, Zenodo, Dryad, Kaggle). **Needs heuristics/LLM/curation:** update frequency outside DCAT/ODR, access-method class (API vs bulk vs SQL), auth-required, temporal coverage, and **all cost data** (only commercial marketplaces have it; none programmatic).

**ToS red flags:** Kaggle site scraping (use API/Meta Kaggle), Google Dataset Search, Snowflake/Datarade/AWS Data Exchange pricing. Everything else above is permissive/CC0/public-domain for a derived metadata index.

---

## C. Directory landscape & demand

| Directory | Type | Scale | Structured cost? | Structured rate limit? | Quality score? | Agent-readable? |
|---|---|---|---|---|---|---|
| RapidAPI Hub | commercial marketplace | ~40k | yes (per-plan quotas, 4 tiers) | yes (per-plan) | no (popularity/latency) | no |
| APIs.guru | open spec registry | 2.5k | no | no | no | yes (JSON) |
| public-apis / publicapis.dev | curated free lists | 0.5–2k | free-only flag | no | no | markdown; MCP wrappers exist (ls-apis, public-apis-mcp) |
| apitracker.io (Apideck) | API + MCP directory | 18.5k APIs / 168k MCP | no | no | no numeric; "source reviewed" dates | `llms.txt`, "Agent view" |
| Postman Public Network + AI-Ready APIs | collections + readiness leaderboard | "100k+" (dated) | no | scored as *signal present*, not value | yes, 5-category 0–100 (auth declared 25 pts, llms.txt, AGENTS.md, RFC 9457) | partial |
| ApyHub | unified-subscription catalog | 1.5k endpoints | yes ("atoms") | yes | no | no |
| Jentic | agent-facing directory + execution | "10,000+" | no | prose only | "AI Readiness" 0–100 (opaque) | yes (intent search → operation + schema) |
| Coinbase x402 Bazaar / Agentic.Market / Binance B402 | pay-per-call registry | listings unpublished (~20k claimed) | yes (`maxAmountRequired` per call) | no | usage-based (30d calls, payers, fail-rate) | pure JSON |
| Apify Store | actor marketplace | 21–30k | yes (per-event/result) | CU-based | stars, runs, success rate | Apify MCP |
| Composio / Toolhouse | SaaS tool catalogs | ~1k toolkits | platform-level | platform-level | no | SDK/MCP, closed |
| Official MCP Registry | server registry | 30–52k | no | no | no | `/v0/servers` |
| Google Dataset Search / HF / Kaggle / data.gov / Datarade | dataset catalogs | 31M / 1.1M / ~450k / 535k / 4k | Datarade: vendor text | none | Kaggle usability 0–10; HF downloads/likes/trending; GDS citation counts | HF API only |

**Demand evidence:** Anthropic Tool Search Tool + Claude Code on-by-default MCP tool search (retrieval finds *a* tool, not whether it is cheap/allowed/alive — the metadata gap). RFC 9727 api-catalog (2025-06), Agent Skills standard (2025-12), Cloudflare Agent Readiness score (2026-04/05). Postman and Jentic now publish per-API agent-readiness grades. Funding: Dataline $10.6M (2026-10-31, pay-per-call data feeds for agents with freshness/reliability confidence score), AIR $50M (2026-09, vetting marketplace for agent add-ons), xpay agent-ready index, Massive, GoldRush x402. Counter-signal: x402 daily txns fell ~92% from Dec 2025 peak (OKX research). Grassroots: AgentStack (800 APIs, free-tier flag, `/api/recommend`), agentic-ai-apis (2.9k), MCP-Zero / MCP-Flow papers.

**Gap analysis:** nobody combines (a) broad automated coverage, (b) structured cost + rate limit + auth, (c) transparent published scoring methodology, (d) cross-links to the tools that consume each source. Only billing-owning marketplaces have (b); no neutral directory extracts it from docs. (d) is absent everywhere. **Most defensible for ClaudeAtlas: (d) + (b)** — the usage graph ("17 skills and 4 MCP servers call api.open-meteo.com") derives from data already in the pipeline at zero marginal API cost; layer (b) via spec parsing + header probing + bounded extraction with per-field provenance; score with the existing methodology style; expose via llms.txt / search API / MCP. Do not compete on raw breadth (Postman/GDS) or payments (x402 players are funded and volatile).

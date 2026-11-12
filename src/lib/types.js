// AUTO-GEN: keep src/lib/types.js in sync with src/lib/types.d.ts
// Source-of-truth: src/lib/types.d.ts. This file is the JSDoc mirror that
// powers VS Code and Astro's TS-language-server inference at JS call sites.
//
// Phase 3.1.2 — Polymorphic Entity Envelope (F2)

/**
 * @typedef {'skill' | 'plugin' | 'mcp_server' | 'command_lib' | 'agent_lib' | 'hook_lib' | 'api' | 'dataset'} EntityType
 *
 * Phase 4.1 (v4.0 Data Feeds): 'api' + 'dataset' are non-GitHub origins; see
 * docs/PHASE-4.0-SPEC.md.
 *
 * NOTE: 'framework' is intentionally NOT an entity_type (Q3 decision: frameworks
 * are tag-based, e.g. `framework:gsd` attachable to any entity).
 */

/**
 * @typedef {'featured' | 'solid' | 'listed'} QualityTier
 *
 * Tier rename to 'top' / 'solid' / 'indexed' is Phase 3.6 — not in F2.
 */

/**
 * Phase 4.1 / D-02 — where a record was read from. Present on EVERY record.
 * For skill/plugin/mcp_server the upcaster fills the github form
 * ({ kind:'github', source:'github', source_id: repo_full_name, source_url: repo_url, also_listed_in: [] }).
 * NOTE: `origin.source` is the provenance CATALOG name ('apis.guru', 'huggingface', 'github'…);
 * `EntityCommon.source` is the discovery CHANNEL enum — keep the two distinct.
 *
 * @typedef {Object} Origin
 * @property {'github' | 'registry' | 'portal' | 'manual'} kind
 * @property {string} source          Catalog name: 'github' | 'apis.guru' | 'huggingface' | 'data.gov' | ...
 * @property {string} source_id       Native id in that source (repo_full_name for github).
 * @property {string} source_url      Where the record was read (repo_url for github).
 * @property {string[]} also_listed_in  Other sources carrying the same feed (after cross-source merge).
 */

/**
 * Phase 4.1 / D-03 — how a single `access.*` value was obtained.
 *
 * @typedef {'declared' | 'spec' | 'probed' | 'heuristic' | 'extracted' | 'manual'} ProvenanceMethod
 */

/**
 * @typedef {Object} AccessProvenance
 * @property {ProvenanceMethod} method
 * @property {string | null} source_url
 * @property {number} confidence      0-1
 * @property {string} checked_at      ISO 8601 ('' when the source carried no timestamp)
 */

/**
 * Phase 4.1 / D-03 — shared access block. Top-level on `api` and `dataset`
 * records ONLY (never on EntityCommon, never under `extra`). `unknown` is a
 * first-class value: the upcaster defaults every enum to 'unknown', numbers
 * to null, arrays to [], provenance to {}. Helpers: scripts/lib/access.js.
 *
 * @typedef {Object} AccessBlock
 * @property {{ model: 'free' | 'freemium' | 'paid' | 'pay_per_call' | 'unknown', free_tier: string | null, price_notes: string | null }} cost
 * @property {{ requests: number | null, per: 'second' | 'minute' | 'hour' | 'day' | 'month' | null, notes: string | null, headers_observed: string[] }} rate_limit
 * @property {{ type: 'none' | 'api_key' | 'bearer' | 'oauth2' | 'http_basic' | 'openid' | 'unknown', signup_url: string | null, schemes: string[] }} auth  schemes: Phase 4.2 decision 5 — all declared schemes mapped, declaration order.
 * @property {{ spdx: string | null, name: string | null, url: string | null }} license
 * @property {string[]} formats         'json', 'csv', 'parquet', 'xml', 'graphql', ...
 * @property {string | null} transport  api: 'rest' | 'graphql' | 'grpc' | 'soap'; dataset: 'download' | 'api' | 'sql' | 's3'
 * @property {Record<string, AccessProvenance>} provenance  Keyed by field path, e.g. 'cost.model'.
 */

/**
 * Phase 4.1 / D-04 — ids of indexed entities that consume a feed. Populated by
 * Phase 4.6 link-consumers.js; [] until then.
 *
 * @typedef {Object} ConsumedBy
 * @property {string[]} skills
 * @property {string[]} plugins
 * @property {string[]} mcp_servers
 */

/**
 * @typedef {Object} EntityCommon
 *
 * @property {string} id    `${entity_type}:${repo_full_name}/${path_within_repo}`
 * @property {string} slug  URL-safe slug, scoped per type.
 * @property {EntityType} entity_type
 * @property {string} name
 * @property {string} description
 *
 * @property {Origin} origin          Phase 4.1 / D-02 — present on EVERY record (github form for skill/plugin/mcp_server).
 * @property {string} home_url        Landing page. Equals repo_url for github-origin records.
 * @property {string | null} docs_url
 *
 * Repo metadata — Phase 4.1 / D-02: null only for api/dataset without a known repo
 * (non-null for every origin.kind === 'github' record; the upcaster never emits null for them).
 * @property {string | null} repo_full_name
 * @property {string | null} repo_url
 * @property {number | null} repo_stars
 * @property {number | null} repo_forks
 * @property {number | null} repo_open_issues
 * @property {string[] | null} repo_topics
 * @property {string | null} repo_license
 * @property {string | null} repo_language
 * @property {string | null} repo_created_at   ISO 8601
 * @property {string | null} repo_updated_at
 * @property {string | null} repo_pushed_at
 * @property {'Organization' | 'User' | null} repo_owner_type
 * @property {string | null} repo_owner_avatar
 * @property {boolean | null} repo_archived
 * @property {boolean | null} repo_is_fork
 * @property {string | null} repo_description
 *
 * @property {number} body_length
 *   Original body length BEFORE any filter-stage truncation. (F2)
 *   `extra.body_markdown` may be 1500-char trimmed; `body_length` captures the
 *   pre-trim length. INVARIANT: filter MUST NOT mutate body_length when it
 *   trims extra.body_markdown.
 *
 * @property {number} quality_score   0-100, computed by per-type scorer.
 * @property {QualityTier} quality_tier
 * @property {number} novelty_score   0-1; populated by enrich.js (F3); 0 in F2.
 * @property {boolean} is_duplicate   populated by enrich.js; false in F2.
 * @property {string | null} canonical_id   points to canonical EntityRecord.id; null in F2.
 *
 * @property {string[]} tags    PRIMARY classifier; conventions in scripts/lib/tags.js.
 * @property {string | null} category
 *   LEGACY display field; mechanically equals
 *   tags.find(t => t.startsWith('category:')).split(':')[1]. Removed in 3.6.
 *
 * @property {string} scraped_at
 * @property {string} content_sha
 * @property {'code-search' | 'topics' | 'seed' | 'discover' | 'registry' | 'manual'} source
 *   Discovery CHANNEL (not the catalog — see Origin.source). api/dataset use 'registry'.
 * @property {string[]} discovery_signals
 * @property {2} schema_version   Bumped from implicit 1 in F2.
 *
 * @property {string[]} bundled_in_plugins
 *   Phase 3.2 / D-02. IDs of plugin EntityRecords that bundle this entity
 *   (back edge of the bundle graph; forward edge is PluginExtra.bundled_*).
 *   Populated by scripts/link-bundles.js; `[]` for non-bundled entities.
 */

/**
 * @typedef {Object} SkillExtra
 * @property {'skill'} type
 * @property {string} skill_path
 * @property {string} body_markdown   First 1500 chars (filter) or 5000 chars (raw).
 * @property {Record<string, any>} frontmatter
 * @property {boolean} has_name
 * @property {boolean} has_description
 * @property {string | null} skill_first_commit_at
 */

/**
 * @typedef {Object} PluginExtra
 * @property {'plugin'} type
 * @property {string} plugin_path
 * @property {Record<string, any>} manifest
 * @property {string} readme_markdown
 * @property {string[]} commands
 * @property {string[]} hooks
 * @property {Array<{path: string, name: string|null}>} marketplace_listings   Phase 3.3 / D-08 — {path (owner/repo for `/plugin marketplace add`), name (declared marketplace name for `@name`)}. Pre-3.3 records stored bare path strings; loader normalizes both.
 * @property {string[]} bundled_skills         Phase 3.2 / D-02 — skill EntityRecord IDs this plugin bundles (forward edge).
 * @property {string[]} bundled_agents         Phase 3.2 — agent component IDs/names bundled.
 * @property {string[]} bundled_commands       Phase 3.2 — command component IDs/names bundled.
 * @property {string[]} bundled_hooks          Phase 3.2 — hook component IDs/names bundled.
 * @property {string[]} bundled_mcp_servers    Phase 3.2 / D-02 — mcp_server EntityRecord IDs this plugin bundles.
 * @property {number} manifest_completeness    Phase 3.2 / D-03 — 0-1 manifest-field coverage; feeds Manifest-Completeness signal.
 */

/**
 * @typedef {Object} McpExtra
 * @property {'mcp_server'} type
 * @property {string} server_path
 * @property {Record<string, any>} manifest
 * @property {string} readme_markdown
 * @property {string[]} tools
 * @property {'stdio' | 'sse' | 'streamable-http' | null} transport
 * @property {number} manifest_completeness    Phase 3.2 / D-03 — 0-1 manifest-field coverage; feeds Manifest-Completeness signal.
 */

/**
 * Phase 4.1 (scaffold; harvester lands 4.2). Field semantics in
 * docs/PHASE-4.0-SPEC.md § ApiExtra.
 *
 * @typedef {Object} ApiExtra
 * @property {'api'} type
 * @property {string[]} base_urls              OpenAPI servers[] or catalog base_api_url.
 * @property {string | null} spec_url
 * @property {string | null} spec_version
 * @property {number | null} endpoint_count
 * @property {string[]} categories_src         Source-native categories (x-apisguru-categories etc.).
 * @property {string} provider                 'stripe.com' — also the slug owner segment (D-05).
 * @property {string | null} status_page_url
 * @property {string[]} sdks
 * @property {string | null} source_modified_at  Phase 4.1 addition: source `modified` timestamp (APIs.guru versions[v].updated, data.gouv.fr metadata_modified_at). Freshness reads it; null → NEUTRAL 50 for api (4.2 decision 8).
 * @property {string[]} endpoint_summaries  Phase 4.2: first ≤10 "METHOD /path summary" strings (≤80 chars) from the parsed spec; [] when none.
 * @property {boolean} spec_parsed  Phase 4.2 (D-02): spec fetched + extracted; false when skipped (cap/HTTP/invalid/catalog-only/no spec_url).
 * @property {number} access_clarity           0-1, written by api.scorer.js (same side-effect convention as manifest_completeness). 0 until scored.
 * @property {ConsumedBy} consumed_by
 */

/**
 * Phase 4.1 (scaffold; harvester lands 4.5). Field semantics in
 * docs/PHASE-4.0-SPEC.md § DatasetExtra.
 *
 * @typedef {Object} DatasetExtra
 * @property {'dataset'} type
 * @property {string[]} download_urls
 * @property {number | null} size_bytes
 * @property {string | null} size_bucket       HF '1K<n<10K' when bytes unknown.
 * @property {number | null} record_count
 * @property {string | null} update_frequency  DCAT accrualPeriodicity / AWS ODR UpdateFrequency, normalized when possible.
 * @property {string | null} temporal_coverage
 * @property {string} publisher                Also the slug owner segment (D-05).
 * @property {{ downloads: number | null, views: number | null, likes: number | null, citations: number | null, window: string | null }} popularity
 * @property {string | null} schema_url        croissant / DCAT / openapi.json.
 * @property {string | null} source_modified_at  Phase 4.1 addition: HF lastModified, DCAT modified, Zenodo modified. Freshness (365-day cliff) reads it; null → 0.
 * @property {number} access_clarity           0-1, written by dataset.scorer.js. 0 until scored.
 * @property {ConsumedBy} consumed_by
 */

/**
 * @typedef {Object} CommandLibExtra
 * @property {'command_lib'} type
 * @property {string} lib_path
 * @property {string} readme_markdown
 * @property {string[]} commands
 */

/**
 * @typedef {Object} AgentLibExtra
 * @property {'agent_lib'} type
 * @property {string} lib_path
 * @property {string} readme_markdown
 * @property {string[]} agents
 */

/**
 * @typedef {Object} HookLibExtra
 * @property {'hook_lib'} type
 * @property {string} lib_path
 * @property {string} readme_markdown
 * @property {string[]} hooks
 */

/**
 * Discriminated union over `entity_type`.
 *
 * @typedef {(EntityCommon & { entity_type: 'skill';       extra: SkillExtra })
 *         | (EntityCommon & { entity_type: 'plugin';      extra: PluginExtra })
 *         | (EntityCommon & { entity_type: 'mcp_server';  extra: McpExtra })
 *         | (EntityCommon & { entity_type: 'command_lib'; extra: CommandLibExtra })
 *         | (EntityCommon & { entity_type: 'agent_lib';   extra: AgentLibExtra })
 *         | (EntityCommon & { entity_type: 'hook_lib';    extra: HookLibExtra })
 *         | (EntityCommon & { entity_type: 'api';         access: AccessBlock; extra: ApiExtra })
 *         | (EntityCommon & { entity_type: 'dataset';     access: AccessBlock; extra: DatasetExtra })} EntityRecord
 *
 * Phase 4.1 / D-03: `access` lives on the api/dataset members ONLY (not
 * EntityCommon, not extra).
 */

// Re-export marker so `import('./types.js')` returns an object (rather than
// undefined) for module-existence smoke tests.
export const TYPES_MODULE = 'claudeatlas/types@2';

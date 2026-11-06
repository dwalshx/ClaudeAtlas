// AUTO-GEN: keep src/lib/types.js in sync with src/lib/types.d.ts
// Source-of-truth: this file. JSDoc mirror lives in src/lib/types.js.
//
// Phase 3.1.2 — Polymorphic Entity Envelope (F2)
// Canonical TypeScript shape for the discriminated-union EntityRecord
// model that all ClaudeAtlas pipeline artifacts conform to from
// schema_version: 2 onward.

export type EntityType =
  | 'skill'
  | 'plugin'
  | 'mcp_server'
  | 'command_lib'
  | 'agent_lib'
  | 'hook_lib'
  // Phase 4.1 (v4.0 Data Feeds): api + dataset — non-GitHub origins; see docs/PHASE-4.0-SPEC.md
  | 'api'
  | 'dataset';
// NOTE: 'framework' is intentionally NOT an entity_type (Q3 decision:
// frameworks are tag-based, e.g. `framework:gsd` attachable to any entity).

export type QualityTier = 'featured' | 'solid' | 'listed';
// Tier rename to 'top' / 'solid' / 'indexed' is Phase 3.6 — not in F2.

/**
 * Phase 4.1 / D-02 — where a record was read from. Present on EVERY record.
 * For skill/plugin/mcp_server the upcaster fills the github form
 * ({ kind:'github', source:'github', source_id: repo_full_name, source_url: repo_url, also_listed_in: [] }).
 * NOTE: `origin.source` is the provenance CATALOG name ('apis.guru', 'huggingface', 'github'…);
 * `EntityCommon.source` is the discovery CHANNEL enum — keep the two distinct.
 */
export interface Origin {
  kind: 'github' | 'registry' | 'portal' | 'manual';
  source: string;
  source_id: string;
  source_url: string;
  also_listed_in: string[];
}

/** Phase 4.1 / D-03 — how a single `access.*` value was obtained. Keyed by field path, e.g. 'cost.model'. */
export type ProvenanceMethod = 'declared' | 'spec' | 'probed' | 'heuristic' | 'extracted' | 'manual';
export interface AccessProvenance {
  method: ProvenanceMethod;
  source_url: string | null;
  /** 0-1 */
  confidence: number;
  /** ISO 8601 ('' when the source carried no timestamp) */
  checked_at: string;
}

/**
 * Phase 4.1 / D-03 — shared access block. Top-level on `api` and `dataset`
 * records ONLY (never on EntityCommon, never under `extra`). `unknown` is a
 * first-class value: the upcaster defaults every enum to 'unknown', numbers
 * to null, arrays to [], provenance to {}. Helpers: scripts/lib/access.js.
 */
export interface AccessBlock {
  cost: {
    model: 'free' | 'freemium' | 'paid' | 'pay_per_call' | 'unknown';
    free_tier: string | null;
    price_notes: string | null;
  };
  rate_limit: {
    requests: number | null;
    per: 'second' | 'minute' | 'hour' | 'day' | 'month' | null;
    notes: string | null;
    headers_observed: string[];
  };
  auth: {
    type: 'none' | 'api_key' | 'bearer' | 'oauth2' | 'http_basic' | 'openid' | 'unknown';
    signup_url: string | null;
  };
  license: { spdx: string | null; name: string | null; url: string | null };
  formats: string[];
  /** api: 'rest' | 'graphql' | 'grpc' | 'soap'; dataset: 'download' | 'api' | 'sql' | 's3' */
  transport: string | null;
  provenance: Record<string, AccessProvenance>;
}

/** Phase 4.1 / D-04 — ids of indexed entities that consume a feed. Populated by Phase 4.6 link-consumers.js; [] until then. */
export interface ConsumedBy { skills: string[]; plugins: string[]; mcp_servers: string[] }

export interface EntityCommon {
  // --- Identity ---
  /** `${entity_type}:${repo_full_name}/${path_within_repo}` */
  id: string;
  /** URL-safe slug, scoped per type (e.g. `owner/skill-name`). */
  slug: string;
  entity_type: EntityType;
  name: string;
  description: string;

  // --- Origin (Phase 4.1 / D-02) ---
  origin: Origin;
  /** Landing page. Equals repo_url for github-origin records. */
  home_url: string;
  docs_url: string | null;

  // --- Repo metadata ---
  // Phase 4.1 / D-02: NULLABLE. Non-null for every record with origin.kind === 'github'
  // (all skill/plugin/mcp_server records — the upcaster never emits null for them).
  // null ONLY for api/dataset records with no known GitHub repo; when one is known
  // (e.g. an APIs.guru x-origin pointing at GitHub) they populate exactly like skills.
  repo_full_name: string | null;
  repo_url: string | null;
  repo_stars: number | null;
  repo_forks: number | null;
  repo_open_issues: number | null;
  repo_topics: string[] | null;
  repo_license: string | null;
  repo_language: string | null;
  /** ISO 8601. */
  repo_created_at: string | null;
  repo_updated_at: string | null;
  repo_pushed_at: string | null;
  repo_owner_type: 'Organization' | 'User' | null;
  repo_owner_avatar: string | null;
  repo_archived: boolean | null;
  repo_is_fork: boolean | null;
  repo_description: string | null;

  // --- Content ---
  /**
   * Original body length BEFORE any filter-stage truncation. (F2 Rev 2 / F2)
   *
   * NOTE: `extra.body_markdown` may be 1500-char trimmed (filter output) or
   * 5000-char trimmed (raw output); `body_length` captures the pre-trim
   * length so search ranking and quality scoring see the original.
   *
   * INVARIANT: The filter MUST NOT mutate `body_length` when it trims
   * `extra.body_markdown`. An invariant assert in `filter.js` enforces this.
   */
  body_length: number;
  // NOTE: body_markdown lives in `extra.*` because what counts as "primary content"
  // is entity-type-shaped (SKILL.md for skills, plugin.json + README for plugins, etc.)

  // --- Computed (filled by scorer + filter) ---
  /** 0-100, computed by per-type scorer. */
  quality_score: number;
  quality_tier: QualityTier;
  /** 0-1; populated by enrich.js (lands in F3); 0 in F2. */
  novelty_score: number;
  /** Populated by enrich.js; false in F2. */
  is_duplicate: boolean;
  /** Points to canonical EntityRecord.id when is_duplicate; null otherwise. */
  canonical_id: string | null;

  // --- Classification ---
  /** PRIMARY classifier; conventions in scripts/lib/tags.js. */
  tags: string[];
  /**
   * LEGACY display field; mechanically equals
   * `tags.find(t => t.startsWith('category:')).split(':')[1]`.
   * Kept for back-compat through Phase 3.6.
   */
  category: string | null;

  // --- Lineage ---
  scraped_at: string;
  content_sha: string;
  /** Discovery CHANNEL (not the catalog — see Origin.source). api/dataset use 'registry'. */
  source: 'code-search' | 'topics' | 'seed' | 'discover' | 'registry' | 'manual';
  /** Which discovery signals matched (audit trail). */
  discovery_signals: string[];
  /** Bumped from implicit 1 in F2. */
  schema_version: 2;

  // --- Bundle lineage (Phase 3.2 / D-02) ---
  /**
   * IDs of plugin EntityRecords that bundle this entity. Populated by
   * `scripts/link-bundles.js` (the bidirectional bundle-graph pass).
   * The forward edge is `PluginExtra.bundled_*[]`; this is the back edge.
   * `[]` for entities not bundled by any plugin (the common case).
   */
  bundled_in_plugins: string[];
}

export interface SkillExtra {
  type: 'skill';
  skill_path: string;
  /** First 1500 chars (filter) or 5000 chars (raw). See `EntityCommon.body_length` invariant. */
  body_markdown: string;
  frontmatter: Record<string, any>;
  has_name: boolean;
  has_description: boolean;
  skill_first_commit_at: string | null;
}

export interface PluginExtra {
  type: 'plugin';
  plugin_path: string;
  manifest: Record<string, any>;
  readme_markdown: string;
  commands: string[];
  hooks: string[];

  // --- Phase 3.2 bundle graph + manifest signals (D-02, D-03) ---
  /**
   * Marketplace listings that advertise this plugin (Phase 3.3 / D-08).
   * `path` is the marketplace's `owner/repo` (install step 1:
   * `/plugin marketplace add <path>`); `name` is the marketplace's
   * DECLARED name from marketplace_manifest.name (install step 2:
   * `/plugin install <plugin>@<name>`), null when undeclared/blank
   * (pages render the GitHub fallback).
   *
   * NOTE: pre-3.3 records stored bare path strings — the page loader
   * (3.3 Plan 02) must normalize both shapes.
   */
  marketplace_listings: Array<{ path: string; name: string | null }>;
  /** IDs of skill EntityRecords this plugin bundles (forward edge of D-02). */
  bundled_skills: string[];
  /** Agent component IDs/names this plugin bundles. */
  bundled_agents: string[];
  /** Command component IDs/names this plugin bundles. */
  bundled_commands: string[];
  /** Hook component IDs/names this plugin bundles. */
  bundled_hooks: string[];
  /** IDs of mcp_server EntityRecords this plugin bundles. */
  bundled_mcp_servers: string[];
  /**
   * 0-1 fraction of expected manifest fields present. Feeds the
   * Manifest-Completeness signal that swaps in for the Frontmatter
   * signal in the plugin/MCP scorer (D-03).
   */
  manifest_completeness: number;
}

export interface McpExtra {
  type: 'mcp_server';
  server_path: string;
  manifest: Record<string, any>;
  readme_markdown: string;
  tools: string[];
  transport: 'stdio' | 'sse' | 'streamable-http' | null;
  /**
   * 0-1 fraction of expected manifest fields present. Feeds the
   * Manifest-Completeness signal in the plugin/MCP scorer (D-03).
   */
  manifest_completeness: number;
}

/** Phase 4.1 (scaffold; harvester lands 4.2). Field semantics in docs/PHASE-4.0-SPEC.md § ApiExtra. */
export interface ApiExtra {
  type: 'api';
  /** OpenAPI servers[] or catalog base_api_url */
  base_urls: string[];
  spec_url: string | null;
  spec_version: string | null;
  endpoint_count: number | null;
  /** source-native categories (x-apisguru-categories etc.) */
  categories_src: string[];
  /** 'stripe.com' — also the slug owner segment (D-05) */
  provider: string;
  status_page_url: string | null;
  sdks: string[];
  /** Phase 4.1 addition (orchestrator decision 1): source `modified` timestamp (APIs.guru versions[v].updated, data.gouv.fr metadata_modified_at). Freshness reads it; null → 0. */
  source_modified_at: string | null;
  /** 0-1, written by api.scorer.js (same side-effect convention as manifest_completeness). 0 until scored. */
  access_clarity: number;
  consumed_by: ConsumedBy;
}

/** Phase 4.1 (scaffold; harvester lands 4.5). Field semantics in docs/PHASE-4.0-SPEC.md § DatasetExtra. */
export interface DatasetExtra {
  type: 'dataset';
  download_urls: string[];
  size_bytes: number | null;
  /** HF '1K<n<10K' when bytes unknown */
  size_bucket: string | null;
  record_count: number | null;
  /** DCAT accrualPeriodicity / AWS ODR UpdateFrequency, normalized when possible */
  update_frequency: string | null;
  temporal_coverage: string | null;
  /** also the slug owner segment (D-05) */
  publisher: string;
  popularity: { downloads: number | null; views: number | null; likes: number | null; citations: number | null; window: string | null };
  /** croissant / DCAT / openapi.json */
  schema_url: string | null;
  /** Phase 4.1 addition: HF lastModified, DCAT modified, Zenodo modified. Freshness (365-day cliff) reads it; null → 0. */
  source_modified_at: string | null;
  /** 0-1, written by dataset.scorer.js. 0 until scored. */
  access_clarity: number;
  consumed_by: ConsumedBy;
}

export interface CommandLibExtra {
  type: 'command_lib';
  lib_path: string;
  readme_markdown: string;
  commands: string[];
}

export interface AgentLibExtra {
  type: 'agent_lib';
  lib_path: string;
  readme_markdown: string;
  agents: string[];
}

export interface HookLibExtra {
  type: 'hook_lib';
  lib_path: string;
  readme_markdown: string;
  hooks: string[];
}

export type EntityRecord =
  | (EntityCommon & { entity_type: 'skill'; extra: SkillExtra })
  | (EntityCommon & { entity_type: 'plugin'; extra: PluginExtra })
  | (EntityCommon & { entity_type: 'mcp_server'; extra: McpExtra })
  | (EntityCommon & { entity_type: 'command_lib'; extra: CommandLibExtra })
  | (EntityCommon & { entity_type: 'agent_lib'; extra: AgentLibExtra })
  | (EntityCommon & { entity_type: 'hook_lib'; extra: HookLibExtra })
  // Phase 4.1 / D-03: `access` lives on these two members ONLY (not EntityCommon, not extra).
  | (EntityCommon & { entity_type: 'api'; access: AccessBlock; extra: ApiExtra })
  | (EntityCommon & { entity_type: 'dataset'; access: AccessBlock; extra: DatasetExtra });

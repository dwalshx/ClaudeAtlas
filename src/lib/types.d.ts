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
  | 'hook_lib';
// NOTE: 'framework' is intentionally NOT an entity_type (Q3 decision:
// frameworks are tag-based, e.g. `framework:gsd` attachable to any entity).

export type QualityTier = 'featured' | 'solid' | 'listed';
// Tier rename to 'top' / 'solid' / 'indexed' is Phase 3.6 — not in F2.

export interface EntityCommon {
  // --- Identity ---
  /** `${entity_type}:${repo_full_name}/${path_within_repo}` */
  id: string;
  /** URL-safe slug, scoped per type (e.g. `owner/skill-name`). */
  slug: string;
  entity_type: EntityType;
  name: string;
  description: string;

  // --- Repo metadata (every entity lives in a GitHub repo) ---
  repo_full_name: string;
  repo_url: string;
  repo_stars: number;
  repo_forks: number;
  repo_open_issues: number;
  repo_topics: string[];
  repo_license: string | null;
  repo_language: string | null;
  /** ISO 8601. */
  repo_created_at: string;
  repo_updated_at: string;
  repo_pushed_at: string;
  repo_owner_type: 'Organization' | 'User';
  repo_owner_avatar: string;
  repo_archived: boolean;
  repo_is_fork: boolean;
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
  source: 'code-search' | 'topics' | 'seed' | 'discover' | 'registry' | 'manual';
  /** Which discovery signals matched (audit trail). */
  discovery_signals: string[];
  /** Bumped from implicit 1 in F2. */
  schema_version: 2;
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
}

export interface McpExtra {
  type: 'mcp_server';
  server_path: string;
  manifest: Record<string, any>;
  readme_markdown: string;
  tools: string[];
  transport: 'stdio' | 'sse' | 'streamable-http' | null;
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
  | (EntityCommon & { entity_type: 'hook_lib'; extra: HookLibExtra });

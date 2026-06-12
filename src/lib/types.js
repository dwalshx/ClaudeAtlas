// AUTO-GEN: keep src/lib/types.js in sync with src/lib/types.d.ts
// Source-of-truth: src/lib/types.d.ts. This file is the JSDoc mirror that
// powers VS Code and Astro's TS-language-server inference at JS call sites.
//
// Phase 3.1.2 — Polymorphic Entity Envelope (F2)

/**
 * @typedef {'skill' | 'plugin' | 'mcp_server' | 'command_lib' | 'agent_lib' | 'hook_lib'} EntityType
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
 * @typedef {Object} EntityCommon
 *
 * @property {string} id    `${entity_type}:${repo_full_name}/${path_within_repo}`
 * @property {string} slug  URL-safe slug, scoped per type.
 * @property {EntityType} entity_type
 * @property {string} name
 * @property {string} description
 *
 * @property {string} repo_full_name
 * @property {string} repo_url
 * @property {number} repo_stars
 * @property {number} repo_forks
 * @property {number} repo_open_issues
 * @property {string[]} repo_topics
 * @property {string | null} repo_license
 * @property {string | null} repo_language
 * @property {string} repo_created_at   ISO 8601
 * @property {string} repo_updated_at
 * @property {string} repo_pushed_at
 * @property {'Organization' | 'User'} repo_owner_type
 * @property {string} repo_owner_avatar
 * @property {boolean} repo_archived
 * @property {boolean} repo_is_fork
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
 *         | (EntityCommon & { entity_type: 'hook_lib';    extra: HookLibExtra })} EntityRecord
 */

// Re-export marker so `import('./types.js')` returns an object (rather than
// undefined) for module-existence smoke tests.
export const TYPES_MODULE = 'claudeatlas/types@2';

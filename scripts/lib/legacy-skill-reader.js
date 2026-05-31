/**
 * scripts/lib/legacy-skill-reader.js — v1→v2 in-memory upcaster.
 *
 * Phase 3.1.2 (F2) — Polymorphic Entity Envelope.
 *
 * Reads a "v1" flat skill record (pre-F2 shape) and returns an
 * EntityRecord<SkillExtra> (v2 shape). For v2 records already on disk
 * (post-T9), returns them unchanged. Unknown `schema_version` throws.
 *
 * **Backward-compat dual shape:** during the F2 cutover window (D+0 → D+7),
 * the upcaster preserves the legacy flat fields (`skill_path`,
 * `body_markdown`, `frontmatter`, `has_name`, `has_description`,
 * `skill_first_commit_at`) at the top level AS WELL AS nesting them inside
 * `extra`. This lets consumers migrate field-path reads on their own
 * timeline (T7/T7.5/T8 of this plan) without breaking unmigrated callers
 * mid-phase. The cutover commit at D+7 strips the dual shape.
 *
 * Lifecycle: kept until D+7 cutover commit; deleted then.
 *
 * ---------------------------------------------------------------------------
 * PHASE 3.2 EXPANSION — plugin + mcp_server upcast paths.
 *
 * F-1 RAW-SHAPE INSPECTION (data/plugins-raw.ndjson, observed 2026-05-31):
 *   The plugins scraper writes REPO-LEVEL records, NOT entity-tagged ones.
 *   Each line has top-level keys:
 *     repo_full_name, discovery_paths, discovery_sources, stars, forks,
 *     open_issues, description, topics, language, license, created_at,
 *     pushed_at, archived, is_fork, owner_type, owner_avatar,
 *     default_branch, plugin_manifest, marketplace_manifest, components,
 *     component_summary, scraped_at, processing_time_ms
 *   There is NO `entity_type`, NO `schema_version`, NO `extra`, NO
 *   `plugin_path`/`server_path`. `plugin_manifest` is
 *   `{name, description, version, author:{name}, [dependencies], [lspServers]}`.
 *   `marketplace_manifest` is usually null. `component_summary` is
 *   `{skills, agents, commands, hooks, mcp_servers, lsp_servers, total}`.
 *   MCP servers are NESTED COMPONENTS of a plugin repo, surfaced via
 *   `component_summary.mcp_servers > 0` and `components["mcp-servers"]`.
 *
 *   DEVIATION (Rule 3): the plan assumed entity-tagged raw records with
 *   flat `plugin_path`/`commands`/`hooks`. The repo→entity TRANSFORM
 *   (deriving entity_type, mapping repo fields → the pre-v2 envelope) lives
 *   in the filter stage (Task 7's filter-plugins.js / filter-mcps.js). By
 *   the time a record reaches THIS upcaster it has already been tagged with
 *   `entity_type` and had its type-specific fields hoisted to the top level
 *   (or nested under `extra`). The upcaster's job is therefore the same as
 *   for skills: dispatch on entity_type, nest into `extra`, fill 3.2 defaults
 *   (bundled_*=[], marketplace_listings=[], manifest_completeness=0,
 *   bundled_in_plugins=[]). It accepts BOTH flat and already-nested inputs
 *   defensively (the `?? rec.extra?.x ?? rec.x` chains below).
 *
 * D+7 COORDINATION: the 3.1.2-CUTOVER.md D+7 commit DELETES this file. The
 * plugin/MCP upcast paths are transient bridges for any v1-shape records on
 * disk after 3.2 ships; once scrape-plugins.js + filter-plugins.js emit
 * native v2 always, these paths become unreachable and are removed with the
 * rest of the file.
 * ---------------------------------------------------------------------------
 */

import {
  CURRENT_SCHEMA_VERSION,
  isHeaderRecord,
  assertKnownSchemaVersion,
} from './entity-version.js';
import {
  deriveTagsFromLegacyCategory,
  projectCategoryFromTags,
  mergeTags,
} from './tags.js';

/**
 * Upcast a single record to v2 EntityRecord<SkillExtra>.
 *
 * - v1 (no schema_version): lifts flat fields → common; nests SkillExtra
 *   fields under `extra`; derives `tags = ['category:<slug>', ...existing]`;
 *   preserves legacy flat fields for dual-shape back-compat.
 * - v2 (schema_version=2): returns unchanged.
 * - Unknown schema_version: throws.
 *
 * @param {any} rec
 * @returns {any} EntityRecord<SkillExtra>
 */
export function upcastRecord(rec) {
  if (!rec || typeof rec !== 'object') return rec;

  // Header sentinel — should be filtered upstream by readNdjsonRecords;
  // defensive no-op here.
  if (isHeaderRecord(rec)) return rec;

  // Already v2 — pass through after sanity-checking the schema version.
  if (rec.schema_version === CURRENT_SCHEMA_VERSION) {
    return rec;
  }
  if (typeof rec.schema_version === 'number' && rec.schema_version !== CURRENT_SCHEMA_VERSION) {
    // Unknown future version (e.g., schema_version=3 from a downgraded reader).
    assertKnownSchemaVersion(/** @type {any} */({ _header: true, schema_version: rec.schema_version }));
  }

  // Phase 3.2 dispatch — route by entity_type when the upstream stage has
  // already tagged the record (filter-plugins.js / filter-mcps.js). v1 skill
  // records carry no entity_type and fall through to the skill path.
  if (rec.entity_type === 'plugin') return upcastPluginRecord(rec);
  if (rec.entity_type === 'mcp_server') return upcastMcpRecord(rec);

  return upcastSkillRecord(rec);
}

/**
 * Build the shared EntityCommon scalar fields from a (possibly v1) record.
 * Used by all three upcasters so repo-metadata handling stays identical.
 *
 * @param {any} rec
 * @returns {Record<string, any>}
 */
function buildCommonFields(rec) {
  return {
    slug: rec.slug || '',
    name: rec.name || '',
    description: rec.description || '',
    repo_full_name: rec.repo_full_name || '',
    repo_url: rec.repo_url || '',
    repo_stars: typeof rec.repo_stars === 'number' ? rec.repo_stars : 0,
    repo_forks: typeof rec.repo_forks === 'number' ? rec.repo_forks : 0,
    repo_open_issues: typeof rec.repo_open_issues === 'number' ? rec.repo_open_issues : 0,
    repo_topics: Array.isArray(rec.repo_topics) ? rec.repo_topics : [],
    repo_license: rec.repo_license ?? null,
    repo_language: rec.repo_language ?? null,
    repo_created_at: rec.repo_created_at || '',
    repo_updated_at: rec.repo_updated_at || '',
    repo_pushed_at: rec.repo_pushed_at || '',
    repo_owner_type: rec.repo_owner_type || 'User',
    repo_owner_avatar: rec.repo_owner_avatar || '',
    repo_archived: Boolean(rec.repo_archived),
    repo_is_fork: Boolean(rec.repo_is_fork),
    repo_description: rec.repo_description ?? null,
    body_length: typeof rec.body_length === 'number' ? rec.body_length : 0,
    quality_score: typeof rec.quality_score === 'number' ? rec.quality_score : 0,
    quality_tier: rec.quality_tier || 'listed',
    novelty_score: typeof rec.novelty_score === 'number' ? rec.novelty_score : 0,
    is_duplicate: rec.is_duplicate === true,
    canonical_id: rec.canonical_id ?? rec.canonical_slug ?? null,
    scraped_at: rec.scraped_at || '',
    content_sha: rec.content_sha || '',
    source: rec.source || 'discover',
    discovery_signals: Array.isArray(rec.discovery_signals) ? rec.discovery_signals : [],
    schema_version: CURRENT_SCHEMA_VERSION,
    // Phase 3.2 / D-02 back edge — default empty; link-bundles.js fills it.
    bundled_in_plugins: Array.isArray(rec.bundled_in_plugins) ? rec.bundled_in_plugins : [],
  };
}

/**
 * Upcast a v1/flat plugin record to EntityRecord<PluginExtra>.
 * Accepts both flat (top-level plugin_path/manifest/...) and already-nested
 * (`rec.extra.*`) inputs (F-1 defensive chains).
 *
 * @param {any} rec
 * @returns {any}
 */
function upcastPluginRecord(rec) {
  const e = rec.extra || {};
  const plugin_path = e.plugin_path ?? rec.plugin_path ?? '';
  const extra = {
    type: 'plugin',
    plugin_path,
    manifest: e.manifest ?? rec.manifest ?? {},
    readme_markdown: e.readme_markdown ?? rec.readme_markdown ?? '',
    commands: arr(e.commands ?? rec.commands),
    hooks: arr(e.hooks ?? rec.hooks),
    marketplace_listings: arr(e.marketplace_listings ?? rec.marketplace_listings),
    bundled_skills: arr(e.bundled_skills ?? rec.bundled_skills),
    bundled_agents: arr(e.bundled_agents ?? rec.bundled_agents),
    bundled_commands: arr(e.bundled_commands ?? rec.bundled_commands),
    bundled_hooks: arr(e.bundled_hooks ?? rec.bundled_hooks),
    bundled_mcp_servers: arr(e.bundled_mcp_servers ?? rec.bundled_mcp_servers),
    manifest_completeness:
      typeof (e.manifest_completeness ?? rec.manifest_completeness) === 'number'
        ? (e.manifest_completeness ?? rec.manifest_completeness)
        : 0,
  };
  const tags = Array.isArray(rec.tags) ? rec.tags.filter((t) => typeof t === 'string') : [];
  return {
    id: rec.id || `plugin:${rec.repo_full_name || ''}/${plugin_path}`,
    entity_type: 'plugin',
    ...buildCommonFields(rec),
    tags,
    category: rec.category ?? projectCategoryFromTags(tags),
    extra,
  };
}

/**
 * Upcast a v1/flat mcp_server record to EntityRecord<McpExtra>.
 *
 * @param {any} rec
 * @returns {any}
 */
function upcastMcpRecord(rec) {
  const e = rec.extra || {};
  const server_path = e.server_path ?? rec.server_path ?? '';
  const transport = e.transport ?? rec.transport ?? null;
  const extra = {
    type: 'mcp_server',
    server_path,
    manifest: e.manifest ?? rec.manifest ?? {},
    readme_markdown: e.readme_markdown ?? rec.readme_markdown ?? '',
    tools: arr(e.tools ?? rec.tools),
    transport: transport === undefined ? null : transport,
    manifest_completeness:
      typeof (e.manifest_completeness ?? rec.manifest_completeness) === 'number'
        ? (e.manifest_completeness ?? rec.manifest_completeness)
        : 0,
  };
  const tags = Array.isArray(rec.tags) ? rec.tags.filter((t) => typeof t === 'string') : [];
  return {
    id: rec.id || `mcp_server:${rec.repo_full_name || ''}/${server_path}`,
    entity_type: 'mcp_server',
    ...buildCommonFields(rec),
    tags,
    category: rec.category ?? projectCategoryFromTags(tags),
    extra,
  };
}

/** Coerce to a string array. */
function arr(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}

/**
 * Upcast a single v1 flat SKILL record → v2 EntityRecord<SkillExtra>.
 * (The original upcastRecord body, unchanged — regression snapshot guards it.)
 *
 * @param {any} rec
 * @returns {any}
 */
function upcastSkillRecord(rec) {
  // v1 (implicit schema_version=1): build v2 envelope.
  const legacyTags = Array.isArray(rec.tags) ? rec.tags.filter((t) => typeof t === 'string') : [];
  const categoryTags = deriveTagsFromLegacyCategory(rec.category);
  // Legacy tags are NOT namespaced (`neural-networks`, `auth`, ...). We keep
  // them so existing consumers reading record.tags don't lose data, but they
  // won't validate via mergeTags's strict namespace regex. For v2 canonical
  // tags we ONLY merge through the validator. Practical compromise: store
  // categoryTags via the validator + concat legacyTags as raw.
  const validatedTags = mergeTags(categoryTags);
  const tags = validatedTags.concat(
    legacyTags.filter((t) => !validatedTags.includes(t)),
  );

  const extra = {
    type: 'skill',
    skill_path: rec.skill_path || '',
    body_markdown: typeof rec.body_markdown === 'string' ? rec.body_markdown : '',
    frontmatter: rec.frontmatter && typeof rec.frontmatter === 'object' ? rec.frontmatter : {},
    has_name: Boolean(rec.has_name),
    has_description: Boolean(rec.has_description),
    skill_first_commit_at: rec.skill_first_commit_at ?? null,
  };

  // F2 EntityCommon shape. Lift every flat top-level field that exists on
  // v1; defaults applied where v1 records may be incomplete.
  const v2 = {
    // Identity
    id: rec.id || `skill:${rec.repo_full_name || ''}/${extra.skill_path}`,
    slug: rec.slug || '',
    entity_type: 'skill',
    name: rec.name || '',
    description: rec.description || '',

    // Repo metadata
    repo_full_name: rec.repo_full_name || '',
    repo_url: rec.repo_url || '',
    repo_stars: typeof rec.repo_stars === 'number' ? rec.repo_stars : 0,
    repo_forks: typeof rec.repo_forks === 'number' ? rec.repo_forks : 0,
    repo_open_issues: typeof rec.repo_open_issues === 'number' ? rec.repo_open_issues : 0,
    repo_topics: Array.isArray(rec.repo_topics) ? rec.repo_topics : [],
    repo_license: rec.repo_license ?? null,
    repo_language: rec.repo_language ?? null,
    repo_created_at: rec.repo_created_at || '',
    repo_updated_at: rec.repo_updated_at || '',
    repo_pushed_at: rec.repo_pushed_at || '',
    repo_owner_type: rec.repo_owner_type || 'User',
    repo_owner_avatar: rec.repo_owner_avatar || '',
    repo_archived: Boolean(rec.repo_archived),
    repo_is_fork: Boolean(rec.repo_is_fork),
    repo_description: rec.repo_description ?? null,

    // Content
    body_length: typeof rec.body_length === 'number' ? rec.body_length : extra.body_markdown.length,

    // Computed
    quality_score: typeof rec.quality_score === 'number' ? rec.quality_score : 0,
    quality_tier: rec.quality_tier || 'listed',
    novelty_score: typeof rec.novelty_score === 'number' ? rec.novelty_score : 0,
    is_duplicate: rec.is_duplicate === true,
    canonical_id: rec.canonical_id ?? rec.canonical_slug ?? null,

    // Classification
    tags,
    // Keep category projected from the canonical tag (mechanical equivalence
    // per F2 §1 JSDoc). For v1 records that already had a category, this
    // round-trips identity through deriveTagsFromLegacyCategory → projectCategoryFromTags.
    category: rec.category || projectCategoryFromTags(tags),

    // Lineage
    scraped_at: rec.scraped_at || '',
    content_sha: rec.content_sha || '',
    source: rec.source || 'discover',
    discovery_signals: Array.isArray(rec.discovery_signals) ? rec.discovery_signals : [],
    schema_version: CURRENT_SCHEMA_VERSION,

    // Phase 3.2 / D-02 back edge — default empty; link-bundles.js fills it.
    bundled_in_plugins: Array.isArray(rec.bundled_in_plugins) ? rec.bundled_in_plugins : [],

    // Discriminated union payload
    extra,

    // ---------------------------------------------------------------------
    // DUAL-SHAPE BACK-COMPAT (F2 cutover window only)
    //
    // Preserve the legacy flat fields at top level so unmigrated consumers
    // (those still reading `skill.body_markdown` etc.) keep working through
    // the D+0 → D+7 cutover window. The cutover commit strips this block.
    // ---------------------------------------------------------------------
    skill_path: extra.skill_path,
    body_markdown: extra.body_markdown,
    frontmatter: extra.frontmatter,
    has_name: extra.has_name,
    has_description: extra.has_description,
    skill_first_commit_at: extra.skill_first_commit_at,
    // Preserve legacy v1-only fields that worker / scripts still read.
    canonical_slug: rec.canonical_slug ?? null,
    repo_default_branch: rec.repo_default_branch ?? null,
  };

  return v2;
}

/**
 * Convenience: array-in, array-out.
 *
 * @param {any[]} records
 * @returns {any[]}
 */
export function upcastAll(records) {
  if (!Array.isArray(records)) return [];
  return records.map(upcastRecord);
}

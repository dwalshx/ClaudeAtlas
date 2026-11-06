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
 * PHASE 4.1 EXPANSION — api + dataset upcast paths (data feeds).
 *
 *   (a) `upcastRecord` dispatches `entity_type === 'api'` → upcastApiRecord
 *       and `'dataset'` → upcastDatasetRecord (D-01). These records mostly
 *       have NO GitHub repo; they carry a top-level `access` block (D-03,
 *       unknown-first — mergeAccess over emptyAccess()) and D-05
 *       ids (`api:<primary_host>/<name>`, `dataset:<source>/<native_id>`).
 *   (b) `buildCommonFields(rec, { nullableRepo, defaultSource })`: the
 *       `repo_*` fields are emitted as `null` ONLY when `nullableRepo` is
 *       true, and the api/dataset paths set it ONLY when `repo_full_name` is
 *       absent (D-02). When a repo IS known (e.g. an APIs.guru `x-origin`
 *       resolving to GitHub) the repo_* coercions are byte-identical to the
 *       skill/plugin/mcp_server ones. The github-origin paths never emit a
 *       null coerced repo_* (`repo_license`/`repo_language`/
 *       `repo_description` stay `?? null` on every type, as before).
 *   (c) EVERY path (skill, plugin, mcp_server, api, dataset) now emits
 *       `origin` / `home_url` / `docs_url` (D-02) via originFields(); for
 *       github-origin records origin = { kind:'github', source:'github',
 *       source_id: repo_full_name, source_url: repo_url, also_listed_in: [] },
 *       home_url = repo_url, docs_url = null. The v2 passthrough branch
 *       BACK-FILLS the three fields in place (backfillOriginInPlace) so the
 *       already-v2 production files gain them without a data migration
 *       (Research Pitfall 1).
 *   (d) LIFECYCLE SUPERSEDED: the D+7 "delete this file" plan above no
 *       longer applies. This module IS the production upcaster — filter.js
 *       (main(), ~line 537) and filter-plugins.js / filter-mcps.js route
 *       every record through upcastRecord on every run, and 4.1 made it the
 *       single choke point for repo_* nullability and origin defaults.
 *       RENAME at the cutover (e.g. entity-upcaster.js), do NOT delete.
 *       `CURRENT_SCHEMA_VERSION` stays 2 — all 4.1 fields are additive.
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
// Phase 4.1 / D-03 + D-05 — api/dataset access block + host-based id default.
import { emptyAccess, mergeAccess } from './access.js';
import { hostOf } from './url-host.js';

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
  // Phase 4.1 / Research Pitfall 1: every record in skills-latest /
  // plugins.ndjson / mcp-servers.ndjson is already v2; without this in-place
  // back-fill, origin/home_url/docs_url would be undefined in production
  // until the next full filter run. Same object is returned (identity).
  if (rec.schema_version === CURRENT_SCHEMA_VERSION) {
    return backfillOriginInPlace(rec);
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
  // Phase 4.1 / D-01 — data feeds. Every path is a field whitelist, so
  // `raw_source` and any other unknown input keys are dropped by construction.
  if (rec.entity_type === 'api') return upcastApiRecord(rec);
  if (rec.entity_type === 'dataset') return upcastDatasetRecord(rec);

  return upcastSkillRecord(rec);
}

/**
 * Phase 4.1 / D-02 — the three origin fields every EntityRecord carries.
 *
 * An explicit `rec.origin` object wins (missing sub-fields are defaulted
 * per kind). Without one, `fallbackKind: 'github'` (the default — used by
 * skill/plugin/mcp_server) derives origin from the repo fields;
 * `fallbackKind: 'manual'` (api/dataset with no origin supplied) never
 * invents a github origin.
 *
 * @param {any} rec
 * @param {{ fallbackKind?: 'github' | 'manual' }} [opts]
 * @returns {{ origin: Record<string, any>, home_url: string, docs_url: string | null }}
 */
function originFields(rec, opts = {}) {
  const o = rec.origin && typeof rec.origin === 'object' ? rec.origin : null;
  const fallbackKind = opts.fallbackKind || 'github';
  const origin = o
    ? {
        kind: typeof o.kind === 'string' ? o.kind : fallbackKind,
        source: typeof o.source === 'string' ? o.source : (fallbackKind === 'github' ? 'github' : 'manual'),
        source_id: typeof o.source_id === 'string' ? o.source_id : (rec.repo_full_name || rec.id || ''),
        source_url: typeof o.source_url === 'string' ? o.source_url : (rec.repo_url || rec.home_url || ''),
        also_listed_in: arr(o.also_listed_in),
      }
    : fallbackKind === 'github'
      ? { kind: 'github', source: 'github', source_id: rec.repo_full_name || '', source_url: rec.repo_url || '', also_listed_in: [] }
      : { kind: 'manual', source: 'manual', source_id: rec.id || rec.name || '', source_url: rec.home_url || '', also_listed_in: [] };
  return {
    origin,
    home_url: typeof rec.home_url === 'string' ? rec.home_url : (rec.repo_url || ''),
    docs_url: str(rec.docs_url),
  };
}

/**
 * Phase 4.1 / Research Pitfall 1 — v2 passthrough back-fill.
 *
 * Sets `origin` / `home_url` / `docs_url` on an already-v2 record ONLY where
 * each is `undefined`, mutating IN PLACE and returning the SAME object so the
 * passthrough identity contract (`upcastRecord(v2) === v2`) still holds.
 * api/dataset records fall back to a manual origin, never github.
 *
 * @param {any} rec
 * @returns {any} the same `rec`
 */
function backfillOriginInPlace(rec) {
  if (rec.origin === undefined || rec.home_url === undefined || rec.docs_url === undefined) {
    const f = originFields(rec, {
      fallbackKind: rec.entity_type === 'api' || rec.entity_type === 'dataset' ? 'manual' : 'github',
    });
    if (rec.origin === undefined) rec.origin = f.origin;
    if (rec.home_url === undefined) rec.home_url = f.home_url;
    if (rec.docs_url === undefined) rec.docs_url = f.docs_url;
  }
  return rec;
}

/**
 * Build the shared EntityCommon scalar fields from a (possibly v1) record.
 * Used by the plugin / mcp_server / api / dataset upcasters so repo-metadata
 * handling stays identical (the skill path inlines the same list).
 *
 * Phase 4.1 / D-02: `opts.nullableRepo` switches the 13 coerced `repo_*`
 * fields from their github-origin defaults (`''` / `0` / `[]` / `'User'` /
 * `false`) to `null`. Callers set it ONLY when `repo_full_name` is absent
 * (api/dataset with no known repo); the github-origin paths never pass it.
 * `repo_license` / `repo_language` / `repo_description` are `?? null` in
 * BOTH modes (unchanged). `opts.defaultSource` is the discovery-channel
 * default (`'discover'` for GitHub-scraped types, `'registry'` for feeds).
 *
 * @param {any} rec
 * @param {{ nullableRepo?: boolean, defaultSource?: string }} [opts]
 * @returns {Record<string, any>}
 */
function buildCommonFields(rec, opts = {}) {
  const { nullableRepo = false, defaultSource = 'discover' } = opts;
  const repoFields = nullableRepo
    ? {
        // Nullable mode (D-02): null, never a fake ''/0/'User'/false.
        repo_full_name: str(rec.repo_full_name),
        repo_url: str(rec.repo_url),
        repo_stars: num(rec.repo_stars),
        repo_forks: num(rec.repo_forks),
        repo_open_issues: num(rec.repo_open_issues),
        repo_topics: Array.isArray(rec.repo_topics) ? rec.repo_topics : null,
        repo_license: rec.repo_license ?? null,
        repo_language: rec.repo_language ?? null,
        repo_created_at: str(rec.repo_created_at),
        repo_updated_at: str(rec.repo_updated_at),
        repo_pushed_at: str(rec.repo_pushed_at),
        repo_owner_type: str(rec.repo_owner_type),
        repo_owner_avatar: str(rec.repo_owner_avatar),
        repo_archived: bool(rec.repo_archived),
        repo_is_fork: bool(rec.repo_is_fork),
        repo_description: rec.repo_description ?? null,
      }
    : {
        // Github-origin mode — byte-identical to the pre-4.1 coercions.
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
      };
  return {
    slug: rec.slug || '',
    name: rec.name || '',
    description: rec.description || '',
    // Phase 4.1 / D-02 — origin, home_url, docs_url on every record.
    ...originFields(rec, { fallbackKind: nullableRepo ? 'manual' : 'github' }),
    ...repoFields,
    body_length: typeof rec.body_length === 'number'
      ? rec.body_length
      : (nullableRepo ? (rec.description || '').length : 0),
    quality_score: typeof rec.quality_score === 'number' ? rec.quality_score : 0,
    quality_tier: rec.quality_tier || 'listed',
    novelty_score: typeof rec.novelty_score === 'number' ? rec.novelty_score : 0,
    is_duplicate: rec.is_duplicate === true,
    canonical_id: rec.canonical_id ?? rec.canonical_slug ?? null,
    scraped_at: rec.scraped_at || '',
    content_sha: rec.content_sha || '',
    source: rec.source || defaultSource,
    discovery_signals: Array.isArray(rec.discovery_signals) ? rec.discovery_signals : [],
    schema_version: CURRENT_SCHEMA_VERSION,
    // Phase 3.2 / D-02 back edge — default empty; link-bundles.js fills it.
    bundled_in_plugins: Array.isArray(rec.bundled_in_plugins) ? rec.bundled_in_plugins : [],
    // Phase 3.2.1 / Audit B annotation — explicit passthrough (this builder
    // uses a field whitelist, not a spread; without this line the
    // content_flags written by filterRaw would be dropped on the v2 write).
    content_flags: Array.isArray(rec.content_flags) ? rec.content_flags : [],
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
    // Phase 3.3 / D-08: listings are { path, name } objects (declared
    // marketplace name propagation); pre-3.3 records stored bare path
    // strings. listingArr keeps BOTH shapes — the plain arr() string
    // filter would silently drop the object entries.
    marketplace_listings: listingArr(e.marketplace_listings ?? rec.marketplace_listings),
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

/**
 * Phase 4.1 / D-04 — `consumed_by` default. The consumer graph (which
 * skills/plugins/MCP servers call this feed) is populated in 4.6; 4.1 only
 * guarantees the shape so downstream readers never branch on undefined.
 *
 * @param {any} v
 * @returns {{ skills: string[], plugins: string[], mcp_servers: string[] }}
 */
function consumedBy(v) {
  const o = v && typeof v === 'object' ? v : {};
  return { skills: arr(o.skills), plugins: arr(o.plugins), mcp_servers: arr(o.mcp_servers) };
}

/**
 * Phase 4.1 — upcast a raw-ish api record (APIs.guru / data.gouv.fr /
 * public-apis-shaped, see data/__fixtures__/apis-mini.ndjson) to
 * EntityRecord<ApiExtra>. Accepts flat and `rec.extra.*` inputs (F-1 chains).
 *
 * - D-02: `repo_*` are null ONLY when `repo_full_name` is absent; a known
 *   repo (e.g. an `x-origin` resolving to GitHub) gets the skill coercions.
 * - D-03: top-level `access`, unknown-first (mergeAccess over emptyAccess).
 * - D-05: id = `api:<primary_host>/<name>` (host of base_urls[0], else provider).
 * - `extra.access_clarity` defaults 0 (the api scorer writes it, Plan 05).
 *
 * @param {any} rec
 * @returns {any}
 */
function upcastApiRecord(rec) {
  const e = rec.extra || {};
  const provider = typeof (e.provider ?? rec.provider) === 'string' ? (e.provider ?? rec.provider) : '';
  const extra = {
    type: 'api',
    base_urls: arr(e.base_urls ?? rec.base_urls),
    spec_url: str(e.spec_url ?? rec.spec_url),
    spec_version: str(e.spec_version ?? rec.spec_version),
    endpoint_count: num(e.endpoint_count ?? rec.endpoint_count),
    categories_src: arr(e.categories_src ?? rec.categories_src),
    provider,
    status_page_url: str(e.status_page_url ?? rec.status_page_url),
    sdks: arr(e.sdks ?? rec.sdks),
    source_modified_at: str(e.source_modified_at ?? rec.source_modified_at),
    access_clarity: num(e.access_clarity) ?? 0,
    consumed_by: consumedBy(e.consumed_by ?? rec.consumed_by),
  };
  const tags = Array.isArray(rec.tags) ? rec.tags.filter((t) => typeof t === 'string') : [];
  const nullableRepo = !rec.repo_full_name;   // D-02: null only when no repo is known
  return {
    id: rec.id || `api:${hostOf(extra.base_urls[0]) || provider}/${rec.name || ''}`,
    entity_type: 'api',
    ...buildCommonFields(rec, { nullableRepo, defaultSource: 'registry' }),
    access: mergeAccess(emptyAccess(), rec.access),   // D-03: top-level, unknown-first
    tags,
    category: rec.category ?? projectCategoryFromTags(tags),
    extra,
  };
}

/**
 * Phase 4.1 — upcast a raw-ish dataset record (Hugging Face / data.gov /
 * AWS ODR / Zenodo-shaped, see data/__fixtures__/datasets-mini.ndjson) to
 * EntityRecord<DatasetExtra>. Same shell as upcastApiRecord.
 *
 * - D-05: id = `dataset:<source>/<native_id>`, read from the ORIGIN (the
 *   fixtures/harvesters always carry it; a missing origin falls back to the
 *   manual origin, giving `dataset:manual/<id-or-name>`).
 * - `extra.popularity` is always the full 5-key object (nulls when unknown).
 *
 * @param {any} rec
 * @returns {any}
 */
function upcastDatasetRecord(rec) {
  const e = rec.extra || {};
  const popIn = e.popularity ?? rec.popularity;
  const pop = popIn && typeof popIn === 'object' ? popIn : {};
  const extra = {
    type: 'dataset',
    download_urls: arr(e.download_urls ?? rec.download_urls),
    size_bytes: num(e.size_bytes ?? rec.size_bytes),
    size_bucket: str(e.size_bucket ?? rec.size_bucket),
    record_count: num(e.record_count ?? rec.record_count),
    update_frequency: str(e.update_frequency ?? rec.update_frequency),
    temporal_coverage: str(e.temporal_coverage ?? rec.temporal_coverage),
    publisher: typeof (e.publisher ?? rec.publisher) === 'string' ? (e.publisher ?? rec.publisher) : '',
    popularity: {
      downloads: num(pop.downloads),
      views: num(pop.views),
      likes: num(pop.likes),
      citations: num(pop.citations),
      window: str(pop.window),
    },
    schema_url: str(e.schema_url ?? rec.schema_url),
    source_modified_at: str(e.source_modified_at ?? rec.source_modified_at),
    access_clarity: num(e.access_clarity) ?? 0,
    consumed_by: consumedBy(e.consumed_by ?? rec.consumed_by),
  };
  const tags = Array.isArray(rec.tags) ? rec.tags.filter((t) => typeof t === 'string') : [];
  // id: D-05 `dataset:<source>/<native_id>` — read from the ORIGIN (fixtures always carry it)
  const common = buildCommonFields(rec, { nullableRepo: !rec.repo_full_name, defaultSource: 'registry' });
  return {
    id: rec.id || `dataset:${common.origin.source}/${common.origin.source_id}`,
    entity_type: 'dataset',
    ...common,
    access: mergeAccess(emptyAccess(), rec.access),   // D-03: top-level, unknown-first
    tags,
    category: rec.category ?? projectCategoryFromTags(tags),
    extra,
  };
}

/** Coerce to a string array. */
function arr(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}

// Phase 4.1 nullable coercions — a value of the right type, else null
// (never a fake ''/0/false). Used by the api/dataset paths and nullable
// buildCommonFields mode so no `undefined` ever reaches the NDJSON write.
/** @returns {number | null} */
function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
/** @returns {string | null} */
function str(v) { return typeof v === 'string' ? v : null; }
/** @returns {boolean | null} */
function bool(v) { return typeof v === 'boolean' ? v : null; }

/**
 * Phase 3.3 / D-08 marketplace_listings passthrough: accepts the 3.3+
 * `{ path: string, name: string|null }` object entries AND legacy bare
 * path strings (pre-3.3 records). Anything else is dropped.
 *
 * @param {any} v
 * @returns {Array<string | { path: string, name: string | null }>}
 */
function listingArr(v) {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x) => typeof x === 'string'
      || (x && typeof x === 'object' && typeof x.path === 'string'),
  );
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
    // Phase 4.1 / D-02 — github origin, home_url = repo_url, docs_url null.
    ...originFields(rec),

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

    // Phase 3.2.1 / Audit B annotation — explicit passthrough (this builder
    // uses a field whitelist, not a spread; without this line the
    // content_flags written by filterRaw Step 1c would be dropped on the
    // v2 write in filter.js main()).
    content_flags: Array.isArray(rec.content_flags) ? rec.content_flags : [],

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

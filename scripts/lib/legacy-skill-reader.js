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

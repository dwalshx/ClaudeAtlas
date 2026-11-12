/**
 * worker/search-results.js — PR #26. Pure helpers (zero imports) for shaping
 * Vectorize matches into /api/v1/search results, shared by worker/index.js,
 * worker/mcp.js and worker/markdown.js. Importable under plain `node --test`
 * (worker/index.js is not: it uses bare JSON imports).
 *
 * - detailPathFor(entityType, slug): per-type detail page path. Unknown or
 *   missing entity_type falls back to /skills/ (vectors uploaded before T8
 *   carry no entity_type metadata).
 * - HIDDEN_FROM_UNTYPED_SEARCH: entity types whose pages do not exist yet
 *   (api / dataset until Phase 4.3 / 4.5). They are post-filtered out of
 *   UNTYPED searches (no ?type) so the homepage never links to a missing page;
 *   an explicit ?type=api still returns them. A post-filter, not a Vectorize
 *   metadata filter, because older vectors may lack entity_type.
 * - vectorTopK(): over-fetches a few matches while the post-filter is active so
 *   a page of results is not short.
 */

export const DETAIL_PREFIX = Object.freeze({
  skill: '/skills/',
  plugin: '/plugins/',
  mcp_server: '/mcp/',
  api: '/apis/',
  dataset: '/datasets/',
});

export const HIDDEN_FROM_UNTYPED_SEARCH = Object.freeze(['api', 'dataset']);

/** Extra matches requested from Vectorize when the untyped post-filter is active. */
export const UNTYPED_OVERFETCH = 10;

/** `/skills/<slug>/`, `/plugins/<slug>/`, … ; unknown/missing type → `/skills/`. */
export function detailPathFor(entityType, slug) {
  const prefix = DETAIL_PREFIX[entityType] || DETAIL_PREFIX.skill;
  return `${prefix}${slug}/`;
}

/**
 * Vectorize topK to request: the caller's topK, plus UNTYPED_OVERFETCH when
 * no ?type is given (the post-filter may remove hidden types), capped at maxK.
 */
export function vectorTopK(topK, filterType, maxK = 50) {
  if (filterType) return topK;
  return Math.min(topK + UNTYPED_OVERFETCH, maxK);
}

/**
 * Vectorize matches → result objects: dedupe per (entity_type, slug) keeping
 * the best score, sort by score desc, drop HIDDEN_FROM_UNTYPED_SEARCH types
 * when filterType is empty, truncate to topK.
 *
 * @param {Array<{ score: number, metadata?: Record<string, any> }>} matches
 * @param {{ filterType?: string | null, topK: number }} opts
 */
export function shapeSearchResults(matches, { filterType = null, topK }) {
  const byKey = new Map();
  for (const m of matches || []) {
    const slug = m?.metadata?.slug;
    if (!slug) continue;
    const type = m.metadata.entity_type || 'skill';
    if (!filterType && HIDDEN_FROM_UNTYPED_SEARCH.includes(type)) continue;
    const key = `${type}:${slug}`;
    const prior = byKey.get(key);
    if (!prior || m.score > prior.score) byKey.set(key, m);
  }
  return [...byKey.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((m) => {
      const entityType = m.metadata.entity_type || 'skill';
      return {
        slug: m.metadata.slug,
        score: Math.round(m.score * 10000) / 10000, // 4 decimals
        name: m.metadata?.name || '',
        category: m.metadata?.category || null,
        quality_tier: m.metadata?.quality_tier || null,
        quality_score: m.metadata?.quality_score || null,
        repo_stars: m.metadata?.repo_stars || null,
        repo_full_name: m.metadata?.repo_full_name || null,
        description: m.metadata?.description || null,
        // F2 (DOD-7 / Smoke H): echo entity_type so cross-type clients can
        // discriminate without a second round-trip. Defaults to 'skill' for
        // legacy vectors uploaded before T8 populated the metadata field.
        entity_type: entityType,
        detail_url: detailPathFor(m.metadata.entity_type, m.metadata.slug),
      };
    });
}

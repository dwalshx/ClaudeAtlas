/**
 * scripts/lib/tier-assignment.js — Phase 3.2 (D-04 / B-1).
 *
 * Shared percentile tier assignment used by filter.js (skills),
 * filter-plugins.js, and filter-mcps.js.
 *
 * D-04: Uniform 10/30/60 tier split. NO small-N carve-out. NO special
 * case for entity_type='mcp_server'. At N=38 MCPs this produces 3
 * Featured / 11 Solid / 24 Listed; accepted (B-1 fix removed the old
 * `if N<10` round-up branch).
 *
 * The math mirrors filter.js Step 3 byte-for-byte:
 *   featuredTarget = Math.floor(N * 0.10)
 *   solidTarget    = Math.floor(N * 0.30)
 * Sort key: quality_score DESC, then repo_stars DESC, then id ASC (stable
 * boundary behaviour). The optional `renderableCap` reproduces filter.js's
 * defense-in-depth Solid-trim so the skill path stays byte-identical.
 */

const FEATURED_PERCENTILE = 0.10;
const SOLID_PERCENTILE = 0.30;

/**
 * Assign quality_tier to each record by percentile rank. Mutates in place.
 *
 * @param {Array<{quality_score?: number, repo_stars?: number, id?: string, quality_tier?: string}>} records
 * @param {{ renderableCap?: number }} [opts]
 * @returns {typeof records} the same array (for chaining)
 */
export function assignPercentileTiers(records, opts = {}) {
  if (!Array.isArray(records) || records.length === 0) return records;

  const tierOrder = records
    .map((s, i) => ({ i, score: s.quality_score, stars: s.repo_stars, id: s.id }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.stars !== a.stars) return b.stars - a.stars;
      return (a.id || '').localeCompare(b.id || '');
    });

  const total = tierOrder.length;
  const featuredTarget = Math.floor(total * FEATURED_PERCENTILE);
  const solidTarget = Math.floor(total * SOLID_PERCENTILE);

  // Defense in depth (skill parity): if a renderableCap is supplied and the
  // percentiles would exceed it, trim Solid first (preserve top-10% Featured).
  let effectiveFeatured = featuredTarget;
  let effectiveSolid = solidTarget;
  if (typeof opts.renderableCap === 'number') {
    effectiveFeatured = Math.min(featuredTarget, opts.renderableCap);
    effectiveSolid = Math.min(
      solidTarget,
      Math.max(0, opts.renderableCap - effectiveFeatured),
    );
  }
  const renderableCount = effectiveFeatured + effectiveSolid;

  for (let rank = 0; rank < total; rank++) {
    const s = records[tierOrder[rank].i];
    if (rank < effectiveFeatured) s.quality_tier = 'featured';
    else if (rank < renderableCount) s.quality_tier = 'solid';
    else s.quality_tier = 'listed';
  }

  return records;
}

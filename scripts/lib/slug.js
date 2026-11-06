import { hostOf } from './url-host.js';

/**
 * Phase 4.1 / D-05 — resolve the (owner, repo) pair that drives the slug.
 * Dispatch on entity_type BEFORE repo_full_name so an api with a known
 * GitHub repo still slugs as `<provider>/<name>` (not `<repo-owner>/<name>`).
 * `repo` is only used as the collision disambiguator (`owner/repo/name`).
 * NOTE: `name`/`provider`/`publisher` are NOT slugified here (doing so would
 * silently rewrite every skill slug) — harvesters must supply slug-safe values.
 */
function slugParts(s) {
  if (s.entity_type === 'api') {
    return { owner: s.extra?.provider || '', repo: hostOf(s.extra?.base_urls?.[0]) || s.origin?.source || '' };
  }
  if (s.entity_type === 'dataset') {
    return { owner: s.extra?.publisher || s.origin?.source || '', repo: s.origin?.source || '' };
  }
  const [owner = '', repo = ''] = (s.repo_full_name || '').split('/');
  return { owner, repo };
}

/**
 * Phase 3.1 — Path-aware slug assignment.
 *
 * Takes the full post-filter skills array and assigns globally-unique
 * slugs. Returns the redirect map (old→new) for the records whose slug
 * changed because of collision resolution.
 *
 * Slug rule:
 *   - When (owner, name) is unique across the catalog → `owner/name`
 *   - When (owner, name) collides → `owner/repo/name` (where `repo` is
 *     the non-owner segment of repo_full_name)
 *
 * Provenance note (Phase 3.1 Rev 2, FLAG 3): the "old slug" detection
 * here reads `s.slug` from input records, which at scrape time is
 * currently emitted as `owner/skillName` (per
 * `scripts/scrape-discover-repos.js:184` and `scripts/scrape.js:479`).
 * If the scrape-time slug formula ever changes, the redirect-map's
 * "old slug" set will silently stop matching production URLs. Coordinate
 * any scrape-side slug change with a one-time backfill of
 * `data/slug-redirects.json` from a snapshot of the previous production
 * state.
 *
 * Canonical winner (for the redirect map's old→new pair):
 *   - Highest quality_score wins
 *   - Tie-break: lexically-shorter repo_full_name (Q4 recommendation);
 *     null-repo feeds fall back to the shorter id (Phase 4.1 / D-07)
 *
 * Phase 4.1 (D-05 / D-07): the (owner, repo) pair that drives the slug now
 * comes from `slugParts(s)`, which dispatches on `entity_type` BEFORE
 * reading `repo_full_name`: api → `<provider>/<name>` (disambiguator =
 * primary base_url host), dataset → `<publisher>/<name>` (disambiguator =
 * origin.source), everything else → the unchanged `repo_full_name` split.
 * Slugs stay scoped PER ENTITY TYPE: production never mixes types in one
 * `assignSlugs` call (`filter.js` / `filter-plugins.js` / `filter-mcps.js`
 * / future `filter-apis.js` each pass their own array), so an api and a
 * skill sharing `owner/name` do not collide with each other.
 *
 * SIDE EFFECT: mutates `skill.slug` on every record. This is intentional
 * — filter.js wants the mutated array.
 *
 * @param {Array<object>} skills - Filtered skill records (each has
 *   repo_full_name, name, quality_score, slug, etc.)
 * @returns {{
 *   redirects: Object<string, string>, // old_slug -> new_slug
 *   collisionCount: number,            // number of distinct colliding (owner,name) pairs
 *   recordsChanged: number             // number of records whose slug changed
 * }}
 */
export function assignSlugs(skills) {
  // Step 1: Count (owner, name) occurrences
  const counts = new Map();
  for (const s of skills) {
    const { owner } = slugParts(s);
    if (!owner || !s.name) continue;
    const key = `${owner}/${s.name}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  // Step 2: For collision groups, gather members per (owner, name).
  const groups = new Map();
  for (const s of skills) {
    const { owner } = slugParts(s);
    if (!owner || !s.name) continue;
    const key = `${owner}/${s.name}`;
    if (counts.get(key) <= 1) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  // Step 3: Assign new slugs to every record.
  const redirects = {};
  let recordsChanged = 0;

  for (const s of skills) {
    const { owner, repo: repoName } = slugParts(s);
    if (!owner || !s.name) continue;
    const key = `${owner}/${s.name}`;
    const oldSlug = s.slug;
    if (counts.get(key) > 1) {
      // Collision form
      const newSlug = `${owner}/${repoName}/${s.name}`;
      if (oldSlug !== newSlug) {
        s.slug = newSlug;
        recordsChanged++;
      }
    } else {
      // Canonical form
      const newSlug = `${owner}/${s.name}`;
      if (oldSlug !== newSlug) {
        s.slug = newSlug;
        recordsChanged++;
      }
    }
  }

  // Step 4: Per collision group, pick canonical winner and emit redirect
  // entries. Winner: highest quality_score; tie-break lexically-shorter
  // repo_full_name (Phase 4.1 / D-07: null-repo feeds fall back to the
  // shorter id — skills are unaffected since repo_full_name is always set).
  for (const [key, members] of groups.entries()) {
    members.sort((a, b) => {
      const qDiff = (b.quality_score || 0) - (a.quality_score || 0);
      if (qDiff !== 0) return qDiff;
      return (a.repo_full_name ?? a.id ?? '').length - (b.repo_full_name ?? b.id ?? '').length;
    });
    const winner = members[0];
    redirects[key] = winner.slug;
  }

  return {
    redirects,
    collisionCount: groups.size,
    recordsChanged,
  };
}

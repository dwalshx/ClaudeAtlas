/**
 * scripts/lib/feeds/text.js — Phase 4.2 (4.2-M01). Tiny slug helpers shared
 * by the feed source parsers and the cross-source merge key.
 */

/** NFKD-decompose and strip combining marks ('é' → 'e'). */
export function foldAccents(s) {
  return String(s ?? '').normalize('NFKD').replace(/\p{M}+/gu, '');
}

/** foldAccents → lowercase → runs of non-[a-z0-9] become '-' → trim '-'. */
export function slugify(s) {
  return foldAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

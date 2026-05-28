/**
 * scripts/lib/tags.js — Tag namespace conventions for F2.
 *
 * Phase 3.1.2 — Polymorphic Entity Envelope.
 *
 * Tags are EntityRecord.tags[]: a flat array of `namespace:value` strings.
 * Namespaces in use today:
 *   - category:*           Migrated mechanically from the legacy `category` field.
 *   - framework:*          Methodology (e.g. framework:gsd, framework:hermes). Q3 decision.
 *   - integration:*        External services/APIs (e.g. integration:openai, integration:stripe).
 *   - language:*           Primary programming language (rare; lifted from repo_language).
 *   - source:*             Discovery source (code-search/topics/seed/etc). Audit-only; not for facets.
 *
 * Validation rules:
 *   - `namespace:value` shape; both non-empty.
 *   - namespace: lowercase a-z and underscores only (max 32 chars).
 *   - value: lowercase a-z 0-9 hyphens (max 64 chars).
 *
 * In F2 only `category:*` is populated mechanically. Other namespaces are
 * reserved for 3.4+.
 */

import { getCategorySlug, getAllCategories } from '../categorize.js';

// Display table — capitalized form for chips / SEO H1. Mirrors `CATEGORIES`
// keys in scripts/categorize.js plus the DEFAULT_CATEGORY.
export const CATEGORY_DISPLAY = Object.freeze({
  'code-and-development':    'Code & Development',
  'web-and-frontend':        'Web & Frontend',
  'testing-and-qa':          'Testing & QA',
  'data-and-documents':      'Data & Documents',
  'devops-and-infrastructure': 'DevOps & Infrastructure',
  'api-and-backend':         'API & Backend',
  'ai-and-automation':       'AI & Automation',
  'productivity-and-other':  'Productivity & Other',
});

const TAG_RE = /^([a-z][a-z_]{0,31}):([a-z0-9][a-z0-9-]{0,63})$/;

/**
 * Derive the `category:<slug>` tag from a legacy `category` string.
 *
 * @param {string | null | undefined} category   Pre-F2 category (e.g. 'AI & Automation').
 * @returns {string[]}  Always exactly one tag: `['category:<slug>']`. Empty array
 *                      when input is null/undefined/'' (caller can default).
 */
export function deriveTagsFromLegacyCategory(category) {
  if (!category) return [];
  const slug = getCategorySlug(category);
  if (!slug) return [];
  return [`category:${slug}`];
}

/**
 * Project the legacy `category` display string from a tags array.
 * Inverse of deriveTagsFromLegacyCategory; F2's EntityCommon.category field
 * is the result of this function.
 *
 * @param {string[]} tags
 * @returns {string | null}
 */
export function projectCategoryFromTags(tags) {
  if (!Array.isArray(tags)) return null;
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    if (t.startsWith('category:')) {
      const slug = t.slice('category:'.length);
      return CATEGORY_DISPLAY[slug] || null;
    }
  }
  return null;
}

/**
 * Validate a single tag against namespace conventions.
 *
 * @param {string} tag
 * @returns {boolean}
 */
export function validateTag(tag) {
  return typeof tag === 'string' && TAG_RE.test(tag);
}

/**
 * Merge multiple tag arrays, dedup, drop invalid entries, sort for stable diffs.
 *
 * @param {...string[]} arrays
 * @returns {string[]}
 */
export function mergeTags(...arrays) {
  const seen = new Set();
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const t of arr) {
      if (validateTag(t)) seen.add(t);
    }
  }
  return [...seen].sort();
}

/**
 * Return the full list of category slugs (for sitemap / facet generators).
 */
export function getAllCategorySlugs() {
  return getAllCategories().map(getCategorySlug);
}

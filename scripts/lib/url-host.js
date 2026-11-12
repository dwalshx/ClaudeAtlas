/**
 * scripts/lib/url-host.js — Phase 4.1. Tiny shared URL → hostname helper used
 * by the api upcaster id default, recipes/api.recipe.js computeId (D-05
 * `api:<primary_host>/<name>`) and slug.js's api collision disambiguator.
 * Never throws; '' for anything unparseable.
 */

/**
 * @param {unknown} url
 * @returns {string} hostname, or '' when `url` is not a parseable string
 */
export function hostOf(url) {
  if (typeof url !== 'string' || !url) return '';
  try { return new URL(url).hostname || ''; } catch { return ''; }
}

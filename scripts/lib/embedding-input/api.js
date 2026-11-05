/**
 * scripts/lib/embedding-input/api.js — Phase 4.1 / spec § Embedding input.
 *
 * api embedding-input builder:
 * name + provider + description + categories + first 10 endpoint
 * summaries, ~300 chars, `' | '` joined.
 *
 * `extra.endpoint_summaries` is NOT a 4.1 field — the builder reads it only
 * when present so 4.2 can add it without touching this file (orchestrator
 * decision 7). Missing provider → empty segment, never 'undefined'.
 */

/**
 * @param {any} rec  v2 EntityRecord<ApiExtra>.
 * @returns {string}
 */
export function buildApiEmbeddingInput(rec) {
  const e = rec?.extra || {};
  const cats = Array.isArray(e.categories_src) ? e.categories_src.filter((c) => typeof c === 'string') : [];
  const parts = [rec?.name || '', typeof e.provider === 'string' ? e.provider : '', rec?.description || '', cats.join(', ')];
  if (Array.isArray(e.endpoint_summaries) && e.endpoint_summaries.length) {
    parts.push(e.endpoint_summaries.filter((s) => typeof s === 'string').slice(0, 10).join('; '));
  }
  return parts.join(' | ').slice(0, 300);
}

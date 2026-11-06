/**
 * scripts/lib/recipes/api.recipe.js — Phase 4.1 api recipe.
 *
 * SHAPE-CONFORMANT STUB — discover() is empty; production harvesting lands
 * in scripts/harvest-apis.js (Phase 4.2). computeId implements D-05:
 *   api:<primary_host>/<name>   (host of extra.base_urls[0]; falls back to extra.provider)
 *
 * Must stay in parity with the upcaster default in
 * scripts/lib/legacy-skill-reader.js (`api:${hostOf(base_urls[0]) || provider}/${name}`)
 * so recipes[type].computeId(raw) === raw.id for every harvested record.
 */

import { hostOf } from '../url-host.js';

/** @type {import('../recipe-engine.js').DiscoveryRecipe} */
export const apiRecipe = {
  entity_type: 'api',
  output_path: 'data/apis-raw.ndjson',
  state_path: 'data/apis-raw.checkpoint.json',

  /** Empty generator — production harvesting is harvest-apis.js (4.2). */
  async *discover() {
    return;
  },

  /** No-op pass-through; harvest-apis.js owns parsing. */
  async parse(hit) {
    return hit ?? null;
  },

  /**
   * Canonical id per D-05: `api:<primary_host>/<name>`. primary_host is the
   * hostname of extra.base_urls[0]; when there is no parseable base URL
   * (public-apis-shaped minimal records) fall back to extra.provider.
   */
  computeId(rec) {
    const host = hostOf(rec?.extra?.base_urls?.[0]) || rec?.extra?.provider || '';
    return `api:${host}/${rec?.name || ''}`;
  },
};

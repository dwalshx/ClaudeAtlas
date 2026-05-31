/**
 * scripts/lib/recipes/plugin.recipe.js — Phase 3.2 plugin recipe.
 *
 * SHAPE-CONFORMANT STUB — discover() is intentionally empty; production
 * discovery lives in scripts/scrape-plugins.js. See Phase 3.2-PLAN F-7.
 *
 * The recipe exists so `recipes['plugin']` lookups resolve for future
 * cross-cutting tooling, and so computeId() centralises the canonical
 * plugin id format. The recipe-engine-driven path remains future work.
 */

/** @type {import('../recipe-engine.js').DiscoveryRecipe} */
export const pluginRecipe = {
  entity_type: 'plugin',
  // scrape-plugins.js writes mixed plugin + mcp_server records to one file,
  // discriminated by entity_type at read time.
  output_path: 'data/plugins-raw.ndjson',
  state_path: 'data/plugins-raw.checkpoint.json',

  /** Empty generator — production discovery is scrape-plugins.js. */
  async *discover() {
    return;
  },

  /** No-op pass-through; scrape-plugins.js owns parsing today. */
  async parse(hit) {
    return hit ?? null;
  },

  /**
   * Canonical id: `plugin:${repo_full_name}/${plugin_path}` per
   * src/lib/types.d.ts EntityCommon.id.
   */
  computeId(rec) {
    const repo = rec.repo_full_name || '';
    const path = rec.extra?.plugin_path || '';
    return `plugin:${repo}/${path}`;
  },
};

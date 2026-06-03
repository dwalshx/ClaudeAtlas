/**
 * scripts/lib/recipes/mcp.recipe.js — Phase 3.2 mcp_server recipe.
 *
 * SHAPE-CONFORMANT STUB — discover() is intentionally empty; production
 * discovery lives in scripts/scrape-plugins.js. See Phase 3.2-PLAN F-7.
 */

/** @type {import('../recipe-engine.js').DiscoveryRecipe} */
export const mcpRecipe = {
  entity_type: 'mcp_server',
  // Shares the plugins-raw file; records discriminated by entity_type.
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
   * Canonical id: `mcp_server:${repo_full_name}/${server_path}` per
   * src/lib/types.d.ts EntityCommon.id.
   */
  computeId(rec) {
    const repo = rec.repo_full_name || '';
    const path = rec.extra?.server_path || '';
    return `mcp_server:${repo}/${path}`;
  },
};

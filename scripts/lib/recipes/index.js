/**
 * scripts/lib/recipes/index.js — F2 recipe registry.
 *
 * Phase 3.1.2 (F2). Dispatch table keyed by entity_type. Plugin/MCP
 * recipes slot in here in 3.2+. Smoke D (T11) authors a local
 * plugin.recipe.js stub and asserts it loads via this same interface.
 *
 * Phase 4.1: api + dataset stubs (shape-conformant, empty discover(), real
 * D-05 computeId). Harvesters land in 4.2 (apis) and 4.5 (datasets).
 */

import { skillRecipe } from './skill.recipe.js';
import { pluginRecipe } from './plugin.recipe.js';
import { mcpRecipe } from './mcp.recipe.js';
import { apiRecipe } from './api.recipe.js';
import { datasetRecipe } from './dataset.recipe.js';

/** @type {Record<string, import('../recipe-engine.js').DiscoveryRecipe>} */
export const recipes = {
  skill: skillRecipe,
  plugin: pluginRecipe,
  mcp_server: mcpRecipe,
  api: apiRecipe,
  dataset: datasetRecipe,
};

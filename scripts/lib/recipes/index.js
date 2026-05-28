/**
 * scripts/lib/recipes/index.js — F2 recipe registry.
 *
 * Phase 3.1.2 (F2). Dispatch table keyed by entity_type. Plugin/MCP
 * recipes slot in here in 3.2+. Smoke D (T11) authors a local
 * plugin.recipe.js stub and asserts it loads via this same interface.
 */

import { skillRecipe } from './skill.recipe.js';

/** @type {Record<string, import('../recipe-engine.js').DiscoveryRecipe>} */
export const recipes = {
  skill: skillRecipe,
};

/**
 * scripts/lib/embedding-input/index.js — Phase 3.2 (D-09).
 *
 * Embedding-input registry. Dispatches by entity_type to the per-type
 * builder. Throws on an unknown type — silent fallthrough would produce
 * the wrong vector for a record (fail loud).
 *
 * Phase 4.1: api + dataset builders (spec § Embedding input, ~300 chars).
 */

import { buildSkillEmbeddingInput } from './skill.js';
import { buildPluginEmbeddingInput } from './plugin.js';
import { buildMcpEmbeddingInput } from './mcp.js';
import { buildApiEmbeddingInput } from './api.js';
import { buildDatasetEmbeddingInput } from './dataset.js';

/** @type {Record<string, (rec: any) => string>} */
export const builders = {
  skill: buildSkillEmbeddingInput,
  plugin: buildPluginEmbeddingInput,
  mcp_server: buildMcpEmbeddingInput,
  api: buildApiEmbeddingInput,
  dataset: buildDatasetEmbeddingInput,
};

/**
 * Dispatch by entity_type. Falls back to 'skill' when absent (legacy v1
 * records during the cutover window carry no entity_type). Throws on an
 * explicitly unknown type.
 *
 * @param {any} rec
 * @returns {string}
 */
export function buildEmbeddingInput(rec) {
  const t = rec?.entity_type || 'skill';
  const fn = builders[t];
  if (!fn) {
    throw new Error(`[embedding-input] no builder for entity_type=${t}`);
  }
  return fn(rec);
}

export {
  buildSkillEmbeddingInput,
  buildPluginEmbeddingInput,
  buildMcpEmbeddingInput,
  buildApiEmbeddingInput,
  buildDatasetEmbeddingInput,
};

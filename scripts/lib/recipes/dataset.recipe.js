/**
 * scripts/lib/recipes/dataset.recipe.js — Phase 4.1 dataset recipe.
 *
 * SHAPE-CONFORMANT STUB — discover() is empty; production harvesting lands
 * in scripts/harvest-datasets.js (Phase 4.5). computeId implements D-05:
 *   dataset:<source>/<native_id>   (origin.source / origin.source_id)
 *
 * Must stay in parity with the upcaster default in
 * scripts/lib/legacy-skill-reader.js (`dataset:${origin.source}/${origin.source_id}`)
 * so recipes[type].computeId(raw) === raw.id for every harvested record.
 */

/** @type {import('../recipe-engine.js').DiscoveryRecipe} */
export const datasetRecipe = {
  entity_type: 'dataset',
  output_path: 'data/datasets-raw.ndjson',
  state_path: 'data/datasets-raw.checkpoint.json',

  /** Empty generator — production harvesting is harvest-datasets.js (4.5). */
  async *discover() {
    return;
  },

  /** No-op pass-through; harvest-datasets.js owns parsing. */
  async parse(hit) {
    return hit ?? null;
  },

  /**
   * Canonical id per D-05: `dataset:<source>/<native_id>` — the source
   * portal/registry key plus its own native identifier (e.g.
   * `dataset:huggingface/nvidia/simready-assets`, `dataset:zenodo/23888170`).
   */
  computeId(rec) {
    return `dataset:${rec?.origin?.source || ''}/${rec?.origin?.source_id || ''}`;
  },
};

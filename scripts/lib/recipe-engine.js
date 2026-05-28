/**
 * scripts/lib/recipe-engine.js — F2 generic discovery + parse engine.
 *
 * Phase 3.1.2 (F2). Accepts a `DiscoveryRecipe` and produces a v2
 * EntityRecord NDJSON stream. The engine owns HTTP, ETag caching, rate
 * limiting, and checkpointing; recipes own discovery queries, parsing,
 * and id strategy.
 *
 * F2 keeps the recipe abstraction thin: the existing scripts/scrape.js
 * monolith remains the production entry point and now imports + calls
 * the skillRecipe's verbs as small helpers. The full recipe engine
 * (with HTTP/ETag/checkpoint primitives reified here) is reserved for
 * 3.2 when the second recipe (plugins) lands and a real abstraction
 * boundary becomes valuable.
 *
 * For F2, the public API is:
 *   - `runRecipe(recipe, opts)`  – minimal driver that invokes the
 *     recipe's discover() + parse() in a single in-process pass and
 *     emits records via writeNdjsonStreaming. Used by the smoke harness
 *     and by 3.2's plugin recipe. The legacy scripts/scrape.js still
 *     drives skill discovery end-to-end with its battle-tested ETag +
 *     checkpoint logic.
 *
 * @typedef {Object} DiscoveryRecipe
 * @property {string} entity_type           - Discriminator carried into output records.
 * @property {string} [output_path]         - Where the recipe writes its NDJSON.
 * @property {string} [state_path]          - Where the recipe checkpoints.
 * @property {() => AsyncIterable<any>} discover - Yields discovery hits.
 * @property {(hit: any) => Promise<any>}   parse    - Hit → parsed record.
 * @property {(rec: any) => string}         computeId - Record → unique id.
 */

import { writeNdjsonStreaming } from './ndjson.js';
import { buildHeader } from './entity-version.js';

/**
 * Drive a recipe end-to-end. Minimal v0 implementation; serves the
 * Smoke D requirement (a plugin recipe stub loads through this same
 * interface).
 *
 * @param {DiscoveryRecipe} recipe
 * @param {{ outputPath?: string, max?: number }} [opts]
 * @returns {Promise<{ records: number, output_path: string }>}
 */
export async function runRecipe(recipe, opts = {}) {
  if (!recipe || typeof recipe.discover !== 'function' || typeof recipe.parse !== 'function') {
    throw new Error('runRecipe: recipe must define discover() and parse()');
  }
  const outputPath = opts.outputPath || recipe.output_path;
  if (!outputPath) throw new Error('runRecipe: outputPath required');

  const max = opts.max || Infinity;
  const records = [];

  let count = 0;
  for await (const hit of recipe.discover()) {
    if (count >= max) break;
    const rec = await recipe.parse(hit);
    if (!rec) continue;
    if (!rec.entity_type) rec.entity_type = recipe.entity_type;
    if (!rec.id && typeof recipe.computeId === 'function') {
      rec.id = recipe.computeId(rec);
    }
    records.push(rec);
    count++;
  }

  writeNdjsonStreaming(outputPath, records, { header: buildHeader(recipe.entity_type) });
  return { records: records.length, output_path: outputPath };
}

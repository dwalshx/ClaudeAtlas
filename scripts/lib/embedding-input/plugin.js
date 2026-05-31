/**
 * scripts/lib/embedding-input/plugin.js — Phase 3.2 (D-09).
 *
 * Plugin embedding-input builder: `${name} | ${description} | ${keywords}`,
 * trimmed to ~200 chars.
 */

/**
 * @param {any} rec  v2 EntityRecord<PluginExtra>.
 * @returns {string}
 */
export function buildPluginEmbeddingInput(rec) {
  const keywords = (rec?.extra?.manifest?.keywords || []).join(', ');
  const parts = [rec?.name || '', rec?.description || '', keywords];
  return parts.join(' | ').slice(0, 200);
}

/**
 * scripts/lib/embedding-input/dataset.js — Phase 4.1 / spec § Embedding input.
 *
 * dataset embedding-input builder:
 * name + publisher + description + tags (category: prefix stripped) +
 * access.formats, ~300 chars, `' | '` joined.
 *
 * Missing publisher → empty segment, never 'undefined'.
 */

/**
 * @param {any} rec  v2 EntityRecord<DatasetExtra>.
 * @returns {string}
 */
export function buildDatasetEmbeddingInput(rec) {
  const e = rec?.extra || {};
  const tags = (Array.isArray(rec?.tags) ? rec.tags : [])
    .filter((t) => typeof t === 'string')
    .map((t) => (t.startsWith('category:') ? t.slice('category:'.length) : t));
  const formats = Array.isArray(rec?.access?.formats) ? rec.access.formats.filter((f) => typeof f === 'string') : [];
  return [rec?.name || '', typeof e.publisher === 'string' ? e.publisher : '', rec?.description || '', tags.join(', '), formats.join(', ')]
    .join(' | ')
    .slice(0, 300);
}

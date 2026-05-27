/**
 * scripts/lib/entity-version.js — F2 schema_version constants + helpers.
 *
 * Phase 3.1.2 — Polymorphic Entity Envelope.
 *
 * The canonical helper used by every NDJSON writer in F2 (via F1's
 * `writeNdjsonStreaming({ header: buildHeader(...) })`). Pairs with F1
 * Rev 3's `_header: true` sentinel mechanism in scripts/lib/ndjson.js.
 */

export const CURRENT_SCHEMA_VERSION = 2;
export const VERSION_HEADER_KEY = '_header';

/**
 * True when the given parsed NDJSON record is the file-header sentinel.
 *
 * @param {any} rec
 * @returns {boolean}
 */
export function isHeaderRecord(rec) {
  return Boolean(rec) && rec[VERSION_HEADER_KEY] === true;
}

/**
 * Build the canonical header payload to pass as `opts.header` to F1's
 * `writeNdjsonStreaming`. F1 forces `_header: true` itself; callers
 * only supply the data fields.
 *
 * @param {string | null} [entity_type]   Optional per-file entity_type hint.
 *   For mixed-type files (post-3.2), pass `null` to mark the file as
 *   heterogeneous; per-record `entity_type` is authoritative.
 * @returns {{ _header: true, schema_version: number, entity_type: string | null, generated_at: string }}
 */
export function buildHeader(entity_type = null) {
  return {
    _header: true,
    schema_version: CURRENT_SCHEMA_VERSION,
    entity_type,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Throws if the parsed header carries an unrecognized schema_version.
 * Pass via `opts.onHeader` to `readNdjsonRecords` for fail-closed reads.
 *
 * @param {any} headerRec
 * @throws {Error}
 */
export function assertKnownSchemaVersion(headerRec) {
  if (!isHeaderRecord(headerRec)) return;
  const v = headerRec.schema_version;
  if (v !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Unknown schema_version=${v} (expected ${CURRENT_SCHEMA_VERSION}). ` +
      `Refusing to load. Update scripts/lib/entity-version.js or migrate the file.`,
    );
  }
}

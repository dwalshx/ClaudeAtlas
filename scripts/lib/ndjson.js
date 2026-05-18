/**
 * scripts/lib/ndjson.js — F1 streaming foundation
 *
 * Chunked NDJSON I/O helpers. Lifted from the archived embed-skills.js fix
 * (commit cf76247 on `phase-3.1-archive`), generalized with an optional
 * keyFn for the read-side Map and a `_header` sentinel mechanism that F2
 * uses to embed a schema_version line at the top of data files without
 * sidecar files.
 *
 * Why chunked I/O:
 *   At catalog sizes >~50k records, NDJSON files cross V8's ~536 MB
 *   single-string limit. Both `readFileSync(path, 'utf-8').split('\n')`
 *   and `records.map(JSON.stringify).join('\n')` materialize one giant
 *   string and crash with `RangeError: Invalid string length`. Same
 *   shape as the 3.0.x etag-cache bug (Bug 4 of the infrastructure
 *   trilogy); fix mirrors commit 82cc7ab.
 *
 *   See also: Research §A (V8 risk-site inventory) in
 *   `.planning/research/2026-05-17-pipeline-scaling-polymorphic-entities.md`.
 *
 * Header sentinel (Rev 3 — F1↔F2 contract):
 *   The first line of an NDJSON file MAY be a JSON object with
 *   `_header: true`. This is reserved for the schema_version mechanism
 *   owned by F2. F1 only provides the mechanism:
 *     - `readNdjsonRecords` skips ANY line whose parsed object has
 *       `_header === true` (defensive — not just line 1).
 *     - If `opts.onHeader` is provided, the callback is invoked exactly
 *       once for the first header record encountered.
 *     - `writeNdjsonStreaming(path, records, { header: {...} })` writes
 *       `{ _header: true, ...header }` as line 1 before iterating
 *       records. `_header: true` is always set by the writer so callers
 *       cannot accidentally produce a non-header header.
 *   The `_header` key is RESERVED. No real record may use it. See
 *   CLAUDE.md "Pipeline footguns" section.
 */

import {
  existsSync,
  openSync,
  readSync,
  writeSync,
  closeSync,
  renameSync,
  mkdirSync,
} from 'node:fs';
import { dirname } from 'node:path';

const READ_CHUNK = 64 * 1024;

/**
 * Read an NDJSON file into a Map keyed by `opts.keyFn(record)` (defaults
 * to record.id). Records with `_header: true` are filtered; if
 * `opts.onHeader` is provided it is invoked with the first such record
 * (and subsequent header records are silently skipped).
 *
 * Returns an empty Map if the file does not exist (consistent with the
 * archived embed-skills.js semantics — resumable workflows).
 *
 * @param {string} path
 * @param {{ keyFn?: (rec: any) => string, onHeader?: (h: any) => void }} [opts]
 * @returns {Map<string, any>}
 */
export function readNdjsonRecords(path, opts = {}) {
  const keyFn = opts.keyFn || ((r) => r.id);
  const onHeader = opts.onHeader;
  let headerSeen = false;

  const map = new Map();
  if (!existsSync(path)) return map;

  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(READ_CHUNK);
    let leftover = '';
    let pos = 0;

    while (true) {
      const n = readSync(fd, buf, 0, READ_CHUNK, pos);
      if (n === 0) break;
      pos += n;

      const text = leftover + buf.slice(0, n).toString('utf-8');
      const lines = text.split('\n');
      leftover = lines.pop();

      for (const line of lines) {
        if (!line) continue;
        ingestLine(line, map, keyFn, onHeader, (saw) => { if (saw) headerSeen = true; });
      }
    }

    if (leftover) {
      ingestLine(leftover, map, keyFn, onHeader, (saw) => { if (saw) headerSeen = true; });
    }
  } finally {
    closeSync(fd);
  }

  // Touch headerSeen so linters don't strip it; reserved for future use.
  void headerSeen;
  return map;
}

function ingestLine(line, map, keyFn, onHeader, markHeader) {
  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    // Skip malformed lines (matches archived embed-skills.js behaviour;
    // resumable workflows must tolerate truncated final lines).
    return;
  }
  if (rec && rec._header === true) {
    if (onHeader) {
      try { onHeader(rec); } catch { /* swallow — onHeader errors don't poison the read */ }
    }
    markHeader(true);
    return;
  }
  if (!rec) return;
  const key = keyFn(rec);
  if (key !== undefined && key !== null && key !== '') {
    map.set(key, rec);
  }
}

/**
 * Write `records` to `path` as NDJSON via per-record writeSync. Uses
 * tmp+rename for atomicity. If `opts.header` is provided it is written
 * as the first line with `_header: true` forced on (the writer owns
 * setting the sentinel, callers only pass the payload — schema_version,
 * written_at, etc).
 *
 * `records` may be any iterable (array, generator, Map.values()).
 *
 * @param {string} path
 * @param {Iterable<any>} records
 * @param {{ header?: object }} [opts]
 */
export function writeNdjsonStreaming(path, records, opts = {}) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const tmp = path + '.tmp';
  const fd = openSync(tmp, 'w');
  try {
    if (opts.header) {
      const headerRec = { ...opts.header, _header: true };
      writeSync(fd, JSON.stringify(headerRec) + '\n');
    }
    for (const r of records) {
      // Defensive: never let a real record carry _header: true to disk.
      if (r && r._header === true) continue;
      writeSync(fd, JSON.stringify(r) + '\n');
    }
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

/**
 * Open an NDJSON file for streaming append. Returned fd must be passed
 * to {@link appendNdjsonLine} and {@link closeNdjsonAppend}.
 *
 * This is the scraper-resume path: the file grows as records are
 * discovered; the process can crash and the file is still valid NDJSON
 * up to the last complete line.
 *
 * @param {string} path
 * @returns {number} file descriptor
 */
export function openNdjsonAppend(path) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return openSync(path, 'a');
}

/**
 * Append a single record as one NDJSON line.
 *
 * @param {number} fd
 * @param {any} record
 */
export function appendNdjsonLine(fd, record) {
  if (record && record._header === true) {
    throw new Error('appendNdjsonLine: _header records cannot be appended; use writeNdjsonStreaming with opts.header at file creation.');
  }
  writeSync(fd, JSON.stringify(record) + '\n');
}

/**
 * Close an NDJSON append handle.
 *
 * @param {number} fd
 */
export function closeNdjsonAppend(fd) {
  closeSync(fd);
}

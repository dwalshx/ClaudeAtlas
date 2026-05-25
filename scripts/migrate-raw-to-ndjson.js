#!/usr/bin/env node
/**
 * One-shot migration: data/skills-raw.json (JSON array) → data/skills-raw.ndjson.
 *
 * Why this exists: skills-raw.json grew past V8's ~536 MB string ceiling on
 * the GHA runner around 2026-05-20. JSON.parse(readFileSync('utf-8')) crashes
 * with ERR_STRING_TOO_LONG. Phase 03.1.1 T4 migrates the file format to
 * NDJSON (one record per line, chunked I/O via scripts/lib/ndjson.js).
 *
 * This script is kept in the repo for audit trail. Run once locally before
 * T4 ships; subsequent reads/writes use the NDJSON format directly.
 *
 * Implementation: streaming JSON-array parser. Reads input in 64 KB chunks,
 * scans for top-level `{...}` objects via brace-depth counting (string-aware),
 * yields each parsed record, writes to NDJSON via writeNdjsonStreaming.
 * Never materializes the full input as a single string.
 *
 * Usage:
 *   node scripts/migrate-raw-to-ndjson.js [input] [output]
 *     Default input:  data/skills-raw.json
 *     Default output: data/skills-raw.ndjson
 */

import { openSync, readSync, closeSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeNdjsonStreaming } from './lib/ndjson.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

/**
 * Generator: streams top-level objects out of a JSON-array file.
 * Brace-depth tracker is string-aware (treats `{` and `}` inside string
 * literals as text). Escapes (`\"`, `\\`) are handled.
 *
 * @param {string} path
 * @yields {object} parsed top-level objects from the array
 */
function* streamJsonArrayObjects(path) {
  const fd = openSync(path, 'r');
  try {
    const CHUNK = 64 * 1024;
    const buf = Buffer.alloc(CHUNK);
    const accChars = []; // char-array accumulator for one in-progress object
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let started = false;
    let pos = 0;

    while (true) {
      const n = readSync(fd, buf, 0, CHUNK, pos);
      if (n === 0) break;
      pos += n;
      const text = buf.slice(0, n).toString('utf-8');

      for (let i = 0; i < text.length; i++) {
        const c = text[i];

        // Skip array-level structure characters (the outer `[`, `]`, `,`,
        // and whitespace between objects) when we're not inside an object.
        if (!started) {
          if (c === '[') started = true;
          continue;
        }
        if (depth === 0) {
          if (c === ',' || c === ']' || c === '\n' || c === '\r' || c === ' ' || c === '\t') {
            continue;
          }
        }

        accChars.push(c);

        if (escapeNext) { escapeNext = false; continue; }
        if (inString) {
          if (c === '\\') escapeNext = true;
          else if (c === '"') inString = false;
          continue;
        }
        if (c === '"') { inString = true; continue; }
        if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) {
            const objText = accChars.join('');
            accChars.length = 0;
            yield JSON.parse(objText);
          }
        }
      }
    }

    if (depth !== 0) {
      throw new Error(`migration: unterminated object (depth=${depth} at EOF)`);
    }
  } finally {
    closeSync(fd);
  }
}

function mb(bytes) { return (bytes / (1024 * 1024)).toFixed(1); }

function main() {
  const inputArg = process.argv[2];
  const outputArg = process.argv[3];
  const input = inputArg || join(REPO_ROOT, 'data', 'skills-raw.json');
  const output = outputArg || join(REPO_ROOT, 'data', 'skills-raw.ndjson');

  if (!existsSync(input)) {
    console.error(`[migrate] FATAL: input ${input} does not exist`);
    process.exit(1);
  }

  const inputSize = statSync(input).size;
  console.log(`[migrate] input:  ${input} (${mb(inputSize)} MB)`);
  console.log(`[migrate] output: ${output}`);

  const startTime = Date.now();
  let count = 0;
  function* counting() {
    for (const rec of streamJsonArrayObjects(input)) {
      count++;
      if (count % 5000 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[migrate]   ${count} records parsed (${elapsed}s)`);
      }
      yield rec;
    }
  }

  writeNdjsonStreaming(output, counting());

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const outputSize = statSync(output).size;
  console.log(`[migrate] done: ${count} records, ${mb(outputSize)} MB written in ${elapsed}s`);
}

main();

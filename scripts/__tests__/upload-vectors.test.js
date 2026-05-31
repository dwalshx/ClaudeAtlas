/**
 * scripts/__tests__/upload-vectors.test.js
 *
 * Phase 3.2 Task 10. upload-vectors.js --input + --dry-run: the would-be
 * Vectorize payload must carry metadata.entity_type so the worker's ?type=
 * filter resolves for plugins + MCPs. Subprocess dry-run (no CF creds needed).
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const UPLOAD = join(ROOT, 'scripts', 'upload-vectors.js');
const PLUGIN_VECTORS = join(ROOT, 'data', '__fixtures__', 'plugin-vectors-mini.ndjson');

function runUpload(args) {
  // Strip CF creds so the run is forced into dry-run regardless of local env.
  const env = { ...process.env };
  delete env.CF_ACCOUNT_ID;
  delete env.CF_API_TOKEN;
  return execFileSync('node', [UPLOAD, ...args], {
    cwd: ROOT, env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('Task 10: dry-run reports metadata.entity_type=plugin and makes no API call', () => {
  const log = runUpload(['--input', PLUGIN_VECTORS, '--dry-run']);
  assert.match(log, /entity_type=plugin/);
  assert.match(log, /"plugin":3/);
  assert.match(log, /no Vectorize API calls made/);
  assert.match(log, /would upsert 3 vectors/);
});

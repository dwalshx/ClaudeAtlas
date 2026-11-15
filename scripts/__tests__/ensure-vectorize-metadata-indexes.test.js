/**
 * scripts/__tests__/ensure-vectorize-metadata-indexes.test.js
 *
 * 2026-11-15: every filtered /api/v1/search (?type, ?tier, ?category) returned
 * 0 matches because the Vectorize index had no metadata indexes. Pins the
 * planner and the workflow step that runs it before the vector upload.
 *
 * readFileSync on the YAML / worker source is allowed (__tests__ allowlist,
 * not under data/). `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  planMetadataIndexes,
  REQUIRED_METADATA_INDEXES,
  MAX_METADATA_INDEXES,
} from '../ensure-vectorize-metadata-indexes.js';

const ROOT = join(import.meta.dirname, '..', '..');

test('no existing metadata indexes → all three filter properties are created as string indexes', () => {
  const plan = planMetadataIndexes([]);
  assert.deepEqual(plan.map((m) => `${m.propertyName}:${m.indexType}`), ['entity_type:string', 'quality_tier:string', 'category:string']);
});

test('idempotent: existing indexes are skipped, only the missing one is planned', () => {
  const plan = planMetadataIndexes([
    { propertyName: 'entity_type', indexType: 'string' },
    { propertyName: 'category', indexType: 'String' },
    { propertyName: 'unrelated', indexType: 'number' },
  ]);
  assert.deepEqual(plan.map((m) => m.propertyName), ['quality_tier']);
  assert.deepEqual(planMetadataIndexes(REQUIRED_METADATA_INDEXES), []);
});

test('a required property indexed with the wrong type throws instead of silently passing', () => {
  assert.throws(() => planMetadataIndexes([{ propertyName: 'quality_tier', indexType: 'number' }]), /expected string/);
});

test('refuses to exceed the 10-metadata-index limit', () => {
  const full = Array.from({ length: MAX_METADATA_INDEXES - 1 }, (_, i) => ({ propertyName: `p${i}`, indexType: 'string' }));
  assert.throws(() => planMetadataIndexes(full), /10-index limit/);
});

test('the required set covers every metadata key the worker search filters on', () => {
  const src = readFileSync(join(ROOT, 'worker', 'index.js'), 'utf-8');
  const keys = [...src.matchAll(/filter\.([a-z_]+) = \{ \$eq:/g)].map((m) => m[1]).sort();
  assert.deepEqual(keys, REQUIRED_METADATA_INDEXES.map((m) => m.propertyName).sort());
});

test('daily-scrape runs the ensure step (main-only, non-fatal) immediately before the vector upload', () => {
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'daily-scrape.yml'), 'utf-8');
  assert.match(
    yml,
    /- name: Ensure Vectorize metadata indexes\r?\n\s+if: github\.event_name != 'push' && github\.ref == 'refs\/heads\/main'\r?\n\s+continue-on-error: true\r?\n\s+run: node scripts\/ensure-vectorize-metadata-indexes\.js\r?\n[\s\S]*?CF_API_TOKEN[^\n]*\r?\n\r?\n(?:\s+#[^\n]*\r?\n)*\s+- name: Upload vectors to Vectorize/,
  );
});

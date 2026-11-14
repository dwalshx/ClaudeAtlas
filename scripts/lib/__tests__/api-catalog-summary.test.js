/**
 * scripts/lib/__tests__/api-catalog-summary.test.js — Phase 4.3.
 *
 * summarizeApiCatalog() answers "does this build ship api records?" for the
 * llms.txt + registry generators. null ⇒ emit no api content.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { summarizeApiCatalog } from '../api-catalog-summary.js';

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'api-summary-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('4.3: summarizeApiCatalog returns null when apis.ndjson is absent', () => {
  withTmp((dir) => {
    assert.equal(summarizeApiCatalog(join(dir, 'apis.ndjson')), null);
  });
  assert.equal(summarizeApiCatalog(null), null);
  assert.equal(summarizeApiCatalog(undefined), null);
});

test('4.3: summarizeApiCatalog returns null for a header-only file', () => {
  withTmp((dir) => {
    const p = join(dir, 'apis.ndjson');
    writeFileSync(p, JSON.stringify({ _header: true, schema_version: 2, entity_type: 'api' }) + '\n');
    assert.equal(summarizeApiCatalog(p), null);
  });
});

test('4.3: summarizeApiCatalog counts api records and tiers (header skipped, non-api ignored)', () => {
  withTmp((dir) => {
    const p = join(dir, 'apis.ndjson');
    const lines = [
      { _header: true, schema_version: 2, entity_type: 'api' },
      { id: 'api:a.com/a', entity_type: 'api', quality_tier: 'featured' },
      { id: 'api:b.com/b', entity_type: 'api', quality_tier: 'solid' },
      { id: 'api:c.com/c', entity_type: 'api', quality_tier: 'listed' },
      { id: 'api:d.com/d', entity_type: 'api', quality_tier: 'listed' },
      { id: 'api:e.com/e', entity_type: 'api', quality_tier: null },
      { id: 'skill:x/y/z', entity_type: 'skill', quality_tier: 'featured' },
    ];
    writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    assert.deepEqual(summarizeApiCatalog(p), {
      count: 5,
      tiers: { featured: 1, solid: 1, listed: 2 },
    });
  });
});

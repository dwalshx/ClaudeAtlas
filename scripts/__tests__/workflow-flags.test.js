/**
 * scripts/__tests__/workflow-flags.test.js
 *
 * Phase 4.1 Plan 01 (4.1-M12 / D-08). Asserts the daily-scrape workflow
 * carries the DATA_FEEDS_ENABLED feature flag directly under PLUGINS_ENABLED
 * and that NO step is gated on it yet (Phase 4.2 adds the steps).
 *
 * Written RED (D-07 test-first); Plan 08 turns the flag-present and
 * spec-pointer tests green.
 *
 * readFileSync(..., 'utf-8') on the YAML is allowed here: the path matches
 * the `__tests__` allowlist in scripts/check-banned-patterns.js and the file
 * is not under data/.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const yml = readFileSync(join(ROOT, '.github', 'workflows', 'daily-scrape.yml'), 'utf-8');

test('4.1-M12: daily-scrape job env declares DATA_FEEDS_ENABLED false directly under PLUGINS_ENABLED', () => {
  assert.match(yml, /^\s+PLUGINS_ENABLED: 'true'\r?\n(?:\s+#[^\n]*\r?\n)*\s+DATA_FEEDS_ENABLED: 'false'\s*$/m);
});

test('4.1-M12: no step is gated on DATA_FEEDS_ENABLED yet (4.2 adds the steps)', () => {
  assert.equal((yml.match(/env\.DATA_FEEDS_ENABLED/g) || []).length, 0);
});

test('4.1-M12: the flag comment points at the v4.0 spec', () => {
  assert.ok(yml.includes('docs/PHASE-4.0-SPEC.md'));
});

test("4.1-M12: PLUGINS_ENABLED stays true (flag is additive)", () => {
  assert.ok(yml.includes("PLUGINS_ENABLED: 'true'"));
});

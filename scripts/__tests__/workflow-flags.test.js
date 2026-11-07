/**
 * scripts/__tests__/workflow-flags.test.js
 *
 * Phase 4.2 Plan 12 (4.2-M10 / D-07, orchestrator decision 1). Rewritten from
 * the 4.1-M12 no-steps contract. Pins: the DATA_FEEDS_ENABLED job env resolves
 * from the `data_feeds` workflow_dispatch input with a 'false' fallback (so
 * schedule/push runs on main are unchanged), exactly 10 steps are gated on it,
 * the api legs invoke the four scripts, and .gitignore covers every 4.2 data
 * artifact.
 *
 * readFileSync(..., 'utf-8') on the YAML / .gitignore is allowed here: the
 * path matches the `__tests__` allowlist in scripts/check-banned-patterns.js
 * and neither file is under data/.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const yml = readFileSync(join(ROOT, '.github', 'workflows', 'daily-scrape.yml'), 'utf-8');

test("4.2-M10: job env resolves DATA_FEEDS_ENABLED from the data_feeds dispatch input with a 'false' fallback, directly under PLUGINS_ENABLED", () => {
  assert.match(yml, /^\s+PLUGINS_ENABLED: 'true'\r?\n(?:\s+#[^\n]*\r?\n)*\s+DATA_FEEDS_ENABLED: \$\{\{ inputs\.data_feeds \|\| 'false' \}\}\s*$/m);
});

test('4.2-M10: workflow_dispatch declares the data_feeds boolean input defaulting to false', () => {
  assert.match(yml, /data_feeds:\r?\n\s+description: [^\n]+\r?\n\s+type: boolean\r?\n\s+default: false/);
});

test('4.2-M10: exactly 10 steps are gated on DATA_FEEDS_ENABLED (8 pipeline + 2 main-only publish)', () => {
  const total = (yml.match(/env\.DATA_FEEDS_ENABLED == 'true'/g) || []).length;
  const plain = (yml.match(/^\s+if: \$\{\{ env\.DATA_FEEDS_ENABLED == 'true' && github\.event_name != 'push' \}\}\s*$/gm) || []).length;
  const saves = (yml.match(/^\s+if: \$\{\{ always\(\) && env\.DATA_FEEDS_ENABLED == 'true' && github\.event_name != 'push' && hashFiles\('data\/(apis-raw|api-vectors)\.ndjson'\) != '' \}\}\s*$/gm) || []).length;
  const publish = (yml.match(/^\s+if: \$\{\{ env\.DATA_FEEDS_ENABLED == 'true' && github\.event_name != 'push' && github\.ref == 'refs\/heads\/main' \}\}\s*$/gm) || []).length;
  assert.equal(plain, 6, 'restore apis-raw, harvest, filter, restore api-vectors, embed, enrich');
  assert.equal(saves, 2, 'save apis-raw, save api-vectors');
  assert.equal(publish, 2, 'tag apis-latest-prev, publish apis-latest');
  assert.equal(plain + saves + publish, 10);
  assert.equal(total, 10);
});

test('4.2-M10: upload loop lists data/api-vectors.ndjson and the api steps invoke the four scripts', () => {
  for (const s of [
    'for f in data/skill-vectors.ndjson data/plugin-vectors.ndjson data/mcp-vectors.ndjson data/api-vectors.ndjson; do',
    'node scripts/harvest-apis.js',
    'node scripts/filter-apis.js',
    'node scripts/embed-skills.js --entity-type api',
    'node scripts/enrich.js --input data/api-vectors.ndjson --records data/apis.ndjson --entity-type api',
    'gh release upload --clobber apis-latest data/apis.ndjson',
    'apis-latest-prev',
  ]) {
    assert.ok(yml.includes(s), s);
  }
  assert.match(
    yml,
    /- name: Fetch apis-latest release asset \(push-event path\)\r?\n\s+if: github\.event_name == 'push'\r?\n\s+continue-on-error: true\r?\n[\s\S]*?gh release download apis-latest/,
  );
});

test('4.1-M12: the flag comment points at the v4.0 spec and PLUGINS_ENABLED stays true (flag is additive)', () => {
  assert.ok(yml.includes('docs/PHASE-4.0-SPEC.md'));
  assert.ok(yml.includes("PLUGINS_ENABLED: 'true'"));
});

test('4.2-M10: .gitignore lists every 4.2 data artifact', () => {
  const lines = readFileSync(join(ROOT, '.gitignore'), 'utf-8').split(/\r?\n/).map((l) => l.trim());
  for (const p of [
    'data/apis-raw.ndjson',
    'data/apis-raw.ndjson.partial',
    'data/apis-raw.catalog-only.ndjson',
    'data/apis.ndjson',
    'data/api-vectors.ndjson',
    'data/feeds-etag-cache.ndjson',
    'data/feeds-etag-cache.json',
  ]) {
    assert.ok(lines.includes(p), `.gitignore missing ${p}`);
  }
});

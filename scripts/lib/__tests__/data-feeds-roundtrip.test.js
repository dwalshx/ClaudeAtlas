/**
 * scripts/lib/__tests__/data-feeds-roundtrip.test.js
 *
 * Phase 4.1 Plan 01 — D-07 test-first round-trip for the `api` and `dataset`
 * entity types. This file is the executable specification for Plans 04-07:
 * it imports the exact module paths and export names those plans must
 * create and is EXPECTED TO BE RED until they land.
 *
 * Pipeline exercised per type (fixtures in data/__fixtures__/*-mini.ndjson):
 *   readNdjsonRecords → upcastRecord → isSlop → scoreEntity →
 *   buildEmbeddingInput → assignPercentileTiers → assignSlugs →
 *   buildItem / buildWhatsNew / aggregateSnapshot / linkBundles /
 *   compareForCanonical / buildRegistryEntry →
 *   writeNdjsonStreaming → readNdjsonRecords
 * asserting `repo_*: null` survives every hop for non-GitHub origins.
 *
 * Do NOT import the KV publisher module or the Astro-side entity loader
 * here — both execute on import (Research Pitfall 5).
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readNdjsonRecords, writeNdjsonStreaming } from '../ndjson.js';
import { buildHeader, CURRENT_SCHEMA_VERSION } from '../entity-version.js';
import { upcastRecord } from '../legacy-skill-reader.js';
import { scoreEntity } from '../scorers/index.js';
import { buildEmbeddingInput } from '../embedding-input/index.js';
import { isSlop } from '../filter-rules/index.js';
import { assignPercentileTiers } from '../tier-assignment.js';
import { assignSlugs } from '../slug.js';
import { recipes } from '../recipes/index.js';
import { linkBundles } from '../bundled-links.js';
import { buildItem, buildWhatsNew } from '../../generate-feeds.js';
import { aggregateSnapshot } from '../../snapshot-catalog.js';
import { compareForCanonical } from '../../enrich.js';
import { buildRegistryEntry } from '../../generate-registry.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');

// All 16 repo_* fields on EntityCommon.
const REPO_KEYS = [
  'repo_full_name', 'repo_url', 'repo_stars', 'repo_forks', 'repo_open_issues',
  'repo_topics', 'repo_license', 'repo_language', 'repo_created_at',
  'repo_updated_at', 'repo_pushed_at', 'repo_owner_type', 'repo_owner_avatar',
  'repo_archived', 'repo_is_fork', 'repo_description',
];
// Revision 1 (B2): repo_license / repo_language / repo_description are
// `?? null` in buildCommonFields AND the skill inline list for EVERY type, so
// they are legitimately null on minimal inputs. Non-null assertions for
// github-origin records cover the 13 COERCED keys only.
const REPO_KEYS_COERCED = REPO_KEYS.filter(
  (k) => !['repo_license', 'repo_language', 'repo_description'].includes(k),
); // 13 keys

function load(file) {
  return [...readNdjsonRecords(join(ROOT, 'data', '__fixtures__', file)).values()];
}

/**
 * Recursively assert that no value anywhere in `obj` is `undefined`.
 * `undefined` is silently dropped by JSON.stringify, so a field that is
 * undefined in memory would vanish from the on-disk NDJSON — the disk hop
 * deepEqual below would then pass for the wrong reason. Naming the path
 * makes the failure actionable.
 */
function assertNoUndefined(obj, path = '') {
  if (obj === undefined) {
    assert.fail(`undefined value at ${path || '<root>'}`);
  }
  if (obj === null || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => assertNoUndefined(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    assertNoUndefined(v, path ? `${path}.${k}` : k);
  }
}

// ---------------------------------------------------------------------------
// 1. Fixtures load
// ---------------------------------------------------------------------------

test('4.1-M11: fixtures load — 4 api + 4 dataset records, header filtered', () => {
  const apis = load('apis-mini.ndjson');
  const datasets = load('datasets-mini.ndjson');
  assert.equal(apis.length, 4);
  assert.equal(datasets.length, 4);
  for (const r of [...apis, ...datasets]) {
    assert.ok(!('_header' in r), `header sentinel leaked into record ${r.id}`);
  }
});

// ---------------------------------------------------------------------------
// 2. Recipe computeId reproduces fixture ids (D-05)
// ---------------------------------------------------------------------------

test('4.1-M08/D-05: recipe computeId reproduces every fixture id', () => {
  for (const r of load('apis-mini.ndjson')) {
    assert.equal(recipes.api.computeId(r), r.id);
  }
  for (const r of load('datasets-mini.ndjson')) {
    assert.equal(recipes.dataset.computeId(r), r.id);
  }
});

// ---------------------------------------------------------------------------
// 3. Full round-trip per type (D-07)
// ---------------------------------------------------------------------------

const EXPECTED_SLUGS = {
  api: ['stripe.com/stripe', 'insee/melodi', 'github.com/github'],
  dataset: [
    'nvidia/simready-assets',
    'data.wa.gov/electric-vehicle-population',
    'noaa/ghcn-daily',
    'zenodo/archi-v2',
  ],
};

for (const [file, type, expectedKept] of [
  ['apis-mini.ndjson', 'api', 3],
  ['datasets-mini.ndjson', 'dataset', 4],
]) {
  test(`4.1-M10: ${type} fixtures round-trip every shared helper with repo_*: null`, () => {
    // --- upcast -----------------------------------------------------------
    const recs = load(file).map(upcastRecord);
    assert.equal(recs.length, 4);

    for (const r of recs) {
      assert.equal(r.entity_type, type);
      assert.equal(r.schema_version, CURRENT_SCHEMA_VERSION);
      assert.equal(typeof r.origin.kind, 'string', `${r.id} origin.kind`);
      assert.equal(typeof r.home_url, 'string', `${r.id} home_url`);
      assert.ok('docs_url' in r, `${r.id} docs_url present`);
      assert.ok(!('raw_source' in r), `${r.id} raw_source dropped by field whitelist`);
      assert.equal(typeof r.access.cost.model, 'string', `${r.id} access.cost.model`);
      assert.equal(typeof r.access.provenance, 'object', `${r.id} access.provenance`);
      assert.deepEqual(
        Object.keys(r.extra.consumed_by).sort(),
        ['mcp_servers', 'plugins', 'skills'],
        `${r.id} extra.consumed_by shape`,
      );
      assert.ok('source_modified_at' in r.extra, `${r.id} extra.source_modified_at present`);

      if (!r.repo_full_name) {
        // D-02: every repo_* field is null (not '' / 0) when no repo is known.
        for (const k of REPO_KEYS) assert.equal(r[k], null, `${r.id} ${k}`);
      } else {
        assert.equal(typeof r.repo_stars, 'number', `${r.id} repo_stars`);
      }
      assertNoUndefined(r, r.id);
    }

    // --- slop gate --------------------------------------------------------
    const kept = recs.filter((r) => !isSlop(r));
    assert.equal(kept.length, expectedKept);
    if (type === 'api') {
      assert.ok(
        !kept.some((r) => r.name === 'cat-facts'),
        'public-apis minimal record is rejected by HAS_BASE_URL_OR_SPEC',
      );
    }

    // --- score + embedding input -----------------------------------------
    for (const r of kept) {
      r.quality_score = scoreEntity(r);
      assert.ok(
        Number.isInteger(r.quality_score) && r.quality_score >= 0 && r.quality_score <= 100,
        `${r.id} quality_score=${r.quality_score}`,
      );
      assert.equal(typeof r.extra.access_clarity, 'number', `${r.id} extra.access_clarity`);
      const emb = buildEmbeddingInput(r);
      assert.ok(emb.length > 0 && emb.length <= 300, `${r.id} embedding input length=${emb.length}`);
      assert.ok(!emb.includes('undefined'), `${r.id} embedding input leaks undefined`);
    }
    if (type === 'api') {
      // All three clarity inputs (auth, cost model, rate limit) known at confidence 1.
      assert.equal(kept.find((r) => r.name === 'github').extra.access_clarity, 1);
    }

    // --- tiers ------------------------------------------------------------
    assignPercentileTiers(kept);
    for (const r of kept) {
      assert.ok(['featured', 'solid', 'listed'].includes(r.quality_tier), `${r.id} tier`);
    }

    // --- slugs (D-05: <provider>/<name> through the shared assigner) ------
    const slugRes = assignSlugs(kept);
    for (const r of kept) {
      assert.match(r.slug, /^[^/]+\/[^/]+(\/[^/]+)?$/, `slug for ${r.id}`);
    }
    assert.equal(slugRes.collisionCount, 0);
    assert.deepEqual(kept.map((r) => r.slug), EXPECTED_SLUGS[type]);

    // --- downstream pure helpers -----------------------------------------
    for (const r of kept) {
      const item = buildItem(r);
      assert.equal(item._claudeatlas.type_chip, type);
      if (!r.repo_full_name) {
        assert.equal(item._claudeatlas.repo_full_name, null);
        assert.equal(item._claudeatlas.creator, '');
        assert.equal(item._claudeatlas.repo_stars, 0);
      }
    }
    // NOTE: items is [] for null-repo feeds because entityDate() reads
    // extra.skill_first_commit_at || skill_first_commit_at || repo_created_at;
    // whats-new eligibility for data feeds is Phase 4.3 scope. Here we only
    // assert the helper is total (no throw, array shape).
    assert.ok(Array.isArray(buildWhatsNew(kept).items));

    const snap = aggregateSnapshot(kept);
    assert.equal(snap.by_entity_type[type].records, kept.length);

    linkBundles([], kept);
    for (const r of kept) assert.deepEqual(r.bundled_in_plugins, []);

    assert.ok([-1, 1].includes(compareForCanonical(kept[0], kept[1])));

    for (const r of kept) {
      const e = buildRegistryEntry(r);
      assert.equal(e.slug, r.slug);
      if (!r.repo_full_name) {
        assert.equal(e.install_command, null);
        assert.equal(e.repo_full_name, null);
        assert.equal(e.repo_stars, 0);
      } else {
        assert.match(e.install_command, /^claude install-skill /);
      }
    }

    // --- disk hop: writeNdjsonStreaming → readNdjsonRecords --------------
    const dir = mkdtempSync(join(tmpdir(), 'feeds-rt-'));
    try {
      const p = join(dir, `${type}.ndjson`);
      writeNdjsonStreaming(p, kept, { header: buildHeader(type) });
      const back = [...readNdjsonRecords(p).values()];
      assert.equal(back.length, kept.length);
      assert.deepEqual(back, JSON.parse(JSON.stringify(kept)));
      for (const r of back) {
        if (!r.repo_full_name) assert.equal(r.repo_stars, null, `${r.id} repo_stars after disk hop`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

// ---------------------------------------------------------------------------
// 4. D-02: github-origin types never emit null for the coerced repo_* fields
// ---------------------------------------------------------------------------

test('4.1-M02/D-02: skill, plugin and mcp_server upcasts never emit null for the 13 coerced repo_* fields and carry github origin', () => {
  const inputs = [
    { name: 's', repo_full_name: 'o/r', repo_url: 'https://github.com/o/r', skill_path: 'skills/s/SKILL.md' },
    { entity_type: 'plugin', name: 'p', repo_full_name: 'o/r', repo_url: 'https://github.com/o/r' },
    { entity_type: 'mcp_server', name: 'm', repo_full_name: 'o/r', repo_url: 'https://github.com/o/r' },
  ];
  for (const v1 of inputs) {
    const v2 = upcastRecord(v1);
    const label = v2.entity_type;
    // All 16 keys present on the output.
    for (const k of REPO_KEYS) assert.notEqual(v2[k], undefined, `${label} ${k} present`);
    // The 13 coerced keys are non-null. NOT all 16: repo_license /
    // repo_language / repo_description default `?? null` and ARE null here.
    for (const k of REPO_KEYS_COERCED) assert.notEqual(v2[k], null, `${label} ${k} non-null`);
    assert.deepEqual(v2.origin, {
      kind: 'github',
      source: 'github',
      source_id: 'o/r',
      source_url: 'https://github.com/o/r',
      also_listed_in: [],
    });
    assert.equal(v2.home_url, 'https://github.com/o/r');
    assert.equal(v2.docs_url, null);
    // D-03: access lives only on api/dataset records.
    assert.ok(!('access' in v2), `${label} must not carry access`);
  }
});

// ---------------------------------------------------------------------------
// 5. Pitfall 1: v2 passthrough back-fills origin/home_url/docs_url in place
// ---------------------------------------------------------------------------

test('4.1 Pitfall 1: v2 passthrough back-fills origin/home_url/docs_url in place and preserves identity', () => {
  const v2in = {
    schema_version: 2,
    entity_type: 'skill',
    id: 'skill:o/r/x',
    repo_full_name: 'o/r',
    repo_url: 'https://github.com/o/r',
    extra: { type: 'skill' },
  };
  const out = upcastRecord(v2in);
  assert.equal(out, v2in, 'v2 passthrough must return the same object');
  assert.equal(out.origin.kind, 'github');
  assert.equal(out.origin.source_id, 'o/r');
  assert.equal(out.home_url, 'https://github.com/o/r');
  assert.equal(out.docs_url, null);

  // An existing origin is preserved, not replaced.
  const existingOrigin = {
    kind: 'registry',
    source: 'apis.guru',
    source_id: 'x.com',
    source_url: 'https://api.apis.guru/v2/specs/x.com/1/openapi.json',
    also_listed_in: [],
  };
  const v2in2 = {
    schema_version: 2,
    entity_type: 'api',
    id: 'api:api.x.com/x',
    origin: existingOrigin,
    home_url: 'https://x.com',
    docs_url: null,
    extra: { type: 'api' },
  };
  const out2 = upcastRecord(v2in2);
  assert.equal(out2, v2in2);
  assert.equal(out2.origin, v2in2.origin, 'pre-existing origin must not be replaced');
  assert.equal(out2.origin, existingOrigin);
});

// ---------------------------------------------------------------------------
// 6. D-05: slugs — api vs skill independent; api/api collision handling
// ---------------------------------------------------------------------------

test('4.1-M09/D-05: api and skill with the same owner/name slug independently; two apis with same provider/name collide to provider/host/name', () => {
  // Per-type calls (filter.js runs assignSlugs per entity file), so a skill
  // and an api with the same owner/name do NOT collide with each other.
  const skills = [{ repo_full_name: 'acme/tools', name: 'foo', slug: '', quality_score: 50 }];
  assignSlugs(skills);
  assert.equal(skills[0].slug, 'acme/foo');

  const apis = [{
    entity_type: 'api',
    name: 'foo',
    slug: '',
    quality_score: 50,
    repo_full_name: null,
    extra: { provider: 'acme', base_urls: ['https://a.acme.com/'] },
  }];
  assignSlugs(apis);
  assert.equal(apis[0].slug, 'acme/foo');

  // Collision: same provider + name, different primary hosts.
  const colliding = [
    {
      entity_type: 'api',
      name: 'foo',
      slug: '',
      quality_score: 80,
      repo_full_name: null,
      extra: { provider: 'acme', base_urls: ['https://a.acme.com/'] },
    },
    {
      entity_type: 'api',
      name: 'foo',
      slug: '',
      quality_score: 60,
      repo_full_name: null,
      extra: { provider: 'acme', base_urls: ['https://b.acme.com/'] },
    },
  ];
  const res = assignSlugs(colliding);
  assert.equal(colliding[0].slug, 'acme/a.acme.com/foo');
  assert.equal(colliding[1].slug, 'acme/b.acme.com/foo');
  assert.equal(res.redirects['acme/foo'], 'acme/a.acme.com/foo');
  assert.equal(res.collisionCount, 1);
});

/**
 * scripts/lib/feeds/__tests__/api-merge.test.js
 *
 * Phase 4.2 Plan 03 (4.2-M05 / D-03). RED until Plan 08 lands.
 *
 * Contract tests for the cross-source merge: canonicalHost / nameStem /
 * mergeKey, source precedence (apis.guru > data.gouv.fr > uk-api-catalogue >
 * public-apis), also_listed_in, provenance-preserving access fill, same-source
 * determinism and merge stats.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalHost, nameStem, mergeKey, mergeApiRecords, SOURCE_PRECEDENCE, STRIP_LABELS, FILL_ACCESS_PATHS,
} from '../api-merge.js';
import { emptyAccess, setAccessField } from '../../access.js';

function mk(source, name, { base, home, docs, modified, sid, access, cats, desc } = {}) {
  return {
    entity_type: 'api',
    name,
    description: desc ?? 'd'.repeat(60),
    origin: { kind: 'registry', source, source_id: sid ?? `${source}:${name}`, source_url: 'https://s', also_listed_in: [] },
    home_url: home ?? 'https://x.example/',
    docs_url: docs ?? null,
    source: 'registry',
    tags: [],
    scraped_at: 't',
    content_sha: '0'.repeat(64),
    access: access ?? emptyAccess(),
    extra: {
      base_urls: base ? [base] : [],
      spec_url: null,
      spec_version: null,
      endpoint_count: null,
      categories_src: cats ?? [],
      provider: 'p',
      source_modified_at: modified ?? null,
      endpoint_summaries: [],
      spec_parsed: false,
    },
    raw_source: { shape: source },
  };
}

test('4.2-M05: canonicalHost strips one listed leading label, lowercases, never reduces to the registrable domain', () => {
  assert.equal(canonicalHost('https://api.stripe.com/'), 'stripe.com');
  assert.equal(canonicalHost('https://WWW.Example.com/x'), 'example.com');
  assert.equal(canonicalHost('https://docs.github.com/en/rest'), 'github.com');
  assert.equal(canonicalHost('https://developer.twitter.com'), 'twitter.com');
  assert.equal(canonicalHost('https://opendata.enedis.fr/api'), 'enedis.fr');
  assert.equal(canonicalHost('https://datarmor.cotesdarmor.fr/x'), 'datarmor.cotesdarmor.fr');
  assert.equal(canonicalHost('https://api.service.hmrc.gov.uk/'), 'service.hmrc.gov.uk');
  assert.equal(canonicalHost('https://api.data.gov/regulations/v3'), 'data.gov');
  assert.equal(canonicalHost('https://data.gov'), 'data.gov');
  assert.equal(canonicalHost(''), '');
  assert.equal(canonicalHost(null), '');
  assert.equal(canonicalHost('not a url'), '');
  assert.ok(STRIP_LABELS.includes('developer') && STRIP_LABELS.includes('opendata'));
});

test('4.2-M05: nameStem strips one leading api- and one trailing -api after slugify', () => {
  assert.equal(nameStem('Stripe API'), 'stripe');
  assert.equal(nameStem('api-melodi'), 'melodi');
  assert.equal(nameStem('API Melodi'), 'melodi');
  assert.equal(nameStem('GitHub v3 REST API'), 'github-v3-rest');
  assert.equal(nameStem('api'), 'api');
  assert.equal(nameStem('API-API'), 'api');
  assert.equal(nameStem('Données Radar'), 'donnees-radar');
});

test('4.2-M05: mergeKey prefers base_urls[0], then home_url, then docs_url', () => {
  assert.equal(mergeKey(mk('apis.guru', 'stripe', { base: 'https://api.stripe.com/' })), 'stripe.com/stripe');
  const noBase = mk('apis.guru', 'stripe', { home: 'https://stripe.com/docs' });
  assert.equal(mergeKey(noBase), 'stripe.com/stripe');
  const docsOnly = mk('apis.guru', 'stripe', { docs: 'https://docs.stripe.com/' });
  docsOnly.home_url = null;
  assert.equal(mergeKey(docsOnly), 'stripe.com/stripe');
  const nothing = mk('apis.guru', 'stripe');
  nothing.home_url = null;
  assert.equal(mergeKey(nothing), '/stripe');
});

test('4.2-M05: precedence apis.guru > data.gouv.fr > uk-api-catalogue > public-apis; winner keeps identity, loser source goes to also_listed_in', () => {
  const records = [
    mk('public-apis', 'stripe', { base: 'https://stripe.com/docs/api', desc: 'public desc '.repeat(6) }),
    mk('apis.guru', 'stripe', { base: 'https://api.stripe.com/', desc: 'guru desc '.repeat(8) }),
  ];
  const { merged } = mergeApiRecords(records);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].origin.source, 'apis.guru');
  assert.deepEqual(merged[0].extra.base_urls, ['https://api.stripe.com/']);
  assert.ok(merged[0].description.startsWith('guru desc'));
  assert.deepEqual(merged[0].origin.also_listed_in, ['public-apis']);
  assert.deepEqual(SOURCE_PRECEDENCE, ['apis.guru', 'data.gouv.fr', 'uk-api-catalogue', 'public-apis']);
  assert.deepEqual(records[1].origin.also_listed_in, [], 'input records are not mutated');
});

test('4.2-M05: loser access fills ONLY unknown/null/[] winner fields and carries the loser\'s provenance', () => {
  const a = emptyAccess();
  setAccessField(a, 'auth.type', 'http_basic', { method: 'spec', confidence: 0.9 });
  const b = emptyAccess();
  setAccessField(b, 'auth.type', 'api_key', { method: 'declared', confidence: 0.6 });
  setAccessField(b, 'cost.model', 'free', { method: 'declared', confidence: 0.7 });
  setAccessField(b, 'formats', ['json'], { method: 'declared', confidence: 0.6 });
  const { merged } = mergeApiRecords([
    mk('apis.guru', 'stripe', { base: 'https://api.stripe.com/', access: a }),
    mk('public-apis', 'stripe', { base: 'https://stripe.com/docs/api', access: b }),
  ]);
  assert.equal(merged.length, 1);
  const m = merged[0].access;
  assert.equal(m.auth.type, 'http_basic');
  assert.equal(m.provenance['auth.type'].method, 'spec');
  assert.equal(m.cost.model, 'free');
  assert.equal(m.provenance['cost.model'].confidence, 0.7);
  assert.deepEqual(m.formats, ['json']);
  assert.equal(m.provenance.formats.method, 'declared');
  assert.ok(FILL_ACCESS_PATHS.includes('rate_limit.notes') && FILL_ACCESS_PATHS.length === 12);
});

test('4.2-M05: docs_url / spec_url filled when null; categories_src unioned; description filled only when winner\'s is empty', () => {
  {
    const { merged } = mergeApiRecords([
      mk('apis.guru', 'stripe', { base: 'https://api.stripe.com/', docs: null, cats: ['financial'], desc: '' }),
      mk('public-apis', 'stripe', { base: 'https://stripe.com/', docs: 'https://d', cats: ['Finance', 'financial'], desc: 'loser '.repeat(12) }),
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].docs_url, 'https://d');
    assert.deepEqual(merged[0].extra.categories_src, ['financial', 'Finance']);
    assert.ok(merged[0].description.startsWith('loser'));
  }
  {
    const short = 'x'.repeat(21);
    const { merged } = mergeApiRecords([
      mk('apis.guru', 'stripe', { base: 'https://api.stripe.com/', desc: short }),
      mk('public-apis', 'stripe', { base: 'https://stripe.com/', desc: 'loser '.repeat(12) }),
    ]);
    assert.equal(merged[0].description, short, 'decision 6: no padding from a longer loser description');
  }
});

test('4.2-M05: same-source collisions are deterministic — newer source_modified_at wins, then source_id asc; counted as same_source', () => {
  {
    const { merged, stats } = mergeApiRecords([
      mk('data.gouv.fr', 'base-carbone', { base: 'https://ademe.fr/x', modified: '2026-01-01T00:00:00Z', sid: 'b' }),
      mk('data.gouv.fr', 'base-carbone', { base: 'https://ademe.fr/y', modified: '2026-06-01T00:00:00Z', sid: 'a' }),
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].origin.source_id, 'a');
    assert.equal(stats.merged_duplicates.same_source, 1);
    assert.equal(stats.merged_duplicates.cross_source, 0);
    assert.equal(stats.groups, 1);
    assert.deepEqual(merged[0].origin.also_listed_in, []);
  }
  {
    const { merged } = mergeApiRecords([
      mk('data.gouv.fr', 'base-carbone', { base: 'https://ademe.fr/x', modified: '2026-01-01T00:00:00Z', sid: 'b' }),
      mk('data.gouv.fr', 'base-carbone', { base: 'https://ademe.fr/y', modified: '2026-01-01T00:00:00Z', sid: 'a' }),
    ]);
    assert.equal(merged[0].origin.source_id, 'a');
  }
});

test('4.2-M05: stats on a mixed set', () => {
  const { merged, stats } = mergeApiRecords([
    mk('apis.guru', 'stripe', { base: 'https://api.stripe.com/' }),
    mk('public-apis', 'stripe', { base: 'https://stripe.com/docs/api' }),
    mk('data.gouv.fr', 'base-carbone', { base: 'https://ademe.fr/x', sid: 'a' }),
    mk('data.gouv.fr', 'base-carbone', { base: 'https://ademe.fr/y', sid: 'b' }),
    mk('uk-api-catalogue', 'gov-uk-notify', { base: 'https://api.notifications.service.gov.uk/' }),
    mk('public-apis', 'cat-facts', { base: 'https://catfact.ninja/' }),
  ]);
  assert.equal(merged.length, 4);
  assert.equal(stats.groups, 4);
  assert.deepEqual(stats.merged_duplicates, { cross_source: 1, same_source: 1 });
});

test('4.2-M05: empty input and single records pass through unchanged (deepEqual) with zero stats', () => {
  assert.deepEqual(mergeApiRecords([]), { merged: [], stats: { groups: 0, merged_duplicates: { cross_source: 0, same_source: 0 } } });
  const one = mk('uk-api-catalogue', 'gov-uk-notify', { base: 'https://api.notifications.service.gov.uk/' });
  const snapshot = structuredClone(one);
  const { merged, stats } = mergeApiRecords([one]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0], snapshot);
  assert.deepEqual(one, snapshot, 'input not mutated');
  assert.deepEqual(stats, { groups: 1, merged_duplicates: { cross_source: 0, same_source: 0 } });
});

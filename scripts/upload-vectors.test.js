// scripts/upload-vectors.test.js
//
// Unit tests for the Vectorize uploader resilience behaviors (quick task
// 260624-nhk). Approach mirrors scripts/filter.test.js: import the exported
// helpers directly and drive them with in-memory fixtures. No subprocess, no
// real network or filesystem I/O — the network is a passed-in mock upsertFn.
//
// Covers:
//   - validateVectors: NaN / Infinity / null-element drop, wrong-dimension
//     drop, MODAL dimension detection (wrong-dim record sorting FIRST must
//     not win), empty/missing id drop.
//   - upsertWithBisection: isolates exactly one bad record in a 4xx batch
//     without throwing; re-throws on status-less / 5xx / auth-401 / auth-403
//     (catastrophic, must NOT silently drop the whole corpus).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateVectors, upsertWithBisection } from './upload-vectors.js';

// Silent log stub so tests don't spam output.
const log = () => {};

function mkVec(id, values, metadata = { entity_type: 'skill' }) {
  return { id, values, metadata };
}

// ---------------------------------------------------------------------------
// validateVectors
// ---------------------------------------------------------------------------

test('validateVectors drops a NaN-bearing record, keeps the clean ones', () => {
  const records = [
    mkVec('a', [0.1, 0.2, 0.3, 0.4]),
    mkVec('b', [0.5, 0.6, 0.7, 0.8]),
    mkVec('nan', [0.1, NaN, 0.3, 0.4]),
  ];
  const { valid, dropped, dimension } = validateVectors(records, { log });
  assert.equal(dimension, 4);
  assert.ok(!valid.some((r) => r.id === 'nan'), 'NaN record must be excluded from valid');
  assert.ok(dropped.some((d) => d.id === 'nan'), 'NaN record must be in dropped');
  assert.equal(valid.length, 2);
  for (const d of dropped) {
    assert.ok(typeof d.reason === 'string' && d.reason.length > 0, 'reason is a non-empty string');
  }
});

test('validateVectors drops a record whose values length != detected dimension', () => {
  const records = [
    mkVec('a', [0.1, 0.2, 0.3, 0.4]),
    mkVec('b', [0.5, 0.6, 0.7, 0.8]),
    mkVec('short', [0.1, 0.2, 0.3]),
  ];
  const { valid, dropped, dimension } = validateVectors(records, { log });
  assert.equal(dimension, 4);
  assert.ok(dropped.some((d) => d.id === 'short'));
  assert.ok(!valid.some((r) => r.id === 'short'));
  assert.equal(valid.length, 2);
});

test('validateVectors detects the MODAL dimension even when a wrong-dim record sorts FIRST', () => {
  // 'odd' is a 3-dim outlier sorting first; a/b/c are the 4-dim majority.
  const records = [
    mkVec('odd', [1, 1, 1]),
    mkVec('a', [1, 2, 3, 4]),
    mkVec('b', [5, 6, 7, 8]),
    mkVec('c', [9, 1, 2, 3]),
  ];
  const { valid, dropped, dimension } = validateVectors(records, { log });
  assert.equal(dimension, 4, 'modal (majority) dimension is 4, not the first record\'s 3');
  assert.equal(valid.length, 3, 'the three good records survive');
  assert.deepEqual(valid.map((r) => r.id).sort(), ['a', 'b', 'c']);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].id, 'odd', 'only the wrong-dim outlier is dropped');
});

test('validateVectors drops records with empty or missing id', () => {
  const records = [
    mkVec('a', [0.1, 0.2, 0.3, 0.4]),
    mkVec('b', [0.5, 0.6, 0.7, 0.8]),
    mkVec('', [0.1, 0.2, 0.3, 0.4]),
    mkVec(undefined, [0.1, 0.2, 0.3, 0.4]),
  ];
  const { valid, dropped } = validateVectors(records, { log });
  assert.equal(valid.length, 2);
  // Both bad-id records dropped (count, not by id since '' / undefined aren't usable keys).
  assert.equal(dropped.length, 2);
  assert.ok(valid.every((r) => r.id === 'a' || r.id === 'b'));
});

test('validateVectors drops Infinity and null-element vectors (Number.isFinite gate)', () => {
  const records = [
    mkVec('a', [0.1, 0.2, 0.3, 0.4]),
    mkVec('b', [0.5, 0.6, 0.7, 0.8]),
    mkVec('inf', [Infinity, 0.2, 0.3, 0.4]),
    mkVec('null', [null, 0.2, 0.3, 0.4]),
  ];
  const { valid, dropped, dimension } = validateVectors(records, { log });
  assert.equal(dimension, 4);
  assert.ok(dropped.some((d) => d.id === 'inf'));
  assert.ok(dropped.some((d) => d.id === 'null'));
  assert.ok(!valid.some((r) => r.id === 'inf' || r.id === 'null'));
  assert.equal(valid.length, 2);
});

// ---------------------------------------------------------------------------
// upsertWithBisection
// ---------------------------------------------------------------------------

test('upsertWithBisection isolates exactly one bad record in a 4xx batch without throwing', async () => {
  const records = [
    mkVec('r1', [1, 2, 3, 4]),
    mkVec('r2', [1, 2, 3, 4]),
    mkVec('bad', [1, 2, 3, 4]),
    mkVec('r3', [1, 2, 3, 4]),
    mkVec('r4', [1, 2, 3, 4]),
  ];
  // Mock: any batch CONTAINING 'bad' throws a non-auth 4xx; everything else resolves.
  const upsertFn = async (batch) => {
    if (batch.some((r) => r.id === 'bad')) {
      const e = new Error('Vectorize HTTP 400: 40023 line was not expected format');
      e.status = 400;
      throw e;
    }
    return { uploaded: batch.length };
  };
  const result = await upsertWithBisection(records, { upsertFn, log });
  assert.equal(result.uploaded, 4, 'four good records uploaded');
  assert.equal(result.dropped.length, 1, 'exactly one record dropped');
  assert.equal(result.dropped[0].id, 'bad', 'the bad record is the one dropped');
});

test('upsertWithBisection re-throws on a status-less (transport) error', async () => {
  const records = [mkVec('r1', [1, 2, 3, 4]), mkVec('r2', [1, 2, 3, 4])];
  const upsertFn = async () => {
    throw new Error('socket hang up');
  };
  await assert.rejects(() => upsertWithBisection(records, { upsertFn, log }));
});

test('upsertWithBisection re-throws on a persistent 5xx (not a one-bad-record case)', async () => {
  const records = [mkVec('r1', [1, 2, 3, 4]), mkVec('r2', [1, 2, 3, 4])];
  const upsertFn = async () => {
    const e = new Error('Vectorize 503 after retries');
    e.status = 503;
    throw e;
  };
  await assert.rejects(() => upsertWithBisection(records, { upsertFn, log }));
});

test('upsertWithBisection re-throws on auth 401 for every batch (no silent corpus drop)', async () => {
  const records = [mkVec('r1', [1, 2, 3, 4]), mkVec('r2', [1, 2, 3, 4]), mkVec('r3', [1, 2, 3, 4])];
  const upsertFn = async () => {
    const e = new Error('Vectorize HTTP 401: unauthorized');
    e.status = 401;
    throw e;
  };
  await assert.rejects(() => upsertWithBisection(records, { upsertFn, log }));
});

test('upsertWithBisection re-throws on auth 403 for every batch (no silent corpus drop)', async () => {
  const records = [mkVec('r1', [1, 2, 3, 4]), mkVec('r2', [1, 2, 3, 4]), mkVec('r3', [1, 2, 3, 4])];
  const upsertFn = async () => {
    const e = new Error('Vectorize HTTP 403: forbidden');
    e.status = 403;
    throw e;
  };
  await assert.rejects(() => upsertWithBisection(records, { upsertFn, log }));
});

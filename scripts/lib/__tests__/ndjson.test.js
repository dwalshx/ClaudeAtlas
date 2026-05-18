/**
 * scripts/lib/__tests__/ndjson.test.js
 *
 * 13 tests for the F1 streaming NDJSON helpers. `node --test` only — no
 * external test framework. Tests 1-11 are the F1 baseline (Rev 2);
 * Tests 12-13 are the Rev 3 header-sentinel additions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  readNdjsonRecords,
  writeNdjsonStreaming,
  openNdjsonAppend,
  appendNdjsonLine,
  closeNdjsonAppend,
} from '../ndjson.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const LINT_SCRIPT = join(REPO_ROOT, 'scripts', 'check-banned-patterns.js');
const SIZE_SCRIPT = join(REPO_ROOT, 'scripts', 'check-skills-size.js');

function mktmp() {
  return mkdtempSync(join(tmpdir(), 'ndjson-test-'));
}

function* genRecords(n) {
  for (let i = 0; i < n; i++) {
    yield { id: `rec-${i}`, n: i, label: `Record number ${i}` };
  }
}

test('Test 1: writeNdjsonStreaming writes 100k records without RangeError', () => {
  const dir = mktmp();
  try {
    const path = join(dir, 'big.ndjson');
    writeNdjsonStreaming(path, genRecords(100_000));
    const stat = statSync(path);
    assert.ok(stat.size > 0, 'file should be non-empty');
    const lineCount = readFileSync(path, 'utf-8').split('\n').filter(Boolean).length;
    assert.equal(lineCount, 100_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Test 2: readNdjsonRecords round-trips sampled subset', () => {
  const dir = mktmp();
  try {
    const path = join(dir, 'rt.ndjson');
    const recs = Array.from({ length: 1000 }, (_, i) => ({ id: `r-${i}`, value: i * 2 }));
    writeNdjsonStreaming(path, recs);
    const map = readNdjsonRecords(path);
    assert.equal(map.size, 1000);
    for (const i of [0, 1, 17, 333, 999]) {
      const got = map.get(`r-${i}`);
      assert.deepEqual(got, { id: `r-${i}`, value: i * 2 });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Test 3: partial last line (no trailing newline) read correctly', () => {
  const dir = mktmp();
  try {
    const path = join(dir, 'partial.ndjson');
    writeFileSync(
      path,
      '{"id":"a","x":1}\n{"id":"b","x":2}\n{"id":"c","x":3}', // no trailing \n
      'utf-8'
    );
    const map = readNdjsonRecords(path);
    assert.equal(map.size, 3);
    assert.deepEqual(map.get('c'), { id: 'c', x: 3 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Test 4: malformed line skipped, parsing continues', () => {
  const dir = mktmp();
  try {
    const path = join(dir, 'malformed.ndjson');
    writeFileSync(
      path,
      '{"id":"a","x":1}\nthis is not json\n{"id":"b","x":2}\n',
      'utf-8'
    );
    const map = readNdjsonRecords(path);
    assert.equal(map.size, 2);
    assert.ok(map.has('a'));
    assert.ok(map.has('b'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runLint(args, env = {}) {
  return spawnSync(process.execPath, [LINT_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf-8',
  });
}

function writeFixtureFile(dir, name, contents) {
  const p = join(dir, name);
  mkdirSync(dirname2(p), { recursive: true });
  writeFileSync(p, contents, 'utf-8');
  return p;
}
function dirname2(p) {
  const i = p.lastIndexOf('/');
  const j = p.lastIndexOf('\\');
  return p.slice(0, Math.max(i, j));
}

test('Test 5: check-banned-patterns flags readFileSync utf-8 against data/ path', () => {
  const dir = mktmp();
  try {
    const fixture = `
const DATA_PATH = 'data/skills.json';
import { readFileSync } from 'fs';
const x = readFileSync(DATA_PATH, 'utf-8');
`;
    writeFixtureFile(dir, 'bad-a.js', fixture);
    const res = runLint(['--mode=lint', '--scan-path', dir]);
    assert.equal(res.status, 1, `expected exit 1; stdout: ${res.stdout}\nstderr: ${res.stderr}`);
    assert.match(res.stdout + res.stderr, /Banned A/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Test 6: check-banned-patterns flags JSON.stringify(_, null, 2)', () => {
  // Banned B is scoped to relPaths starting with scripts/ per plan §T1
  // step 3 ("any pretty-printed JSON.stringify in scripts/"). The fixture
  // must therefore live under a scripts/ subdir of the scan-path so its
  // relPath matches.
  const dir = mktmp();
  try {
    const fixture = `
const arr = [{a:1}];
const s = JSON.stringify(arr, null, 2);
console.log(s);
`;
    writeFixtureFile(dir, 'scripts/bad-b.js', fixture);
    const res = runLint(['--mode=lint', '--scan-path', dir]);
    assert.equal(res.status, 1, `expected exit 1; stdout: ${res.stdout}\nstderr: ${res.stderr}`);
    assert.match(res.stdout + res.stderr, /Banned B/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Test 7: check-banned-patterns baseline mode exits 0 on current main', () => {
  // Baseline mode against the live repo: any existing hits go to the
  // baseline file and exit 0. This test asserts T1's "green on main"
  // gate from the plan's <done> block.
  const res = runLint(['--mode=baseline']);
  assert.equal(res.status, 0, `baseline mode should exit 0; stdout: ${res.stdout}\nstderr: ${res.stderr}`);
});

test('Test 8: check-skills-size exits 1 on >400 MB fixture; 0 on 50 MB', () => {
  const dir = mktmp();
  try {
    const dataDir = join(dir, 'data');
    mkdirSync(dataDir, { recursive: true });
    // Write a sparse-ish file by allocating size via Buffer of zeroes in
    // chunks. Use a smaller fixture and an override threshold so the
    // test is fast.
    const small = join(dataDir, 'small.ndjson');
    const big = join(dataDir, 'big.ndjson');
    writeFileSync(small, Buffer.alloc(50 * 1024 * 1024)); // 50 MB
    writeFileSync(big, Buffer.alloc(100 * 1024 * 1024));  // 100 MB

    // threshold=80MB: small (50MB) passes, big (100MB) fails.
    const resOk = spawnSync(process.execPath, [SIZE_SCRIPT, '--scan-path', dataDir, '--threshold=80'], {
      encoding: 'utf-8',
    });
    const resBad = spawnSync(process.execPath, [SIZE_SCRIPT, '--scan-path', dataDir, '--threshold=80'], {
      encoding: 'utf-8',
    });
    // Both runs scan the same dir and will fail because big.ndjson exists.
    assert.equal(resBad.status, 1, `big file should trip threshold; stdout: ${resBad.stdout}`);

    // Re-test the green path with the big file removed.
    rmSync(big);
    const resOk2 = spawnSync(process.execPath, [SIZE_SCRIPT, '--scan-path', dataDir, '--threshold=80'], {
      encoding: 'utf-8',
    });
    assert.equal(resOk2.status, 0, `only-small dir should pass; stdout: ${resOk2.stdout}`);
    // Reference the unused var to avoid lint complaint
    void resOk;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Test 9 (Rev 2 B3): flags records.map(JSON.stringify).join chain', () => {
  const dir = mktmp();
  try {
    const fixture = `
const records = [{a:1},{a:2}];
const out = records.map(JSON.stringify).join('\\n');
console.log(out);
`;
    writeFixtureFile(dir, 'bad-c.js', fixture);
    const res = runLint(['--mode=lint', '--scan-path', dir]);
    assert.equal(res.status, 1, `stdout: ${res.stdout}\nstderr: ${res.stderr}`);
    assert.match(res.stdout + res.stderr, /Banned C/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Test 10 (Rev 2 B4): flags workflow YAML inline node -e with JSON.parse(readFileSync(...))', () => {
  const dir = mktmp();
  try {
    const wfDir = join(dir, '.github', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    const yml = `
name: test
on: push
jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - run: node -e "const x = JSON.parse(require('fs').readFileSync('data/skills.json','utf-8')); console.log(x.length)"
`;
    writeFileSync(join(wfDir, 'bad.yml'), yml, 'utf-8');
    const res = runLint(['--mode=lint', '--scan-path', dir]);
    assert.equal(res.status, 1, `stdout: ${res.stdout}\nstderr: ${res.stderr}`);
    assert.match(res.stdout + res.stderr, /Banned E/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Test 11 (Rev 2 B3 follow-on): flags array.push(JSON.stringify) + array.join("") proximity', () => {
  const dir = mktmp();
  try {
    const fixture = `
function dump(records) {
  const chunks = [];
  for (const r of records) {
    chunks.push(JSON.stringify(r) + '\\n');
  }
  return chunks.join('');
}
`;
    writeFixtureFile(dir, 'bad-d.js', fixture);
    const res = runLint(['--mode=lint', '--scan-path', dir]);
    assert.equal(res.status, 1, `stdout: ${res.stdout}\nstderr: ${res.stderr}`);
    assert.match(res.stdout + res.stderr, /Banned D/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Test 12 (Rev 3 X1): header round-trip — write {_header:true,...} + 1000 records', () => {
  const dir = mktmp();
  try {
    const path = join(dir, 'hdr.ndjson');
    const recs = Array.from({ length: 1000 }, (_, i) => ({ id: `r-${i}`, v: i }));
    writeNdjsonStreaming(path, recs, { header: { schema_version: 2, written_at: '2026-05-18T00:00:00Z' } });

    // First line should be the header.
    const firstLine = readFileSync(path, 'utf-8').split('\n')[0];
    const parsedFirst = JSON.parse(firstLine);
    assert.equal(parsedFirst._header, true);
    assert.equal(parsedFirst.schema_version, 2);

    // readNdjsonRecords filters the header.
    let headerSeen = null;
    const map = readNdjsonRecords(path, { onHeader: (h) => { headerSeen = h; } });
    assert.equal(map.size, 1000, 'header must be filtered from records');
    assert.ok(headerSeen, 'onHeader callback should have fired');
    assert.equal(headerSeen.schema_version, 2);

    // Spot-check a record.
    assert.deepEqual(map.get('r-500'), { id: 'r-500', v: 500 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Test 13 (Rev 3 X1 defensive): _header on a non-first line is also filtered', () => {
  const dir = mktmp();
  try {
    const path = join(dir, 'mid-hdr.ndjson');
    writeFileSync(
      path,
      [
        JSON.stringify({ id: 'a', x: 1 }),
        JSON.stringify({ _header: true, schema_version: 9, stray: true }),
        JSON.stringify({ id: 'b', x: 2 }),
      ].join('\n') + '\n',
      'utf-8'
    );
    const map = readNdjsonRecords(path);
    assert.equal(map.size, 2, 'misplaced header must still be filtered');
    assert.ok(map.has('a'));
    assert.ok(map.has('b'));
    assert.equal(map.has('schema_version'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('append helpers: openNdjsonAppend + appendNdjsonLine + closeNdjsonAppend', () => {
  const dir = mktmp();
  try {
    const path = join(dir, 'appended.ndjson');
    const fd = openNdjsonAppend(path);
    appendNdjsonLine(fd, { id: 'a', x: 1 });
    appendNdjsonLine(fd, { id: 'b', x: 2 });
    closeNdjsonAppend(fd);

    const fd2 = openNdjsonAppend(path);
    appendNdjsonLine(fd2, { id: 'c', x: 3 });
    closeNdjsonAppend(fd2);

    const map = readNdjsonRecords(path);
    assert.equal(map.size, 3);
    assert.deepEqual(map.get('c'), { id: 'c', x: 3 });

    // Reserved-key guard: appendNdjsonLine refuses a record with _header.
    const fd3 = openNdjsonAppend(path);
    try {
      assert.throws(() => appendNdjsonLine(fd3, { _header: true, schema_version: 2 }));
    } finally {
      closeNdjsonAppend(fd3);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

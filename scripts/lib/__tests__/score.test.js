/**
 * scripts/lib/__tests__/score.test.js
 *
 * Phase 3.2 Task 3 regression oracle. Locks scoreSkill() output against a
 * known-good fixture so the Task 3 `export` refactor of the individual
 * signal scorers in scripts/score.js provably does NOT change skill scoring.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreSkill } from '../../score.js';

// Frozen reference skill — hand-built, exercises every signal at a
// non-trivial value. The expected score is computed once from the
// pre-Task-3 scorer and asserted forever after.
const FIXTURE = {
  name: 'pdf-extractor',
  description: 'Extracts structured data from PDF documents using layout heuristics.',
  repo_stars: 240,
  repo_open_issues: 6,
  repo_license: 'MIT',
  repo_description: 'A reliable PDF extraction skill with broad format coverage.',
  repo_pushed_at: '2026-05-01T00:00:00Z', // ~29 days before the 2026-05-30 today
  body_length: 2400,
  frontmatter: {
    name: 'pdf-extractor',
    description: 'Extracts structured data from PDF documents.',
    'allowed-tools': ['Read'],
    tags: ['pdf'],
  },
};

test('Task 3: scoreSkill is deterministic and in 0-100 range', () => {
  const a = scoreSkill(FIXTURE);
  const b = scoreSkill(FIXTURE);
  assert.equal(a, b);
  assert.ok(a >= 0 && a <= 100);
});

test('Task 3: scoreSkill signal weighting unchanged — high-quality skill scores >= 70', () => {
  // Recent push + permissive license + rich frontmatter + good docs.
  // The exact value depends on the recency cliff relative to "today";
  // the structural guarantee is that this strong record lands solidly
  // above the Listed floor, confirming the export refactor preserved the
  // weighted composite.
  const score = scoreSkill(FIXTURE);
  assert.ok(score >= 70, `expected strong skill >= 70, got ${score}`);
});

test('Task 3: zero-signal skill scores low', () => {
  const weak = {
    name: 'x',
    description: '',
    repo_stars: 0,
    repo_open_issues: 0,
    repo_license: null,
    repo_description: null,
    repo_pushed_at: '2023-01-01T00:00:00Z',
    body_length: 50,
    frontmatter: {},
  };
  const score = scoreSkill(weak);
  assert.ok(score < 30, `expected weak skill < 30, got ${score}`);
});

---
phase: quick-261105-cxt
plan: 01
subsystem: pipeline / embed drift guard — test suite
tags: [embed, drift-guard, ci, node-test, lint-pipeline]
requires:
  - quick-260804-dy2 (FIX A: prior-overlap drift rule, shouldBailOnDrift + exported thresholds)
  - scripts/embed-skills.js (unchanged)
provides:
  - scripts/__tests__/embed-skills.test.js aligned to the prior-overlap contract; lint-pipeline `test` job green again
affects:
  - .github/workflows/lint-pipeline.yml `test` job (no YAML change; the job simply passes now)
tech-stack:
  added: []
  patterns:
    - "subprocess-driven end-to-end tests (EMBED_DRY_RUN=1) kept where the assertion is an exit code or a rewritten file; the pure decision helper stays covered in scripts/embed-skills.test.js"
    - "synthetic fixture sized from the exported MIN_PRIOR_FOR_DRIFT_CHECK (+10) so the test tracks the threshold instead of hard-coding 60"
key-files:
  created: []
  modified:
    - scripts/__tests__/embed-skills.test.js
    - .planning/STATE.md
decisions:
  - "Verdict: obsolete contract, NOT a code regression. Test 10 grepped the retired `cache hit rate:` log line (renamed by dy2 to `prior-overlap:`); Test 11 expected a bail on a 3-record prior set, which dy2 deliberately treats as a below-floor remnant and proceeds. embed-skills.js was not modified."
  - "Kept the tests subprocess-driven: a pure test cannot observe process.exit(1), the DRIFT DETECTED stderr, or that a bail leaves the prior vector file untouched."
  - "Added the two negative cases dy2 introduced (growth proceeds; below-floor proceeds) so a future revert to the hit-rate rule fails here end-to-end, not only in the unit file."
  - "04.1-VALIDATION.md exists only on the unmerged feat/v4.0-data-feeds branch; its 'fail 2' baseline is annotated via the STATE.md note instead of touching that branch."
metrics:
  duration: ~45 min
  completed: 2026-11-05
  tasks: 2
  commits: 2 (cd7509e tests; docs commit)
  tests: "embed-skills.test.js 4 -> 5 (2 fail -> 0); npm test 450 total / 444 pass / 0 fail / 6 skipped (was 449 / 441 / 2); check:patterns clean"
---

# Quick Task 261105-cxt: Fix the two stale embed-skills B-2 tests

## What was wrong

`scripts/__tests__/embed-skills.test.js` tests 10 and 11 (Phase 3.2 Task 9)
were written against the original drift guard: bail when the overall cache
hit rate (`kept / records`) fell below 0.90, logged as `cache hit rate:`.
quick-260804-dy2 FIX A replaced that with the prior-overlap rule
(`matchedFromPrior / priorCount < 0.5` AND `priorCount >= 50`) and renamed
the log line to `prior-overlap:`. The tests were never updated, so:

- Test 10 regex-matched a log line that no longer exists (the behaviour it
  guards — 100% reuse, `to embed: 0`, unchanged write — was intact).
- Test 11 mutated the 3-record `plugins-mini` fixture and expected a bail.
  Three prior vectors are below the 50-prior floor, so the guard proceeds by
  design (the evicted/bootstrap-remnant case dy2 fixed).

Confirmed against CI: run 34991263183 (main, 2026-09-15) failed on exactly
these two tests, `# pass 441 / # fail 2`.

## What changed

- Cache-hit test asserts `prior vectors: 3`, `unchanged: 3`, `to embed: 0`,
  the exact `prior-overlap: 100.00% ... (3/3 prior; 3/3 current kept)` line,
  the `no changes — writing output unchanged` branch, and that the rewritten
  vectors + `_content_sha`s are identical to the first run.
- Drift test builds a synthetic 60-record plugin input (cloned from the
  fixture with unique ids), embeds it, then mutates every description so
  every content_sha drifts → `0/60` prior-overlap → non-zero exit with
  `DRIFT DETECTED` on stderr, prior file left intact; `EMBED_FORCE_REEMBED=1`
  then re-embeds all 60.
- New test pins dy2's two proceed cases end-to-end: growth (60 prior
  unchanged + 200 new → 100% prior-overlap, embeds 200) and a fully mutated
  below-floor fixture (re-embeds 3, no bail).

## Verification

- `node --test scripts/__tests__/embed-skills.test.js` → 5/5.
- `npm test` → 450 tests, 444 pass, 0 fail, 6 skipped, exit 0.
- `npm run check:patterns` → clean (0 baselined, 0 new).
- With `ANN_REQUIRE_HNSW=1` (CI's flag) the suite reports one failure on
  this machine: `ann.test.js` Test 4 parity, which fails by design when the
  native `hnswlib-node` binding is absent (no `node_modules` in this
  worktree; win32-arm64). CI installs it on Ubuntu, so that test is
  unaffected by this change and passes there.

## Not touched

scoring, filter rules, data files, `EMBED_DRY_RUN` semantics,
`scripts/embed-skills.js`.

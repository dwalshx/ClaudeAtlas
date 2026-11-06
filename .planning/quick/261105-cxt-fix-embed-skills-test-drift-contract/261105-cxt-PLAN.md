---
phase: quick-261105-cxt
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/__tests__/embed-skills.test.js
  - .planning/STATE.md
autonomous: true
requirements: [CXT-A]
must_haves:
  truths:
    - "`npm test` exits 0 (`# fail 0`) on main-based branches; the lint-pipeline `test` job carries signal again."
    - "The two Task 9 B-2 subprocess tests assert the CURRENT drift contract (quick-260804-dy2 prior-overlap rule), not the retired overall-hit-rate rule."
    - "Coverage is not weakened: the unchanged re-run still proves a 100% prior-overlap / zero-to-embed path end-to-end, and the drift bail-out is proven end-to-end ABOVE the 50-prior floor, with EMBED_FORCE_REEMBED still overriding it."
    - "No change to scripts/embed-skills.js, scoring, filter rules, EMBED_DRY_RUN semantics, or any data file."
  artifacts:
    - path: "scripts/__tests__/embed-skills.test.js"
      provides: "Subprocess-driven B-2 tests aligned to the prior-overlap drift rule"
      contains: "prior-overlap"
  key_links:
    - from: "scripts/__tests__/embed-skills.test.js"
      to: "scripts/embed-skills.js shouldBailOnDrift / MIN_PRIOR_FOR_DRIFT_CHECK"
      via: "synthetic plugin input sized above the floor, mutated so every content_sha drifts"
      pattern: "MIN_PRIOR_FOR_DRIFT_CHECK"
---

<objective>
The lint-pipeline `test` job has been red on every push and PR since at least
2026-09-15 because two subprocess tests in `scripts/__tests__/embed-skills.test.js`
(Phase 3.2 Task 9, written against the ORIGINAL drift guard) never caught up with
quick-260804-dy2 FIX A, which replaced the overall-cache-hit-rate bail
(`kept/records < 0.90`) with the prior-overlap rule
(`matchedFromPrior/priorCount < 0.5 AND priorCount >= 50`).

Finding (code vs. tests):
- Test 10 greps for the log line `cache hit rate: 100.000%`. dy2 renamed that
  line to `prior-overlap: 100.00% of prior vectors still match (...)`. The
  behaviour it guards (100% hit, `to embed: 0`, output rewritten unchanged) is
  intact — only the assertion string is stale.
- Test 11 mutates the 3-record `plugins-mini.ndjson` fixture and expects a
  non-zero `DRIFT DETECTED` exit. Under dy2 a 3-vector prior set is BELOW
  `MIN_PRIOR_FOR_DRIFT_CHECK=50`, so the guard deliberately proceeds (that is
  the "evicted/bootstrap remnant" case dy2 fixed). The test encodes the
  obsolete contract; the code is correct.

Verdict: obsolete contract, not a regression. Rewrite the tests; do not touch
the embedder.
</objective>

<tasks>

<task type="auto">
<name>Task 1: Re-align the two B-2 subprocess tests to the prior-overlap contract</name>
<files>scripts/__tests__/embed-skills.test.js</files>
<action>
Keep the tests subprocess-driven (`EMBED_DRY_RUN=1`): the pure decision helper is
already unit-tested in `scripts/embed-skills.test.js`; what these two add is the
END-TO-END wiring (partition → log → bail/proceed → output write), which only a
real `main()` run proves.

1. Cache-hit test: assert `unchanged: 3`, `to embed:  0`,
   `prior-overlap: 100.00%`, and the `no changes — writing output unchanged`
   branch; additionally assert the rewritten vector file is value-identical
   to the first run.
2. Drift test: build a synthetic plugin input of 60 records (≥ 50 floor) by
   cloning the fixture with unique ids/slugs, embed it, then mutate every
   description so every content_sha drifts → 0/60 prior-overlap → expect
   non-zero exit with `DRIFT DETECTED`; `EMBED_FORCE_REEMBED=1` must then
   complete.
3. Add the two negative cases dy2 introduced, so the rule itself is pinned
   end-to-end: (a) catalog GROWTH (60 prior unchanged + 200 new) proceeds with
   100% prior-overlap; (b) a mutated BELOW-floor fixture (the old test's exact
   scenario) proceeds instead of bailing.
</action>
<verify>node --test scripts/__tests__/embed-skills.test.js → all ok; npm test → `# fail 0`; npm run check:patterns clean.</verify>
<done>Both former failures pass; new growth/below-floor cases pass; no source or data file touched.</done>
</task>

<task type="auto">
<name>Task 2: Annotate the stale "2 known embed-skills fails" baseline notes</name>
<files>.planning/STATE.md</files>
<action>
Add a one-line note under the Quick Tasks table (not a rewrite of the rows)
saying the "2 known embed-skills fails" cited in rows 260806-ejd, 260806-f00,
260910-g0f (and in 04.1-VALIDATION.md on the unmerged feat/v4.0-data-feeds
branch) were the stale Task 9 B-2 tests, fixed by this quick task; baseline
is `# fail 0` from here on. Add this task's row.
</action>
<verify>grep the note in STATE.md.</verify>
<done>STATE.md row + note present; history untouched.</done>
</task>

</tasks>

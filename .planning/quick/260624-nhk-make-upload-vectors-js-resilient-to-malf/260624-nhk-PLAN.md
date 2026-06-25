---
phase: quick-260624-nhk
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/upload-vectors.js
  - scripts/upload-vectors.test.js
autonomous: true
requirements: [NHK-01, NHK-02, NHK-03, NHK-04]
must_haves:
  truths:
    - "A single malformed vector (NaN/Infinity/null value, wrong dimension, or empty id) is dropped+logged, never aborting the run"
    - "When a 500-row batch upsert returns a non-429 4xx (excluding auth 401/403), the batch is recursively bisected so only the offending record(s) are skipped"
    - "The existing 429/5xx exponential-backoff retry (MAX_RETRIES) is preserved unchanged"
    - "The uploader exits 0 when the run completes with a HANDFUL of records skipped, so the daily-scrape publish→build→deploy steps proceed"
    - "Non-zero exit is reserved for catastrophic failure: missing input file, auth (401/403), persistent 5xx/transport, OR a catastrophic skip fraction (>=50% of records dropped — signals a systemic bug, not one bad embedding)"
    - "The fix applies to all three vector files (skills/plugins/mcp) via the one shared uploader"
  artifacts:
    - path: "scripts/upload-vectors.js"
      provides: "Pre-validation + bisection-on-4xx + exit-0-on-skips resilience"
      contains: "export function validateVectors"
    - path: "scripts/upload-vectors.js"
      provides: "Recursive bisection routine isolating the bad record(s) in a 4xx batch"
      contains: "export async function upsertWithBisection"
    - path: "scripts/upload-vectors.test.js"
      provides: "node:test coverage: NaN drop, wrong-dim drop (modal), empty-id drop, bisection isolates one bad record, 401/403 + 5xx re-throw catastrophic"
      min_lines: 60
  key_links:
    - from: "scripts/upload-vectors.js main()"
      to: "validateVectors"
      via: "pre-upload filter of the loaded records Map"
      pattern: "validateVectors\\("
    - from: "scripts/upload-vectors.js batch loop"
      to: "upsertWithBisection"
      via: "replaces the process.exit(1)-on-any-error batch upsert"
      pattern: "upsertWithBisection\\("
    - from: "scripts/upload-vectors.test.js"
      to: "validateVectors + upsertWithBisection"
      via: "named imports driven with in-memory fixtures + a mock fetch"
      pattern: "import .* from '\\./upload-vectors\\.js'"
---

<objective>
Make `scripts/upload-vectors.js` resilient to malformed vectors so one bad
embedding can no longer abort the daily pipeline. The scheduled cron has failed
4 days running (2026-06-21 → 06-24) at "Upload vectors to Vectorize" with
`Vectorize HTTP 400, code 40023: ... line Some(139) was not expected format`
on batch 43 (≈ row 21,138 of 67,288 skill vectors). One malformed record kills
the whole 500-row batch, and the current code does `process.exit(1)` on ANY
batch failure (line ~176) BEFORE publish/build/deploy — freezing the live site
at 2026-06-18 data.

Purpose: skip-and-log one bad record instead of hard-failing the daily run, so
publish→build→deploy always proceed and the site refreshes. Investigating WHY a
vector is malformed is explicitly out of scope; the skip-and-log makes it
observable for a later look. CRITICAL DESIGN GUARD: resilience must not become a
silent mass-drop — an auth failure or a wrong reference dimension would 4xx
EVERY batch, and a naive "bisect everything to singletons then drop" would
refresh the site with a near-empty vector index (worse than the current
hard-fail). The plan therefore (a) excludes auth 401/403 from the bisectable
set, and (b) hard-fails when the dropped fraction is catastrophic.

Output: a hardened `scripts/upload-vectors.js` (pre-validation, bisection on
non-429/non-auth 4xx, preserved 429/5xx backoff, exit-0-on-partial-skip,
non-zero exit on catastrophic skip fraction) plus a `node:test` suite proving
the resilience behaviors. Single-file change covers all three vector files
(skills/plugins/mcp) — they share this uploader, invoked in a `for f in ...`
loop in daily-scrape.yml (lines 400-408).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md
@scripts/upload-vectors.js
@scripts/lib/ndjson.js

<interfaces>
<!-- Contracts the executor needs. Extracted from the codebase — no exploration required. -->

Vector record shape (one NDJSON line in data/{skill,plugin,mcp}-vectors.ndjson):
```js
{ id: "owner/repo/path", values: [/* N finite floats */], metadata: { entity_type: "skill" } }
```
The skill/plugin/mcp vectors come from `text-embedding-3-small` → **1536 dims**
(matches the `claudeatlas-skills` Vectorize index dimension). This is the
EXPECTED dimension; the plan detects it MODALLY (self-correcting if the embed
model ever changes) rather than hard-coding it.

Existing exports/structure in scripts/upload-vectors.js (currently NO exports — all module-private):
- `parseArgs(argv)` → { input, dryRun }
- `upsertBatch(records, attempt = 1)` — POSTs NDJSON body; on 429/>=500 retries with exponential backoff up to MAX_RETRIES (KEEP THIS); on other !ok throws.
- `main()` — reads records via `readNdjsonRecords(NDJSON_PATH, { keyFn: r => r.id })`, slices into BATCH_SIZE=500 chunks, calls `upsertBatch`, and on ANY catch does `console.error(... [FATAL] ...); process.exit(1)` (lines 174-177 — THIS is the bug).

Invoked-as-script guard idiom — the repo uses a dual Windows-safe form
(`fileURLToPath` is already imported at upload-vectors.js:27, NO new import).
From scripts/filter.js:558-570 (also enrich.js:330):
```js
const invokedAsScript = (() => {
  try {
    return import.meta.url === fileURLToPath(`file://${process.argv[1]}`).replace(/\\/g, '/')
      || fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (invokedAsScript) main();
```
(The simpler single-form `if (fileURLToPath(import.meta.url) === process.argv[1])`
is at filter-plugins.js:295, but use the DUAL form above — this is a win32 box and
local dry-run is part of verify.)

NDJSON reader contract (scripts/lib/ndjson.js — DO NOT replace with readFileSync; banned per CLAUDE.md footguns):
```js
readNdjsonRecords(path, { keyFn }) // → Map<key, record>; skips _header lines and JSON-parse-failures
```

daily-scrape.yml "Upload vectors to Vectorize" step (lines 395-411) loops all three files:
```yaml
for f in data/skill-vectors.ndjson data/plugin-vectors.ndjson data/mcp-vectors.ndjson; do
  if [ -f "$f" ]; then node scripts/upload-vectors.js --input "$f"; fi
done
```
The step is main-only and has NO `continue-on-error` / `|| true` — so the script's own exit code is what gates publish→build→deploy. The fix's exit-0-on-partial-skip is THE mechanism that unfreezes the site; the catastrophic-skip-fraction guard is what STOPS a near-empty index from publishing.

Test runner (package.json): `npm test` → `node --test "scripts/**/*.test.js"`.
Node 22 also supports per-file `node --test scripts/upload-vectors.test.js`.
Pattern to match (see scripts/filter.test.js): `import { test } from 'node:test'`,
`import assert from 'node:assert/strict'`, named imports from the module under
test, in-memory fixtures, no subprocess/no real I/O. Mock the network by passing
an injected upsertFn into the bisection function (see Task 1 action).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add pre-validation + 4xx bisection to upload-vectors.js (exit-0 on partial skip, hard-fail on catastrophic skip)</name>
  <files>scripts/upload-vectors.js</files>
  <behavior>
    validateVectors(records, { log }):
    - Detects expected dimension D as the MODAL (most common) `values.length`
      across all valid-shaped records (a single pass counting length
      frequencies among records whose `values` is a non-empty array of all-finite
      numbers). MODAL — not the first record — so a wrong-dimension outlier that
      happens to sort first cannot become the reference and drop all the GOOD
      records. Log the detected D.
    - Drops a record when: `id` is missing / not a string / empty; OR `values` is
      not an array; OR `values` is empty; OR any element is not finite
      (Number.isFinite false — rejects NaN, Infinity, -Infinity, null, undefined,
      strings); OR `values.length !== D`.
    - Returns { valid: Record[], dropped: {id, reason}[], dimension: D }.
    - Logs each dropped id + reason and a total dropped count.
    - Edge: if NO record is valid (can't establish D), returns valid:[] and
      surfaces it to the caller (caller decides — see main()).

    upsertWithBisection(records, { upsertFn, log }):
    - Calls upsertFn(records) (defaults to the existing upsertBatch, which keeps the 429/5xx backoff). On success returns { uploaded: records.length, dropped: [] }.
    - Treats a thrown error as BISECTABLE only when it is a non-429, non-AUTH 4xx:
      `err.status >= 400 && err.status < 500 && err.status !== 429 && err.status !== 401 && err.status !== 403`.
      (400 stays bisectable — that's the real malformed-record bug. 401/403 are
      EXCLUDED: an auth failure 4xxs every batch and must NOT bisect-to-drop the
      whole corpus.) On a bisectable 4xx: if records.length === 1, DROP it (log id
      + the 4xx body), return { uploaded:0, dropped:[that record] }. Otherwise
      split records in half and recurse on each half, summing uploaded +
      concatenating dropped.
    - Any non-bisectable thrown error (401/403 auth, persistent 5xx after
      MAX_RETRIES, network/transport error with no status) RE-THROWS unchanged —
      caught by main()'s catastrophic path.
    - Single-record bisectable batch that still 4xxs → dropped+logged, never throws.
  </behavior>
  <action>
    Refactor scripts/upload-vectors.js for resilience. Keep `readNdjsonRecords`
    for the read (banned to use readFileSync utf-8 on data/ — CLAUDE.md). The
    per-record `JSON.stringify` on the wire (line 89) is bounded per-batch; keep it.

    1. **Make upsertBatch surface its HTTP status on throw.** In the non-retryable
       `if (!res.ok)` branch (line 112-115), attach the status to the Error
       (`const e = new Error(...); e.status = res.status; throw e;`). The 429/>=500
       branch is UNCHANGED (preserve the exponential backoff + MAX_RETRIES). Also
       attach `e.status = res.status` on the post-MAX_RETRIES throw so a persistent
       5xx is distinguishable, but do NOT bisect on 5xx (only on non-429/non-auth 4xx).

    2. **Add `export function validateVectors(records, opts = {})`** implementing
       the <behavior> above. Detect dimension D as the MODAL `values.length` across
       all valid-shaped records: do a first pass that, for each record whose
       `values` is a non-empty array of all-finite numbers, increments a
       `Map<length, count>`; D = the length with the highest count (ties → pick the
       larger length, or any deterministic tiebreak). Log `pre-validation: detected
       dimension D=${D} (modal across ${validShaped} valid-shaped records)`. Then
       drop records failing the id / array / finite / length===D checks. Use
       `Number.isFinite` per element (this is what rejects NaN/Infinity — the likely
       root cause per the bug report — and also rejects null/undefined/string
       elements). Return { valid, dropped, dimension: D }. Default `opts.log` to the
       module `log`.

    3. **Add `export async function upsertWithBisection(records, opts = {})`**
       implementing the <behavior> above. `opts.upsertFn` defaults to `upsertBatch`;
       `opts.log` defaults to `log`. Treat a thrown error as bisectable ONLY when
       `err.status >= 400 && err.status < 500 && err.status !== 429 && err.status !== 401 && err.status !== 403`.
       Any other thrown error (401/403 auth, persistent 5xx after retries,
       network error with no status) RE-THROWS — that is a genuine batch/transport/
       auth failure, not one bad record, and is handled by main()'s catastrophic
       path (step 5). Add a short comment on the 401/403 exclusion: "auth failures
       4xx every batch — bisecting would silently drop the whole corpus." Recurse
       halves down to single records; a single record that still 4xxs (bisectable)
       is dropped+logged.

    4. **Wire validateVectors into main() before the batch loop.** After
       `const records = [...recordsMap.values()]`, call
       `const { valid, dropped, dimension } = validateVectors(records)`. Log
       `pre-validation: kept ${valid.length}, dropped ${dropped.length} (dim=${dimension})`.
       Replace the existing first-record sanity block (lines 138-143) — its intent
       (confirm id + values shape, log dims) is now subsumed by validateVectors;
       keep the entity_type distribution log (lines 147-152) computed over `valid`.
       Iterate the batch loop over `valid` (not `records`).

    5. **Replace the batch-loop catch (lines 174-177).** Inside the loop, call
       `const r = await upsertWithBisection(batch)`, accumulate `uploaded += r.uploaded`
       and collect `r.dropped` into a run-level `uploadDropped` array. Only the
       catastrophic path (upsertWithBisection re-threw a non-bisectable error — auth
       401/403, persistent 5xx, or transport failure) should be a hard error — log
       it and `process.exit(1)` ONLY there.

    6. **Exit semantics (NHK-04).** Define a named threshold const near the top of
       the file:
       `// >= this dropped fraction = systemic failure (auth/wrong-dim/embed bug),`
       `// NOT a handful of bad embeddings → hard-fail rather than publish a near-empty index`
       `const CATASTROPHIC_SKIP_FRACTION = 0.5;`
       After the loop, compute
       `totalDropped = dropped.length + uploadDropped.length` and
       `skipFraction = records.length ? totalDropped / records.length : 1`. Log a
       prominent summary:
       `upserted ${uploaded} of ${valid.length}; dropped ${totalDropped} total (${(skipFraction*100).toFixed(2)}%)`.
       Then branch on skipFraction:
       - **`skipFraction >= CATASTROPHIC_SKIP_FRACTION`** (or `valid.length === 0`):
         this is systemic — almost everything is "bad", which means the reference
         dimension was wrong, auth dropped, or the embed step produced garbage, NOT
         one bad record. `console.error` a clear message + a `::error::` GitHub-
         Actions annotation, then **`process.exit(1)`** (do NOT publish a near-empty
         vector index — a hard fail that keeps yesterday's good index is better).
       - **`skipFraction > 0.05` (but `< CATASTROPHIC_SKIP_FRACTION`)**: log LOUDLY
         with `console.error` + a `::warning::` GitHub-Actions annotation line
         ("upload-vectors: ${...}% of records skipped — likely a systemic embed bug
         or a wrong reference dimension was detected; investigate") but STILL exit 0
         (lean toward refreshing the site; surface the count prominently).
       - **else (the normal case, a handful skipped)**: exit 0.
       Reserve non-zero exit for: missing input file (already handled, line 61-64),
       the catastrophic re-throw path in step 5 (auth/5xx/transport), and the
       catastrophic-skip-fraction guard above. Missing-creds soft-fail (already
       exits 0, lines 66-72) stays as is.

    7. **Guard the script-vs-import boundary using the repo's existing dual idiom.**
       The current file calls `main()` at module top-level (line 189). To let the
       test import validateVectors / upsertWithBisection WITHOUT executing
       main()/process.exit, wrap the `main()` invocation in the established
       Windows-safe `invokedAsScript` guard used by scripts/filter.js:558-570 and
       scripts/enrich.js:330 (NOT a one-off `pathToFileURL` — no sibling script uses
       that). `fileURLToPath` is ALREADY imported at upload-vectors.js:27, so add NO
       new import. Copy the dual form verbatim:
       ```js
       // Only run main() when invoked as a script, not when imported by tests.
       // import.meta.url is a file:// URL; process.argv[1] is a path. Normalize.
       const invokedAsScript = (() => {
         try {
           return import.meta.url === fileURLToPath(`file://${process.argv[1]}`).replace(/\\/g, '/')
             || fileURLToPath(import.meta.url) === process.argv[1];
         } catch {
           return false;
         }
       })();
       if (invokedAsScript) main();
       ```
       (Replace the existing top-level `main().catch(...)` call accordingly; if
       main() currently has a `.catch`, fold that handling into main() or keep the
       `.catch` inside the guard: `if (invokedAsScript) main().catch(...)`.) The dual
       form matters on this win32 machine because local dry-run is part of verify.
       This keeps `node scripts/upload-vectors.js` behavior identical while making
       the module import-safe for tests.
  </action>
  <verify>
    <automated>node --test scripts/upload-vectors.test.js 2>&1 | tail -20</automated>
  </verify>
  <done>
    validateVectors and upsertWithBisection are exported; main() validates before
    upload (modal dimension), bisects on non-429/non-auth 4xx, exits 0 on partial
    skip, hard-fails (exit 1) on catastrophic skip fraction (>=50%), and reserves
    exit 1 for missing-file / auth (401/403) / 5xx / transport re-throw. `node
    scripts/upload-vectors.js --input data/skill-vectors.ndjson` (dry-run without
    creds) still runs and logs a pre-validation summary. Importing the module does
    not trigger main(). The invoked-as-script guard matches the filter.js dual idiom
    (no pathToFileURL).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add scripts/upload-vectors.test.js covering validation + bisection + catastrophic re-throw</name>
  <files>scripts/upload-vectors.test.js</files>
  <behavior>
    - validateVectors drops a record whose values contains NaN; keeps the clean ones.
    - validateVectors drops a record whose values length != detected (modal) dimension.
    - validateVectors picks the MODAL dimension even when a wrong-dimension record
      sorts FIRST: given [wrongDim, good, good, good], the detected dimension is the
      good (majority) length and the first wrong-dim record is the one dropped — NOT
      all three good records.
    - validateVectors drops a record with empty/missing id.
    - validateVectors also drops Infinity and null-element vectors (Number.isFinite gate).
    - upsertWithBisection with a mock upsertFn that throws a {status:400} Error
      for any batch CONTAINING the bad id, and resolves for batches without it,
      isolates exactly the one bad record: returns uploaded === (N-1) and
      dropped === [badRecord], and never throws.
    - upsertWithBisection re-throws when the mock throws a status-less error or a
      persistent {status:503} (5xx/transport stay catastrophic, not dropped).
    - upsertWithBisection re-throws (does NOT bisect/drop) when the mock throws a
      {status:401} AND a {status:403} for every batch — proving an auth failure
      surfaces as catastrophic rather than silently dropping the whole corpus.
  </behavior>
  <action>
    Create scripts/upload-vectors.test.js matching the repo test pattern
    (see scripts/filter.test.js): `import { test } from 'node:test'`,
    `import assert from 'node:assert/strict'`, and
    `import { validateVectors, upsertWithBisection } from './upload-vectors.js'`.

    Use a silent log stub (`const log = () => {}`) passed via opts so tests don't
    spam output.

    Fixtures: a `mkVec(id, values)` helper. A "good" dimension of e.g. 4
    (`[0.1,0.2,0.3,0.4]`) — small is fine, validateVectors detects D modally from
    the records, no need for real 1536-dim vectors.

    Validation tests:
    - good + NaN-bearing record → dropped includes the NaN id, valid excludes it.
    - good + wrong-length record → dropped includes it.
    - MODAL detection: `[mkVec('odd',[1,1,1]), mkVec('a',[1,2,3,4]), mkVec('b',[5,6,7,8]), mkVec('c',[9,1,2,3])]`
      → assert `dimension === 4` (the majority), `valid` length === 3 (a,b,c),
      `dropped` contains exactly id 'odd'. (Proves the first record's dim does NOT
      win when it's the outlier.)
    - record with id:'' and id:undefined → both dropped.
    - good + [Infinity,...] and good + [null,...] → both dropped (Number.isFinite).
    Assert `dimension` equals the good vector's length and `dropped[i].reason` is
    a non-empty string (don't over-specify the wording).

    Bisection test (the core isolation proof):
    - Build N=5 records, one with id 'bad'.
    - mock `upsertFn = async (batch) => { if (batch.some(r => r.id === 'bad')) { const e = new Error('Vectorize HTTP 400: 40023'); e.status = 400; throw e; } return { uploaded: batch.length }; }`
      (shape the resolve value only as much as upsertWithBisection consumes —
      match whatever the Task 1 impl returns/uses; if it counts records itself,
      resolving undefined is fine).
    - Call `await upsertWithBisection(records, { upsertFn, log })`.
    - Assert `result.uploaded === 4`, `result.dropped.length === 1`,
      `result.dropped[0].id === 'bad'`. Assert it did NOT throw.

    Catastrophic re-throw tests:
    - mock upsertFn throws `new Error('socket hang up')` (no .status) → expect
      `assert.rejects(() => upsertWithBisection([...], { upsertFn, log }))`.
    - mock upsertFn throws an Error with `status = 503` → expect rejects
      (5xx is NOT a one-bad-record case).
    - mock upsertFn throws an Error with `status = 401` for EVERY batch → expect
      rejects (auth failure must NOT bisect-to-drop the whole corpus). Repeat with
      `status = 403`.
  </action>
  <verify>
    <automated>node --test scripts/upload-vectors.test.js 2>&1 | tail -25</automated>
  </verify>
  <done>
    `node --test scripts/upload-vectors.test.js` runs green; the required cases
    (NaN drop, wrong-dimension drop, MODAL detection with outlier-first, empty-id
    drop, bisection isolating one bad record in a batch, plus the 5xx/no-status
    AND 401/403 re-throw guards) all pass. `npm test` (whole suite) also stays green.
  </done>
</task>

</tasks>

<verification>
- `node --test scripts/upload-vectors.test.js` passes; `npm test` (whole suite,
  including the new upload-vectors.test.js) stays green.
- `node scripts/upload-vectors.js --input data/skill-vectors.ndjson` (no CF creds
  locally → dry-run path) prints a `pre-validation: detected dimension D=...` line,
  a `pre-validation: kept N, dropped M` line, and exits 0.
- `npm run check:patterns` stays green — the read still uses readNdjsonRecords,
  no new `readFileSync(...,'utf-8')` on data/, no `.map(JSON.stringify).join`
  beyond the existing bounded per-batch line at upsertBatch.
- daily-scrape.yml lines 400-408 unchanged: the same `node scripts/upload-vectors.js
  --input "$f"` invocation now benefits for all three of skill/plugin/mcp vectors
  (single shared uploader). No workflow edit required.
</verification>

<success_criteria>
- One malformed vector (NaN/Infinity/null value, wrong dimension, or empty id)
  is dropped+logged and the run still completes with exit 0.
- A non-429/non-auth 4xx batch upsert bisects to isolate and drop only the
  offending record(s); 429/5xx keep the existing exponential-backoff retry.
- An auth 401/403 (or persistent 5xx / transport failure) re-throws as
  catastrophic — it does NOT silently bisect-and-drop the whole corpus.
- The reference dimension is detected MODALLY, so a wrong-dimension outlier
  sorting first cannot drop all the good records.
- The uploader exits 0 on partial skip so daily-scrape's publish→build→deploy
  steps proceed and the site refreshes; non-zero exit reserved for missing input
  file / auth / 5xx-transport / catastrophic skip fraction (>=50%).
- A skip fraction between 5% and 50% is surfaced loudly (console.error +
  ::warning::) but does NOT fail the run; >=50% hard-fails (::error:: + exit 1)
  rather than publishing a near-empty index.
- Fix covers all three vector files via the one shared uploader.
</success_criteria>

<output>
After completion, create
`.planning/quick/260624-nhk-make-upload-vectors-js-resilient-to-malf/260624-nhk-SUMMARY.md`
</output>

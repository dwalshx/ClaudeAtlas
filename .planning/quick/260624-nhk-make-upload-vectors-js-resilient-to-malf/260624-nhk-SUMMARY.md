---
phase: quick-260624-nhk
plan: 01
subsystem: pipeline/vectorize-upload
tags: [resilience, vectorize, daily-cron, error-handling]
requires:
  - scripts/lib/ndjson.js (readNdjsonRecords)
provides:
  - validateVectors (modal-dimension pre-flight drop of malformed vectors)
  - upsertWithBisection (4xx bisection isolating bad record(s); auth/5xx re-throw)
  - exit-0-on-partial-skip + catastrophic-skip-fraction hard-fail
affects:
  - .github/workflows/daily-scrape.yml "Upload vectors to Vectorize" step (no edit; benefits via shared uploader)
tech-stack:
  added: []
  patterns:
    - "filter.js dual invoked-as-script guard (import-safe module for tests)"
    - "err.status attachment for HTTP-class-aware error handling"
key-files:
  created:
    - scripts/upload-vectors.test.js
  modified:
    - scripts/upload-vectors.js
decisions:
  - "Reference dimension detected MODALLY (not first-record) so a wrong-dim outlier sorting first cannot drop all good records"
  - "401/403 EXCLUDED from bisectable set — auth 4xxs every batch; bisecting would silently drop the whole corpus"
  - "5xx/429-after-retries/transport stay catastrophic (re-throw), NOT bisected"
  - "Exit 1 reserved for: missing file, auth, persistent 5xx/transport, and >=50% skip fraction; >5% logs ::warning:: but exits 0"
  - "Restored a first-valid-vector log line (entity_type=<type>) to keep the pre-existing Task 10 dry-run regression green after removing the old first-record sanity block"
metrics:
  duration: ~15m
  completed: 2026-06-24
---

# Quick Task 260624-nhk: Make upload-vectors.js Resilient to Malformed Vectors Summary

Hardened `scripts/upload-vectors.js` so one bad embedding (the `line Some(139) was not expected format` Vectorize 400 that has failed the daily cron 4 days running) can no longer abort the daily publish→build→deploy chain. Added modal-dimension pre-validation, recursive 4xx bisection that isolates and drops only the offending record(s), preserved the existing 429/5xx backoff, made the uploader exit 0 on a handful of skips, and hard-fail only on systemic failure (auth, persistent 5xx/transport, or ≥50% skip fraction). The fix covers skills/plugins/MCP via the single shared uploader looped in daily-scrape.yml.

## What Shipped

- **`validateVectors(records, opts)`** — first pass counts `values.length` frequencies among valid-shaped (non-empty, all-finite) records and picks the **modal** dimension D (tie → larger length). Second pass drops records with missing/empty id, non-array/empty values, any non-finite element (`Number.isFinite` rejects NaN/Infinity/-Infinity/null/undefined/strings), or `values.length !== D`. Returns `{ valid, dropped: [{id, reason}], dimension }` and logs each drop + a total.
- **`upsertWithBisection(records, opts)`** — calls `opts.upsertFn` (defaults to `upsertBatch`, preserving 429/5xx backoff). Treats a thrown error as bisectable only when `status >= 400 && < 500 && !== 429 && !== 401 && !== 403`. On bisectable 4xx: single record → drop+log (never throws); else split in half and recurse, summing uploaded + concatenating dropped. Any non-bisectable error (401/403 auth, persistent 5xx after retries, status-less transport) re-throws unchanged.
- **`upsertBatch`** now attaches `e.status = res.status` on both the non-retryable `!res.ok` throw and the post-MAX_RETRIES 429/5xx throw, so the bisection layer can classify. Backoff path unchanged.
- **`main()`** validates before the batch loop (logs modal D + kept/dropped), iterates `valid` (not raw records), accumulates `uploadDropped`, and computes `skipFraction = totalDropped / records.length`. Exit branch: `>=50%` (or `valid.length===0`) → `::error::` + exit 1; `>5%` → `::warning::` + exit 0; else exit 0. The old `process.exit(1)`-on-any-batch-error is gone — only the non-bisectable re-throw and the catastrophic-fraction guard hard-fail.
- **Invoked-as-script guard** — `main()` is now behind the filter.js/enrich.js dual Windows-safe `invokedAsScript` idiom (`fileURLToPath` already imported; no new import), so tests import `validateVectors`/`upsertWithBisection` without running `main()` or `process.exit`.
- **`scripts/upload-vectors.test.js`** (new, 168 lines) — node:test + node:assert/strict, in-memory fixtures, injected mock `upsertFn`. Covers: NaN drop, wrong-dim drop, MODAL detection with outlier-first, empty/missing-id drop, Infinity+null drop, one-bad-record isolation in a 4xx batch (uploaded===4, dropped===['bad'], no throw), and re-throw on status-less / 503 / 401 / 403.

## Verification

- `node --test scripts/upload-vectors.test.js` → 10/10 pass.
- `npm test` (whole suite) → 204 pass, 0 fail, 6 skipped (same skips as baseline). The pre-existing `scripts/__tests__/upload-vectors.test.js` Task 10 dry-run regression stays green (see deviation below).
- `npm run check:patterns` → `lint mode: clean (0 baselined, 0 new)`. Read still uses `readNdjsonRecords`; no `readFileSync(...,'utf-8')` on data/; the only `.map(JSON.stringify).join` is the pre-existing bounded per-batch wire line in `upsertBatch`.
- **Dry-run against the real on-disk vectors file** (`data/skill-vectors.ndjson`, 1078 records present locally): `node scripts/upload-vectors.js --input data/skill-vectors.ndjson --dry-run` → `detected dimension D=1536 (modal across 1078 valid-shaped records)`, `kept 1078, dropped 0`, exit 0. The `validateVectors` path was exercised on real data and reported zero drops on the local snapshot. (Note: the production 67,288-record skill-vectors file that triggered the bug is generated in CI, not present locally — the unit test covers the malformed-record paths the local clean file cannot.)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Restored a first-valid-vector log line to keep an existing regression test green**
- **Found during:** Task 1 (full-suite run after the refactor)
- **Issue:** Plan step 4 said to "replace the existing first-record sanity block (lines 138-143)" because its intent is "subsumed by validateVectors." Removing it deleted the `first vector: id=... entity_type=<type>` log line, which the pre-existing `scripts/__tests__/upload-vectors.test.js` Task 10 dry-run test asserts via `assert.match(log, /entity_type=plugin/)`. That test went red (1 fail in the full suite). The plan did not anticipate this existing consumer of the deleted log line.
- **Fix:** Re-added a single guarded log line over the **valid** records — `first vector: id=${first.id} dims=${first.values.length} entity_type=${first.metadata?.entity_type || '(none)'}` — preserving the diagnostic and the regression contract. The modal-dimension validation still owns the actual shape gate; this line is now purely diagnostic.
- **Files modified:** scripts/upload-vectors.js
- **Commit:** f5c6f85 (folded into the Task 1 source commit)

## Commits

- `f5c6f85` feat(quick-260624-nhk): harden upload-vectors with pre-validation + 4xx bisection
- `04bff33` test(quick-260624-nhk): cover validateVectors + upsertWithBisection resilience

## Known Stubs

None.

## Self-Check: PASSED

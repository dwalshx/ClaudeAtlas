---
phase: quick-260624-nhk
verified: 2026-06-24T00:00:00Z
status: passed
score: 6/6 must-haves verified
re_verification: false
---

# Quick Task 260624-nhk: Resilient upload-vectors.js Verification Report

**Task Goal:** Make `scripts/upload-vectors.js` resilient so one malformed vector can't abort the daily pipeline — pre-validate (drop NaN/Infinity/null/wrong-dim/empty-id), bisect non-429/non-auth 4xx batches to isolate the bad record, preserve 429/5xx backoff, exit 0 on partial skip, hard-fail (exit 1) on catastrophic skip (auth 401/403, persistent 5xx, or ≥50% dropped).
**Verified:** 2026-06-24
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1   | A single malformed vector (NaN/Infinity/null/wrong-dim/empty-id) is dropped+logged, never aborting the run | ✓ VERIFIED | `validateVectors` (upload-vectors.js:150-209) drops via `Number.isFinite` gate (159, 192), modal-dim check (196), id check (180); tests pass for NaN/Infinity/null/wrong-dim/empty-id |
| 2   | A non-429/non-auth 4xx batch is recursively bisected to isolate the offending record(s) | ✓ VERIFIED | `upsertWithBisection` (224-260): `bisectable` excludes 429/401/403 (233-236); recurses on halves (252-254); single-record drop (246-250). Test "isolates exactly one bad record" → uploaded=4, dropped=['bad'], no throw |
| 3   | The 429/5xx exponential-backoff retry (MAX_RETRIES) is preserved unchanged | ✓ VERIFIED | `upsertBatch` 429/>=500 branch (108-121) keeps `2000 * 2^attempt` backoff up to MAX_RETRIES=4; only adds `e.status` attachment on the post-retry throw (113-114) |
| 4   | Exits 0 on a handful of skips so publish→build→deploy proceed | ✓ VERIFIED | main() exit branches (338-350): only catastrophic-fraction or re-throw hard-fails; warn path (346) exits 0; normal path falls through to exit 0. Local dry-run exited 0 |
| 5   | Non-zero exit reserved for catastrophic: missing file, auth 401/403, persistent 5xx/transport, OR ≥50% skip fraction | ✓ VERIFIED | Missing file (61-64); soft-fail creds exit 0 (66-72); non-bisectable re-throw → `::error::` + exit 1 (316-324); `skipFraction >= 0.5 \|\| valid.length===0` → `::error::` + exit 1 (338-345) |
| 6   | Fix applies to all three vector files (skills/plugins/mcp) via the one shared uploader | ✓ VERIFIED | Single file `scripts/upload-vectors.js` parameterized by `--input` (36-51); daily-scrape.yml loops all three over the same script (per CLAUDE.md / PLAN interfaces) — no per-file branching |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `scripts/upload-vectors.js` | `export function validateVectors` | ✓ VERIFIED | Line 150; modal-dim detection (155-173), drop logic + logging (176-206) |
| `scripts/upload-vectors.js` | `export async function upsertWithBisection` | ✓ VERIFIED | Line 224; recursive bisection isolating bad record(s) |
| `scripts/upload-vectors.test.js` | node:test coverage, min_lines 60 | ✓ VERIFIED | 168 lines, 10 tests covering all required cases |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| main() | validateVectors | pre-upload filter | ✓ WIRED | Called at line 279, iterates `valid` in batch loop (311-312) |
| batch loop | upsertWithBisection | replaces process.exit(1)-on-any-error | ✓ WIRED | Called at line 315; old unconditional `process.exit(1)` gone — only catastrophic re-throw + fraction guard hard-fail |
| test file | validateVectors + upsertWithBisection | named imports + mock fetch | ✓ WIRED | `import { validateVectors, upsertWithBisection } from './upload-vectors.js'` (line 18); injected mock `upsertFn` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Unit test suite | `node --test scripts/upload-vectors.test.js` | 10 pass, 0 fail | ✓ PASS |
| Banned-pattern lint | `npm run check:patterns` | `lint mode: clean (0 baselined, 0 new)` | ✓ PASS |
| Dry-run on real local data | `node scripts/upload-vectors.js --input data/skill-vectors.ndjson --dry-run` | `detected dimension D=1536 (modal across 1078 valid-shaped records)`, `kept 1078, dropped 0`, EXIT=0 | ✓ PASS |
| Import-safety guard | dual `invokedAsScript` idiom (361-368) | Test imports run without triggering main()/process.exit | ✓ PASS |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
| ----------- | ----------- | ------ | -------- |
| NHK-01 | Pre-validate / drop malformed vectors | ✓ SATISFIED | `validateVectors` + 5 validation tests |
| NHK-02 | Bisect non-429/non-auth 4xx | ✓ SATISFIED | `upsertWithBisection` + isolation test |
| NHK-03 | Preserve 429/5xx backoff; auth/5xx re-throw catastrophic | ✓ SATISFIED | `upsertBatch` backoff intact; 401/403/503/status-less re-throw tests |
| NHK-04 | Exit semantics (0 on partial, 1 on catastrophic) | ✓ SATISFIED | main() exit branches (338-350) + `::error::`/`::warning::` annotations |

### Anti-Patterns Found

None. No `readFileSync(...,'utf-8')` on data/ (read uses `readNdjsonRecords`); the only `.map(JSON.stringify).join` is the pre-existing bounded per-batch wire line in `upsertBatch` (96). No TODO/FIXME/placeholder/stub. `check:patterns` clean.

### Detailed Confirmation Against Requested Checks

1. `validateVectors` — exists (150), MODAL detection (Pass 1 length-frequency map 155-173, tie → larger length 169), `Number.isFinite` gate rejects NaN/Infinity/null (159, 192), wrong-dim drop (196), empty/non-string-id drop (180), per-drop + total logging (203-206). CONFIRMED.
2. `upsertWithBisection` — bisectable set is 4xx EXCLUDING 429/401/403 (233-236); non-bisectable (401/403/5xx/status-less transport) re-throws unchanged (238-244), not silently dropped. CONFIRMED.
3. 429/5xx exponential backoff preserved in `upsertBatch` (108-121), MAX_RETRIES=4, unchanged except `e.status` attachment. CONFIRMED.
4. main() exits 0 on handful of skips; `skipFraction >= 0.5 || valid.length === 0` → `::error::` + exit 1 (338-345); `> 0.05` → `::warning::` + exit 0 (346-350). CONFIRMED.
5. main() behind dual `invokedAsScript` guard (361-375) — filter.js/enrich.js idiom, no new import. Test imports functions without running main(). CONFIRMED.
6. `node --test scripts/upload-vectors.test.js` → 10 pass / 0 fail. `npm run check:patterns` → clean. Actual output captured above. CONFIRMED.

### Gaps Summary

No gaps. All six observable truths verified, all artifacts present and substantive, all key links wired, all four requirements satisfied. Unit tests (10/10) and the banned-pattern lint both pass when run live, and the `validateVectors` path was exercised on the real local `data/skill-vectors.ndjson` (1078 records, modal D=1536, 0 dropped, exit 0). Commits f5c6f85 (source) and 04bff33 (tests) are present on main.

Note: the production 67,288-record skill-vectors file that triggered the original Vectorize 400 is generated in CI and not present locally, so the live bisection-against-Vectorize path cannot be exercised here. The unit suite covers the malformed-record and catastrophic-re-throw branches with an injected mock `upsertFn`, which is the appropriate substitute. This is not a gap — it is an inherent property of the data being CI-generated.

---

_Verified: 2026-06-24_
_Verifier: Claude (gsd-verifier)_

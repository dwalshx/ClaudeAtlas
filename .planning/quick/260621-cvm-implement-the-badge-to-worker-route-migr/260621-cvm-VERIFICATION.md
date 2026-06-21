---
phase: quick-260621-cvm
verified: 2026-06-21T00:00:00Z
status: human_needed
score: 5/7 truths verified (2 require wrangler dev — human_needed, expected)
human_verification:
  - test: "wrangler dev curl smoke — tier badge, history chart, multi-segment slug, unknown slug, headers"
    expected: "Each /badge/{slug}.svg and /badge/{slug}-history.svg returns a valid SVG (never 404), correct content-type + cache-control headers"
    why_human: "Sandbox cannot reliably run `npx wrangler dev` and curl a local Worker. Documented as the blocking checkpoint (Task 3) in SUMMARY — expected incomplete, NOT a gap."
  - test: "Worker-generated SVG byte-identical to old static file at runtime"
    expected: "Zero byte diff between Worker output and prior public/badge/<slug>.svg"
    why_human: "Executor already proved zero diff via a throwaway harness (9218 tier + 9218 history, 0 diffs) but the harness was deleted. Code-level verbatim port is confirmed below; live re-confirmation needs wrangler dev."
---

# Phase quick-260621-cvm: Badge → Worker Route Migration Verification Report

**Phase Goal:** Move ~18k+ static badge SVGs to an on-demand Worker route to halve deploy file count and fix the assets-upload-session 504.
**Verified:** 2026-06-21
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | npm run build produces NO dist/badge/ directory | ✓ VERIFIED | prebuild calls `generate-badge-data.js` (package.json:23), NOT `generate-badges.js` (deleted). No script emits public/badge/. SUMMARY reports dist file count 11,561 (was ~30k). Code-path confirmed; full build not re-run. |
| 2 | wrangler dev serves /badge/{slug}.svg and -history.svg per-request | ? UNCERTAIN | Route wired (worker/index.js:886) + handleBadge implemented. Live serving needs wrangler dev → human_needed. |
| 3 | Worker tier SVG byte-identical to old static file | ✓ VERIFIED (code) | worker/badge.js:28-189 ports SITE_URL/REF_PARAM/TIER_COLORS/escapeXml/textWidth/validateSlug/buildTierBadgeSvg verbatim under an explicit "DO NOT REFORMAT" banner. SUMMARY harness: 9218 tier, 0 diffs. Live re-confirm → human. |
| 4 | Worker history SVG byte-identical to old static file | ✓ VERIFIED (code) | buildStarHistoryChartSvg (worker/badge.js:113-189) verbatim; ms→ISO conversion (line 262) feeds the builder the exact `{t,c}` ISO shape the old generator used. SUMMARY harness: 9218 history, 0 diffs. |
| 5 | Multi-segment slugs resolve correctly | ✓ VERIFIED | handleBadge (worker/badge.js:213-224) slices `/badge/` prefix + `.svg` suffix + optional `-history`, does NOT split on `/`. Bundle confirms multi-segment repo `K-Dense-AI/scientific-agent-skills` present. |
| 6 | Unknown slug returns 'listed' badge, never 404 | ✓ VERIFIED | worker/badge.js:246-248 synthesizes `{ slug, name: slug, quality_tier: 'listed' }` on KV miss; KV errors caught (237-244) and fall through to synthetic. No 404 path for valid slugs. |
| 7 | npm run check:patterns passes | ✓ VERIFIED | Ran live: `lint mode: clean (0 baselined, 0 new)`. New allowlist entry for generate-badge-data.js present (check-banned-patterns.js:154-157). |

**Score:** 5/7 truths VERIFIED at code level; 2 UNCERTAIN pending wrangler dev (expected, human_needed).

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `scripts/generate-badge-data.js` | Build-time bundle generator, ≥60 lines, streaming ndjson read | ✓ VERIFIED | 189 lines. Uses `readNdjsonRecords` (line 37/129), NOT readFileSync on data/skills.ndjson. Writes `data/badge-star-history.json` as `{repo: [[tsMs,count]]}`. Verbatim merge + downsample logic ported. |
| `worker/badge.js` | handleBadge + verbatim builders, ≥120 lines, exports handleBadge | ✓ VERIFIED | 277 lines. `export async function handleBadge` (line 210). Verbatim port region 28-189. Multi-segment safe, never-404, ms→ISO conversion present. |
| `data/badge-star-history.json` | Compact star-history map, bundled, tracked | ✓ VERIFIED | Exists (445 KB), git-tracked, NOT gitignored. 158 repos, sample series 61 pts, shape `[[tsMs,count]]` confirmed. (408 KB→445 KB; SUMMARY documents size > doc estimate due to 17 merged snapshots.) |
| `worker/index.js` | Imports bundle + handleBadge; /badge/* before ASSETS | ✓ VERIFIED | Imports at lines 48-49. Route at 886-888 sits BEFORE ASSETS fallthrough (890-893). Reuses pre-parsed `url`. |
| `wrangler.toml` | run_worker_first includes /badge/* | ✓ VERIFIED | Line 31: `run_worker_first = ["/skills/*", "/api/*", "/badge/*"]`. |
| `scripts/generate-badges.js` | DELETED | ✓ VERIFIED | `ls` → No such file. Git keeps history as byte-identical reference. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| package.json prebuild | generate-badge-data.js | npm prebuild invocation | ✓ WIRED | prebuild contains `generate-badge-data.js`, no `generate-badges.js`. |
| worker/index.js | data/badge-star-history.json | native JSON import | ✓ WIRED | `import badgeStarHistory from '../data/badge-star-history.json'` (line 48). |
| worker/index.js | worker/badge.js | handleBadge dispatch on /badge/ | ✓ WIRED | `import { handleBadge }` (49); dispatched 887 before ASSETS. |
| worker/badge.js | env.SKILLS_KV | tier lookup per slug | ✓ WIRED | `await env.SKILLS_KV.get(slug)` (line 237), JSON.parse → buildTierBadgeSvg. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| scripts/generate-badge-data.js | 73, 145, 183 | readFileSync('utf-8') / JSON.stringify pretty-print on data/ | ℹ️ Info | Bounded sidecars (history snapshots, star-history.json, ~445 KB bundle). Explicitly allowlisted (check-banned-patterns.js:154-157). check:patterns clean. Not a violation. |

No blocker anti-patterns. The KV-miss synthetic 'listed' record is required behavior (never-404), not a stub.

### Human Verification Required

#### 1. wrangler dev curl smoke (Task 3 blocking checkpoint)

**Test:** `npx wrangler dev`, then curl:
- `/badge/santifer/career-ops.svg` (tier, 2-segment)
- `/badge/santifer/career-ops-history.svg` (history chart, NOT placeholder)
- `/badge/K-Dense-AI/scientific-agent-skills/research-lookup.svg` (multi-segment)
- `/badge/does-not/exist.svg` (unknown → 'listed', not 404)
- `curl -sI` header check: `content-type: image/svg+xml; charset=utf-8` + `cache-control: public, max-age=86400, s-maxage=86400`

**Expected:** Valid SVGs, never 404, correct headers.
**Why human:** Sandbox cannot run wrangler dev + curl a local Worker. This is the documented blocking checkpoint in the PLAN/SUMMARY — expected incomplete, not a gap.

### Gaps Summary

No goal-blocking gaps. Every must_have artifact exists, is substantive, and is correctly wired. All four key links are connected. `generate-badges.js` is deleted, `data/badge-star-history.json` is tracked (the Rule 3 deviation from "gitignored" was correctly resolved — the bundle must ship with the Worker on push-event deploys), prebuild is swapped, run_worker_first includes `/badge/*`, the route precedes the ASSETS fallthrough, and `check:patterns` passes clean.

The Rule 1 ms→ISO bug (history charts rendering placeholder due to `Date.parse(<number>)` → NaN) was caught by the executor's diff harness and fixed at worker/badge.js:262 — verified present in the merged code.

The only outstanding items are the two truths requiring a running `wrangler dev` (live serving + live byte-identical re-confirmation). Both are explicitly delegated to the human in the SUMMARY's blocking checkpoint and are EXPECTED to be incomplete in the sandbox. Per the verification brief, these are marked human_needed, not gaps. Overall status: **human_needed**.

---

_Verified: 2026-06-21_
_Verifier: Claude (gsd-verifier)_

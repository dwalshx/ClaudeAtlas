---
task: 260804-eh7
title: Per-repo diversity cap on homepage featured + Top-N selection
type: quick
scope: selection/render-only
status: complete
destined_for: PR (commits left on worktree branch)
key-files:
  created:
    - scripts/entities-select.test.js
  modified:
    - src/lib/entities.js
    - src/lib/skills.js
    - src/pages/index.astro
commits:
  - f9bd075  feat(quick-260804-eh7): add per-repo diversity cap to featured selection
  - 748c198  feat(quick-260804-eh7): apply per-repo diversity cap to homepage Top-N grid
---

# Quick 260804-eh7: Per-repo diversity cap on homepage selection

## One-liner

A single mega-repo could occupy multiple cards in the homepage's small curated
grids. Added a selection-only `capPerRepo()` helper and wired it into the
Featured strip (1 card/repo) and the Top-60 grid (2 cards/repo). No score,
tier, or filter logic was touched.

## What changed

### Task 1 — selection logic + test (`f9bd075`)

New pure helper in `src/lib/entities.js`, re-exported through the
`src/lib/skills.js` shim, and `getFeaturedSkills` rewired to use it.

**`capPerRepo` implementation:**

```js
export function capPerRepo(entities, maxPerRepo = 2) {
  if (!Array.isArray(entities)) return [];
  // A non-positive / non-finite cap disables the filter (pass-through copy).
  if (!Number.isFinite(maxPerRepo) || maxPerRepo <= 0) return [...entities];

  const counts = new Map();
  const out = [];
  for (const e of entities) {
    const repo = e?.repo_full_name || '';
    if (!repo) {
      // No repo identity to group on — always keep.
      out.push(e);
      continue;
    }
    const seen = counts.get(repo) || 0;
    if (seen < maxPerRepo) {
      counts.set(repo, seen + 1);
      out.push(e);
    }
  }
  return out;
}
```

**`getFeaturedSkills` — before:**

```js
export function getFeaturedSkills(limit = 6) {
  return allSkills.filter(notDuplicate).filter((s) => s.quality_tier === 'featured').slice(0, limit);
}
```

**`getFeaturedSkills` — after** (adds a deterministic sort + per-repo cap;
the added `byQualityDesc` comparator mirrors filter.js's tier tiebreak so
selection is stable across builds):

```js
function byQualityDesc(a, b) {
  return (
    (b.quality_score || 0) - (a.quality_score || 0) ||
    (b.repo_stars || 0) - (a.repo_stars || 0) ||
    String(a.id || '').localeCompare(String(b.id || ''))
  );
}

export function getFeaturedSkills(limit = 6, maxPerRepo = 1) {
  const featured = allSkills
    .filter(notDuplicate)
    .filter((s) => s.quality_tier === 'featured')
    .sort(byQualityDesc);
  return capPerRepo(featured, maxPerRepo).slice(0, limit);
}
```

**Observed effect on `getFeaturedSkills(6)` against the local catalog:**

Before — 6 cards, 4 distinct repos (`affaan-m/everything-claude-code` and
`rtk-ai/rtk` each appeared twice):

```
affaan-m/everything-claude-code
affaan-m/everything-claude-code   <-- dup
ruvnet/ruflo
rtk-ai/rtk
rtk-ai/rtk                        <-- dup
santifer/career-ops
```

After — 6 cards, 6 distinct repos:

```
affaan-m/everything-claude-code
ruvnet/ruflo
rtk-ai/rtk
santifer/career-ops
sickn33/antigravity-awesome-skills
github/awesome-copilot
```

### Task 2 — homepage Top-N grid (`748c198`)

`src/pages/index.astro` now imports `capPerRepo` and applies it to the
sorted catalog before slicing to 60:

```js
const HOMEPAGE_LIMIT = 60;
const TOP_MAX_PER_REPO = 2;
const allSorted = [...allSkills].sort((a, b) => b.quality_score - a.quality_score);
const topSkills = capPerRepo(allSorted, TOP_MAX_PER_REPO).slice(0, HOMEPAGE_LIMIT);
```

On the current local snapshot the Top-60 already happened to carry ≤2 cards
per repo, so this run's grid is unchanged — the cap is a defensive guard that
binds once a repo contributes 3+ top-ranked skills (expected in the 35k-record
production catalog, where mega-repos concentrate high scores). Full catalog
remains browseable at `/browse`.

## Design notes

- **Selection/render-only.** `capPerRepo` never mutates records; it filters an
  already-ranked list and returns a copy. `score.js`, `filter.js`,
  `quality_tier`, and all score values are untouched.
- **Cap semantics:** entities without a `repo_full_name` are never grouped
  (always kept); a cap of `<= 0` / non-finite is a pass-through; order is
  always preserved.
- **Featured cap = 1, Top-N cap = 2.** The 6-card Featured hero strip favors
  maximum author variety; the larger 60-card grid tolerates 2 per repo.

## Verification

### `node --test scripts/entities-select.test.js` — 8/8 pass

The test is self-contained: it writes a tiny NDJSON fixture to a temp path and
sets `SKILLS_NDJSON_OVERRIDE` before importing `entities.js`, so it needs no
generated data file.

```
1..8
# tests 8
# suites 0
# pass 8
# fail 0
# duration_ms 179.7145
```

Coverage: cap enforcement + order preservation, entities without a repo,
non-positive/non-finite/NaN caps (pass-through + returns a copy), non-array
input, and `getFeaturedSkills` (default 1/repo excludes dups + non-featured,
explicit higher cap, limit-after-cap, sorted-by-score).

### `npm run check:patterns` — clean

```
[check-banned-patterns] lint mode: clean (0 baselined, 0 new)
```

Run after both Task 1 and Task 2 edits.

### `npm run build` — success (the real render safety check)

```
[build] 2056 page(s) built in 15.26s
[build] Complete!

> postbuild
[sitemap-completeness] skills.ndjson: 1247 records ... OK
[asset-sizes] OK — all 2055 assets under 24 MiB, file count under 80k threshold
```

The homepage (`src/pages/index.astro`) rendered with the new capped Top-N
selection; sitemap-completeness and asset-size postbuild gates both passed.

## Deviations from plan

1. **[Rule 3 — Blocking] Generated `data/skills.ndjson` locally to run the
   build.** The worktree had only the legacy `data/skills.json` (v1 JSON
   array); `entities.js`/`build-input.js` require `data/skills.ndjson`, which
   is gitignored and absent locally (normally produced by `npm run filter`
   from the ~295 MB `skills-raw.json`, not present here). Converted the 1,246
   legacy records to NDJSON (with a `{_header,schema_version:2,entity_type}`
   sentinel line) so the build could run. This file is gitignored and was
   **not committed** — it is a build input only, analogous to running
   `npm run filter`.

2. **Plan file not present in worktree.** The referenced
   `260804-eh7-PLAN.md` did not exist in the worktree (the `260804-eh7-…`
   directory was absent). Executed directly from the orchestrator's task
   message and the explicit constraints (touch set, verification commands,
   cap semantics), which fully specified the work.

## Out of scope / left as-is

- `getSkillsByCategory`, `/browse`, and category pages are unchanged — the cap
  is intentionally homepage-only. The full catalog stays fully discoverable at
  `/browse`.

## Self-Check: PASSED

- FOUND: src/lib/entities.js (capPerRepo + getFeaturedSkills)
- FOUND: src/lib/skills.js (capPerRepo re-export)
- FOUND: src/pages/index.astro (TOP_MAX_PER_REPO capPerRepo wiring)
- FOUND: scripts/entities-select.test.js (8/8 pass)
- FOUND commit: f9bd075
- FOUND commit: 748c198

# Testing Patterns

**Analysis Date:** 2026-04-14

## Summary: There Is No Test Suite

**ClaudeAtlas has zero unit, integration, or end-to-end tests.** Verified by:
- No `test`, `tests`, or `__tests__` directory exists at the repo root or under `src/` / `scripts/`.
- No `*.test.js` or `*.spec.js` files anywhere in the tree (excluding `node_modules`/`dist`).
- `package.json` has **no `devDependencies` field at all** — no Jest, Vitest, Mocha, Playwright, Cypress, uvu, tap, or any assertion library is installed.
- `package.json:6-22` `scripts` section has no `test`, `lint`, `typecheck`, or `format` entries.
- No CI steps invoke a test runner. The pipeline at `.github/workflows/daily-scrape.yml` goes scrape → filter → embed → upload → build → deploy with no test gate.

This is a deliberate choice for a solo-maintainer static-site project — correctness is enforced by production-like CI runs and regression guards rather than in-process assertions. The sections below document what actually guards the codebase today.

## Current Verification Strategy

The project relies on **four production signals** as its de facto test suite:

### 1. Regression Guard — Skills Count Floor

**Location:** `.github/workflows/daily-scrape.yml:89-97`

```yaml
- name: Check skills count
  run: |
    CURRENT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('data/skills.json','utf8')).length)")
    echo "Current skills count: $CURRENT"
    if [ "$CURRENT" -lt 100 ]; then
      echo "::error::Skills count too low: $CURRENT (minimum 100)"
      exit 1
    fi
```

- Runs after `npm run filter` writes `data/skills.json`.
- Fails the workflow (non-zero exit, blocks deploy, stops the `Commit skills data` step) if the curated count drops below 100.
- **What it catches:** filter over-regression, scraper catastrophic failure, wholesale frontmatter schema drift that makes every skill fail `isSlop`.
- **What it misses:** silent schema field drops, score distribution shifts, individual skill corruption, content degradation while count is stable.
- The floor is generous — current catalog is ~1,078. A 90% loss would still pass the threshold's lower bound for "something is very wrong" vs. "nothing is wrong."

### 2. Build-Time Type & Import Check

**Location:** `.github/workflows/daily-scrape.yml:99-103` (`npm run build` → `astro build`)

- Astro runs a TypeScript check across `.astro` files during build (enforced by `tsconfig.json:2` extending `astro/tsconfigs/strict`).
- **What it catches:** missing imports, broken `.astro` frontmatter syntax, bad JSX-in-Astro expressions, missing exports from `src/lib/skills.js`, bad MDX/markdown references, missing images, misconfigured `getStaticPaths` for `src/pages/skills/[...slug].astro` and `src/pages/category/[category].astro`.
- **What it misses:** any bug inside a `.js` script (scripts aren't type-checked; `tsconfig.json:7` sets `allowJs: true` but scripts aren't included in the build at all), runtime logic errors, visual regressions.

### 3. Post-Deploy Health Check

**Location:** `.github/workflows/daily-scrape.yml:113-121`

```yaml
- name: Health check
  run: |
    sleep 10
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://claudeatlas.com || echo "000")
    ...
    if [ "$STATUS" != "200" ]; then
      echo "::warning::Site health check returned HTTP $STATUS (may still be deploying)"
    fi
```

- **This is a warning, not a failure** (emits `::warning::`, does not exit non-zero). A fully broken deploy will still be marked green.
- Only hits the homepage — does not verify `/skills/*`, `/category/*`, `/methodology`, `/creators`, `/apis`, or the sitemap.
- No content assertion (not checking for "Featured" string, skill count text, etc.).

### 4. Defensive Graceful Degradation in `src/lib/skills.js`

Three optional data files are wrapped in `existsSync` + `try/catch` so a missing pre-build artifact does not fail the build — it just degrades the feature:

- `src/lib/skills.js:16-25` — `data/similar-skills.json` missing → "similar skills" recommendations render empty.
- `src/lib/skills.js:27-36` — `data/api-graph.json` missing → API integration badges silently disappear.
- Filter's prior-enrichment loader at `scripts/filter.js:30-52` — unreadable prior `skills.json` → preserved fields are dropped (non-fatal).

These aren't tests but they are the project's core resilience pattern. Any new optional data source should follow the same shape.

## Manual Calibration Checks

Per `CLAUDE.md` §Known Issues #3:

> Scoring has been calibrated once against real data (2026-04-10). First raw run had 18k skills hitting Featured tier; filter rules were tuned to get to 305 Featured. Don't drift from the current filter settings without re-validating.

- **Calibration method:** eyeball before/after tier distributions from `data/skills-raw.json` vs. post-filter `data/skills.json`. The Featured count (currently 305) is the canonical signal.
- **No automated baseline snapshot exists.** If filter thresholds drift, the count regression guard only fires at <100 — a drift from 305 → 150 Featured would ship silently.
- **`data/pipeline-stats.json` is committed** and does record stats per run. Diffing this file in PRs is the closest thing to a snapshot test the project has.

## Data Integrity Checks

**`scripts/filter.js` enforces field presence minimally:**

- `scripts/filter.js:87-112` `isSlop(skill)` checks `skill.name`, `skill.description`, `skill.body_length`, `skill.has_name`, `skill.has_description` — skills failing are dropped, not flagged.
- `scripts/filter.js:36-48` `loadPriorEnrichments` validates `Array.isArray(prior)` and `p.id` presence before using a record.
- **No schema validation library** (no `zod`, `ajv`, `joi`). Record shape is trusted because one of two upstream parsers produced it (`scripts/parse-skill.js` for raw skills, `scripts/scrape.js` for repo metadata).

**Vector upload integrity at `scripts/embed-skills.js`:**

- Content-SHA fingerprinting at `scripts/embed-skills.js:78` (`computeContentSha`) — re-embeds only when name/description/category/body_markdown changes. This is an integrity mechanism (detect drift) but not a test.
- Commit `2357153 fix(semantic): use skill.id not slug for Vectorize ids (dedupe 6 collisions)` documents a real bug the lack of tests allowed to ship. No regression test was added after the fix — the collision-detection is only "use `skill.id` going forward."

## CI Gates — Complete Enumeration

| Step | File:line | Blocking? | Verifies |
|------|-----------|-----------|----------|
| `npm ci` | `daily-scrape.yml:28` | Yes | Lockfile integrity, install succeeds |
| Scrape | `daily-scrape.yml:50-54` | Yes (in scheduled runs) | GitHub API reachable, scraper doesn't throw |
| Filter | `daily-scrape.yml:69-72` | Yes | `skills-raw.json` readable, filter doesn't throw |
| Embed | `daily-scrape.yml:78-81` | Yes | OpenAI API reachable |
| Upload vectors | `daily-scrape.yml:83-87` | Yes | Cloudflare Vectorize accepts payload |
| **Skills count ≥ 100** | `daily-scrape.yml:89-97` | **Yes** | Regression floor |
| Astro build | `daily-scrape.yml:99-103` | Yes | Types + imports + static gen |
| Wrangler deploy | `daily-scrape.yml:106-111` | Yes | Worker accepts bundle |
| Health check | `daily-scrape.yml:113-121` | **No (warning only)** | homepage returns 200 |
| Commit data | `daily-scrape.yml:125-132` | No (`|| true`) | n/a — intentionally non-fatal |

## Known Gaps (Honest Accounting)

1. **No unit tests on scoring.** `scripts/score.js` has seven signal functions (`scoreStars`, `scoreRecency`, `scoreFrontmatter`, `scoreDocs`, `scoreIssues`, `scoreLicense`, `scoreDescription`) and a weighted composite. These are pure functions with obvious edge cases (zero stars, null `pushed_at`, malformed license string) and would be trivial to test — they are not tested.
2. **No parser tests.** `scripts/parse-skill.js` has a two-stage fallback (`gray-matter` → strip-and-retry) with real edge cases. Untested.
3. **No filter tests.** `scripts/filter.js` slop patterns (`TEMPLATE_NAMES`, `PLACEHOLDER_DESC_PATTERNS`, `BIZ_SLOP_PATTERNS`) and language-variant dedup (`scripts/filter.js:115-128`) are the core of catalog quality. Changes here ship with no safety net.
4. **No schema test on `skills.json`.** The SkillRecord shape documented in `CLAUDE.md` is enforced only by upstream producers. A typo in a field name silently breaks downstream (e.g. a bad `quality_tier` value would make `getFeaturedSkills` return fewer results, but the build would still pass).
5. **Health check does not assert content.** A deploy that serves an empty HTML shell still passes.
6. **No visual regression check.** Homepage layout, chart SVG output, and skill card rendering are verified by the developer's eyeballs on `npm run preview`.
7. **No test for `src/lib/skills.js` helpers.** `getFeaturedSkills`, `getSkillsByCategory`, `getSkillBySlug`, `getStats` all read the live `skills.json` import at build time — they can't be tested in isolation without a fixture strategy the project has not adopted.

## Concrete Recommendations (Ranked by Value-to-Cost)

Do not adopt any of these aspirationally — each is justified below.

1. **Add a single `vitest` suite for `scripts/score.js` and `scripts/filter.js` slop detection.** Cost: ~1 hour. Value: pins the calibrated thresholds that `CLAUDE.md` warns must not drift. Run as `npm test` and wire into CI **before** `Check skills count` so a tier-math bug is caught before skills count is even computed. Vitest is native ESM so it fits `"type": "module"` without config pain.
2. **Promote the health check to a failure gate** and add 2-3 content assertions: curl for the Featured section hero text, check the sitemap returns `application/xml`, check `/skills/anthropics-officialexamples-*` (or whatever the canonical top skill is) returns 200. Cost: ~20 lines of bash. Value: catches total deploy-but-broken scenarios.
3. **Snapshot `data/pipeline-stats.json` in PR checks.** On scheduled runs the file is rewritten; on push runs it isn't. A PR-triggered workflow that runs `npm run filter` against a checked-in `data/skills-raw.json` fixture and compares the resulting stats against a committed baseline would catch filter drift. Cost: medium (requires committing a small raw fixture, maybe 100 skills). Value: addresses the biggest unguarded risk.
4. **Schema assertion in `scripts/filter.js`.** Before writing `skills.json`, iterate records and require every field in `PRESERVED_FIELDS` plus a fixed core set (`id`, `slug`, `quality_score`, `quality_tier`, `category`, `repo_full_name`, `repo_stars`). Exit non-zero if any record is missing a core field. Cost: ~15 lines. Value: replaces the implicit trust chain with an explicit contract at the only place all skill records pass through.
5. **Do NOT add E2E browser tests** (Playwright/Cypress). The site is entirely server-rendered, the only client JS is the search filter, and the developer cost to maintain browser-test infrastructure on a solo project outweighs the bug class it catches.
6. **Do NOT add a general linter/formatter** (ESLint/Prettier) as "quality infrastructure." The codebase is internally consistent (`.planning/codebase/CONVENTIONS.md` documents the de facto style) and adding lint gates without team consensus produces noise without catching real bugs.

---

*Testing analysis: 2026-04-14*

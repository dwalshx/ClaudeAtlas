# Coding Conventions

**Analysis Date:** 2026-04-14

## Naming Patterns

**Files:**
- **Pipeline scripts:** kebab-case, verb-first describing the action. Examples: `scripts/scrape.js`, `scripts/filter.js`, `scripts/embed-skills.js`, `scripts/compute-similar.js`, `scripts/generate-badges.js`, `scripts/backfill-star-history.js`.
- **Astro components:** PascalCase, one component per file. Examples: `src/components/SkillCard.astro`, `src/components/CategoryChip.astro`, `src/components/QualityBadge.astro`, `src/components/ScoreBar.astro`, `src/components/CopyButton.astro`.
- **Astro pages:** lowercase, match URL segment. Examples: `src/pages/index.astro`, `src/pages/methodology.astro`, `src/pages/404.astro`. Dynamic routes use bracket syntax, e.g. `src/pages/skills/[...slug].astro`, `src/pages/category/[category].astro`.
- **Lib modules:** camelCase or lowercase, single-purpose. Examples: `src/lib/skills.js`, `src/lib/charts.js`, `src/lib/analytics.js`.
- **Data files:** kebab-case, descriptive of payload. Examples: `data/skills.json`, `data/skills-raw.json`, `data/skill-vectors.ndjson`, `data/star-history.json`, `data/api-graph.json`, `data/pipeline-stats.json`, `data/similar-skills.json`, `data/etag-cache.json`. Daily snapshots use ISO dates: `data/history/YYYY-MM-DD.json`.
- **Partial/checkpoint files:** append `.partial` (e.g. `data/star-history.json.partial` at `scripts/backfill-star-history.js:42`). Renamed to final name on success.
- **Log files:** co-located with the script that produces them, same stem: `scripts/embed-skills.log`, `scripts/scrape-plugins.log`, `scripts/backfill-star-history.log`. All log files are gitignored (see `data/.gitignore` pattern and existing commit history).

**Functions:**
- **JavaScript:** camelCase (`scoreSkill`, `categorizeSkill`, `parseSkill`, `loadPriorEnrichments`, `rateLimitedFetch`, `getFeaturedSkills`, `getSkillBySlug`).
- Helper functions used only internally are **not** prefixed with `_` — visibility is controlled by `export`/no-export (`scripts/filter.js:30` defines `loadPriorEnrichments` with no export; `scripts/filter.js:87` defines `isSlop` with no export).
- Per-script log helpers are consistently named `log`: `scripts/embed-skills.js:68`, `scripts/compute-similar.js:41`, `scripts/generate-badges.js:60`, `scripts/mine-apis.js:47`, `scripts/upload-vectors.js:53`, `scripts/generate-registry.js:30`, `scripts/generate-marketplace.js:35`, `scripts/compute-clusters.js:51`.

**Variables:**
- **Mutable locals and parameters:** camelCase (`filePath`, `rawContent`, `byRepo`, `capped`).
- **Module-level constants and config objects:** UPPER_SNAKE_CASE (`DATA_DIR`, `HISTORY_DIR`, `SKILLS_PATH`, `ROOT`, `TOKEN`, `HEADERS`, `CONFIG`, `MODEL`, `DIMENSIONS`, `BATCH_SIZE`, `MAX_RETRIES`, `TEMPLATE_NAMES`, `BIZ_SLOP_PATTERNS`, `PRESERVED_FIELDS`).
- **CONFIG object:** a single `const CONFIG = { ... }` object per script gathers tunable knobs (example `scripts/filter.js:55-61`). Follow this pattern for any new tunable thresholds.

**Types:**
- No TypeScript source files — `.js` everywhere with `"allowJs": true` in `tsconfig.json:7`. The project `extends: astro/tsconfigs/strict` but only Astro's own `.astro` files and the `.astro/types.d.ts` auto-gen benefit; pipeline scripts are untyped.
- Optional JSDoc type hints appear (`src/lib/skills.js:38` has `@type {import('./types').Skill[]}`) but no `src/lib/types.d.ts` exists — the import target is a phantom. Do not rely on this annotation for real type safety.

## Code Style

**Formatting:**
- **No formatter configured** — no `.prettierrc`, `.prettierrc.*`, `biome.json`, or `eslint.config.*` in the repo root. `package.json` has no `devDependencies` field at all.
- De facto style observed across `scripts/` and `src/`:
  - **2-space indentation** (confirmed `scripts/filter.js`, `scripts/scrape.js`, `src/lib/skills.js`, `src/components/SkillCard.astro`).
  - **Single quotes** for JS strings (`'fs'`, `'path'`, `'url'`), **double quotes** in `.astro` attributes and JSX-style class strings.
  - **Backticks** for interpolated log messages (`console.log(\`  [rate-limit] ...\`)`).
  - **Semicolons required** at end of every statement.
  - Trailing commas in multi-line object and array literals (see `CONFIG` at `scripts/filter.js:55-61` and `weights` at `scripts/score.js:30-38`).
  - One blank line between top-level declarations; section dividers use `// --- Section name ---` (examples: `scripts/scrape.js:37`, `scripts/filter.js:23`, `scripts/filter.js:143`).

**Linting:**
- **None.** Rely on `npm run build` (Astro's TypeScript check across `.astro` files) as the only automated style gate. Pipeline script changes are unchecked apart from runtime failure.

## Import Organization

**Order (observed in every pipeline script):**
1. Node built-ins via `node:` namespace *not* used — plain specifier is the project convention: `import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';` (`scripts/scrape.js:14`).
2. Other Node built-ins: `path`, `url`, `crypto`.
3. Third-party packages (when any) — e.g. `import matter from 'gray-matter';` (`scripts/parse-skill.js:8`).
4. Local modules, relative paths with `.js` extension required by ES modules: `import { parseSkill } from './parse-skill.js';` (`scripts/scrape.js:17`).

**Path aliases:**
- None configured. All imports are relative (`../lib/skills.js`, `../../data/skills.json`) or package-name.
- JSON imports use direct `import` when the file is known to exist: `import skillsData from '../../data/skills.json';` (`src/lib/skills.js:9`). When the file may not exist on first build, the code falls back to `existsSync` + `readFileSync` + `JSON.parse` (`src/lib/skills.js:16-25`, `src/lib/skills.js:27-36`). Enabled by `"resolveJsonModule": true` in `tsconfig.json:6`.

**ES modules everywhere:**
- `package.json:4` has `"type": "module"`. No CommonJS allowed. `require()` only appears inside CI bash (`.github/workflows/daily-scrape.yml:92`) where a one-liner `node -e` uses the synchronous `require` intentionally.

## Error Handling

**The codebase has two distinct error-handling modes depending on layer:**

**1. Pipeline scripts — fail loud with exit codes.**
- Missing required env vars: `console.error` + `process.exit(1)` at the top of every script that needs a token. Examples: `scripts/scrape.js:30-35` (GITHUB_TOKEN), `scripts/backfill-star-history.js:44-48`, `scripts/upload-vectors.js:33-39` (CF creds), `scripts/embed-skills.js:57` (soft — only fails if work remains).
- Main-function failures: `main().catch(err => { console.error(err); process.exit(1); })` pattern (see `scripts/scrape.js:748`, `scripts/embed-skills.js:307`, `scripts/upload-vectors.js:146`, `scripts/mine-apis.js:220`).
- **Retry with backoff** for network calls: `rateLimitedFetch` at `scripts/scrape.js:54-116` takes `retries = 3`, logs `[retry] Network error (...), retrying in 5s...`, sleeps 5s between attempts. Rate-limit responses (403/429) honor `x-ratelimit-reset` header and recurse (`scripts/scrape.js:100-113`).
- **Checkpointing** instead of transactions: long-running scripts write `.partial` files periodically and atomically rename on success (`scripts/backfill-star-history.js:42`, scraper's 1000-skill checkpoints per CLAUDE.md §Known Issues).

**2. Build-time / site code — fail soft and degrade.**
- Missing optional data files: wrap `readFileSync` + `JSON.parse` in `try/catch {}` with empty-object defaults. Two live examples:
  - `src/lib/skills.js:16-25` — missing `similar-skills.json` → `similarSkillsData = { similar: {} }`.
  - `src/lib/skills.js:27-36` — missing `api-graph.json` → `apiGraphData = { services: {}, skill_integrations: {} }`.
- The inline comment at `src/lib/skills.js:22` — `// Malformed file — degrade gracefully` — documents the rationale. Do the same for any new optional data source.
- `scripts/filter.js:30-52` — `loadPriorEnrichments` silently returns empty `Map` on read/parse error; fine because absence just means no prior enrichments to preserve.

**Parser error handling:**
- `scripts/parse-skill.js:15-45` wraps `gray-matter` in `try`, and on frontmatter parse failure falls through to a second try that strips the broken frontmatter and treats the whole file as body. Returns `null` as the final fallback.

**Never swallow errors silently in scripts** — always either log + continue (with a reason comment) or exit non-zero.

## Logging

**Framework:** `console.log` / `console.error` only. No `winston`/`pino`/etc.

**Tag convention — mandatory for pipeline scripts:**
Every log line from a pipeline script carries a bracketed tag identifying its subsystem. The tag is injected either by a per-script `log()` helper or inlined. Observed tags:
- `[embed]` — `scripts/embed-skills.js:69`
- `[similar]` — `scripts/compute-similar.js:42`
- `[clusters]` — `scripts/compute-clusters.js:52`
- `[badges]` — `scripts/generate-badges.js:61`
- `[marketplace]` — `scripts/generate-marketplace.js:36`
- `[registry]` — `scripts/generate-registry.js:31`
- `[upload]` — `scripts/upload-vectors.js:54`
- `[api-mine]` — `scripts/mine-apis.js:48`
- `[rate-limit]`, `[retry]`, `[history]`, `[code-search]`, `[metadata]`, `[parse]`, `[dedup]` — inline tags across `scripts/scrape.js`
- Timestamp-prefixed: `scripts/scrape-plugins.js:51` (`[ISO-timestamp] msg`), `scripts/backfill-skill-birth-dates.js:62`, `scripts/backfill-star-history.js:72` use a `ts()` helper.

**Pattern to copy for new scripts:**
```js
function log(msg) {
  console.log(`[your-tag] ${msg}`);
}
```

**Levels via prefix, not functions:**
- `[rate-limit]` for backpressure events, `[retry]` for recoverable failures. `console.error` is reserved for fatal pre-exit messages.

**Section banners:** `console.log('=== ClaudeAtlas Filter ===')` at the start of `main()` in most scripts (`scripts/filter.js:131`). Use this to make combined CI logs scannable.

## Comments

**When to comment:**
- **Top-of-file docstring is mandatory.** Every script in `scripts/` opens with `#!/usr/bin/env node` + a `/** */` block describing inputs, outputs, side effects, rate-limit behavior, resumability. See `scripts/embed-skills.js:1-45`, `scripts/backfill-star-history.js:1-31`, `scripts/mine-apis.js:1-36`, `scripts/filter.js:1-12`. Match this depth when adding scripts.
- **Inline comments explain *why*, not what.** The best examples are rationale for code that looks odd:
  - `src/lib/skills.js:12-15` — why `readFileSync` instead of `import` for `similar-skills.json`.
  - `scripts/filter.js:23-28` — why the `PRESERVED_FIELDS` mechanism exists.
  - `scripts/embed-skills.js:26-31` — why vector id is derived from `skill.id`, not `slug` (6 collisions).
  - `.github/workflows/daily-scrape.yml:13-19` — why 7h timeout (cold-scrape cliff).
- **Section dividers:** `// --- Config ---`, `// --- Step 1: Filter by repo stars ---`. Numbered step comments inside `main()` are the dominant style in `scripts/filter.js:143-200`.

**JSDoc:**
- Rarely used. One live example at `src/lib/skills.js:38` (`@type {import('./types').Skill[]}`) references a type file that does not exist. Do not add JSDoc `@param`/`@returns` boilerplate unless you also add real types.

**No TODO/FIXME governance:** `TODO`/`FIXME` tags are not used as backlog markers — the planning docs in `docs/` and `.planning/` own the backlog.

## Function Design

**Size:** Pure helpers stay short (`scripts/score.js` signal functions are 5-15 lines each, `scripts/score.js:50-54`). `main()` functions are long (100-200+ lines) and structured via numbered comment steps rather than extraction. Both styles are accepted — extract only when a block is reused.

**Parameters:** Positional, no destructured-options pattern. `rateLimitedFetch(url, isSearch = false, retries = 3)` at `scripts/scrape.js:54` uses trailing default values. Use the same idiom for optional flags.

**Return values:**
- `null` for "not found but not an error" — `parseSkill` at `scripts/parse-skill.js:11`, `getSkillBySlug` at `src/lib/skills.js:54`.
- Empty array / empty object for "zero results" — `getFeaturedSkills`, `getSkillsByCategory`.
- `Map` for keyed lookups built inside the module — `loadPriorEnrichments` at `scripts/filter.js:30` returns `Map<id, enrichments>`.

## Module Design

**Exports:**
- **Named exports** only. No default exports anywhere in `scripts/` or `src/lib/`. Helpers are exported individually (`export function scoreSkill(...)`, `export function categorizeSkill(...)`, `export const allSkills = ...`).
- `.astro` components use frontmatter `---` block for imports and `Astro.props` destructuring, e.g. `const { skill } = Astro.props;` at `src/components/SkillCard.astro:4`.

**Barrel files:** None. No `src/lib/index.js`. Import directly from the concrete module: `import { allSkills, getFeaturedSkills } from '../lib/skills.js';` (`src/pages/index.astro:5`).

**`__dirname` reconstruction:** The recurring idiom at the top of every script that does I/O:
```js
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
```
Copy this verbatim — see `scripts/scrape.js:21-22`, `scripts/filter.js:18-19`, `scripts/embed-skills.js:52-53`, `scripts/mine-apis.js:42-43`.

## Script Structure (Template)

Every new pipeline script in `scripts/` should follow this order (confirmed by five existing scripts):

1. `#!/usr/bin/env node` shebang (executable-style, even though invoked via `node script.js`).
2. `/** */` block: purpose, inputs, outputs, cost, rate-limit behavior, resumability.
3. `import` block: `fs` / `path` / `url` built-ins, then third-party, then local `./*.js`.
4. `__dirname` + `ROOT` + path constants (`DATA_DIR`, `INPUT_PATH`, `OUTPUT_PATH`).
5. Env var validation (`const TOKEN = process.env.XXX; if (!TOKEN) { console.error(...); process.exit(1); }`).
6. `CONFIG` object for tunable constants.
7. `log()` helper with bracketed tag.
8. Helper functions (not exported).
9. `async function main() { ... }`.
10. Entrypoint: `main().catch(err => { console.error(err); process.exit(1); });`

## Env Vars and CLI Args

**Env vars — consistent:**
- `GITHUB_TOKEN` — `scripts/scrape.js`, `scripts/backfill-star-history.js`, `scripts/backfill-skill-birth-dates.js`, `scripts/scrape-plugins.js`. All hard-fail if missing.
- `OPENAI_API_KEY` — `scripts/embed-skills.js`. Soft-fail (only errors if there's work to do).
- `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_VECTORIZE_INDEX` — `scripts/upload-vectors.js:33-35`. Last one has default `'claudeatlas-skills'`.
- `PUBLIC_POSTHOG_KEY` — Astro-side, baked into client bundle at build via `.github/workflows/daily-scrape.yml:103`. Standard Astro `PUBLIC_*` convention.

**CLI args:** Not used. No `process.argv` parsing and no `commander`/`yargs` dependency. Behavior is entirely env-var-driven. If CLI args ever become necessary, prefer plain `process.argv[2]` with a documented example in the file header over a library.

## Commit Message Style

Observed in `git log` (last 40 commits):
- **Conventional-ish prefix** with optional scope: `feat(phase-X):`, `fix(ci):`, `fix(phase-1.5):`, `docs(01):`, `chore:`, `data(phase-2):`, `feat(v2.0):`, `feat(2.0-prep):`.
- Scope is either a **phase identifier** (`phase-1`, `phase-2`, `phase-1.5`, `v2.0`, `2.1`), a **subsystem** (`ci`, `apis`, `semantic`, `deploy`, `research`), or combined (`phase-1.5.1`, `01.5.1`).
- Subject is lowercase, often with an em-dash separator for the "what + why" shape: `feat(v2.0): phases 2.2-2.5 — KV cache, similar skills, marketplace, clustering`.
- No imperative-mood rule enforced; past-tense appears occasionally.
- Auto-commit from CI uses `chore: update skills data YYYY-MM-DD` at `.github/workflows/daily-scrape.yml:131`. Do not clash with this format.

## Astro-Specific Conventions

- **Frontmatter imports at top** followed by `const { ... } = Astro.props;` on next line. See `src/components/SkillCard.astro:2-4`.
- **Tailwind utility classes inline.** No `.css` files in `src/`. Custom tokens defined in `tailwind.config.mjs` — the `atlas-*` palette is the project's brand color, use `atlas-400` / `atlas-600` for accents.
- **Trailing slashes on internal links** — `href={\`/skills/${skill.slug}/\`}` at `src/components/SkillCard.astro:11`. Astro's default config assumes trailing slashes; keep them for consistency.
- **Server-computed props** happen in the frontmatter block (top of file); client JS only when necessary (search widget in `src/pages/index.astro`). Prefer build-time rendering — see `src/pages/index.astro:20-22` pre-building SVG charts.

---

*Convention analysis: 2026-04-14*

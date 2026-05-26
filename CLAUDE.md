# CLAUDE.md

Orientation for Claude Code sessions working on ClaudeAtlas.

## What this project is

**ClaudeAtlas** is a curated discovery index of top Claude ecosystem skills. It automatically discovers SKILL.md files across GitHub, scores them on 7 transparent signals, and publishes a browsable static site at [claudeatlas.com](https://claudeatlas.com).

- **Live site:** https://claudeatlas.com
- **GitHub repo:** https://github.com/dwalshx/ClaudeAtlas
- **Hosted on:** Cloudflare Workers (Static Assets) — `claudeatlas.danthedub.workers.dev` with custom domain
- **Cost:** ~$12/year (domain only; everything else free tier)

## Current status

- **Phase 1: shipped** (2026-04-10) — 33,078 skills analyzed, 1,078 indexed, 305 Featured. Site live with custom domain and SSL.
- **Phase 1.5: in planning** — see `docs/PHASE-1.5-SCOPE.md`
- **Phase 2+: future work** — see `docs/FUTURE-WORK.md`

## Project structure

```
ClaudeAtlas/
├── CLAUDE.md                    # This file
├── README.md                    # Public-facing intro
├── package.json                 # npm scripts: scrape, filter, pipeline, dev, build
├── wrangler.toml                # Cloudflare Workers Static Assets config
├── astro.config.mjs             # Astro 5 + Tailwind + sitemap
├── tailwind.config.mjs          # Dark theme, custom atlas color palette
│
├── docs/
│   ├── PHASE-1.5-SCOPE.md       # Next push scope
│   └── FUTURE-WORK.md           # Phase 2+ roadmap
│
├── scripts/                     # Data pipeline
│   ├── scrape.js                # GitHub discovery + metadata + content fetch
│   ├── parse-skill.js           # YAML frontmatter + markdown body parser
│   ├── score.js                 # 7-signal quality composite
│   ├── categorize.js            # Keyword-based 8-category assignment
│   └── filter.js                # Post-process: slop removal, dedup, per-repo cap, tier recalibration
│
├── data/                        # Generated data (some committed, some gitignored)
│   ├── skills.json              # COMMITTED: curated output (~4 MB, 1,078 skills)
│   ├── pipeline-stats.json      # COMMITTED: pipeline metadata + stats
│   ├── history/                 # COMMITTED: daily {stars, forks, issues, pushed_at} snapshots
│   │   └── YYYY-MM-DD.json      # One file per day, ~225 KB each
│   ├── skills-raw.json          # GITIGNORED: full raw scraper output (~295 MB, 33k skills) (grew when body_markdown truncation moved from filter to scraper at 5000 chars)
│   │                            # CI flow (Phase 3.0.1+): persisted across runs
│   │                            # via GHA cache, seeded once from a release asset
│   │                            # (skills-raw-bootstrap, permanent). NEVER committed.
│   ├── etag-cache.json          # GITIGNORED: GitHub API ETag cache (~500 MB, makes re-scrapes cheap)
│   ├── scrape-log.txt           # GITIGNORED: scraper stdout/stderr
│   └── skills.json.partial      # GITIGNORED: checkpoint saves from scraper
│
├── src/
│   ├── layouts/
│   │   └── BaseLayout.astro     # HTML shell, nav, footer, SEO meta
│   ├── components/
│   │   ├── SkillCard.astro      # Card for skill listings
│   │   ├── QualityBadge.astro   # Featured/Solid/Listed tier indicator
│   │   ├── CategoryChip.astro   # Category pill with count
│   │   ├── CopyButton.astro     # One-click install command copy
│   │   └── ScoreBar.astro       # Quality signal breakdown bar
│   ├── pages/
│   │   ├── index.astro          # Homepage (hero + search + categories + top 60)
│   │   ├── methodology.astro    # Public quality scoring methodology
│   │   ├── 404.astro            # Not found page
│   │   ├── skills/[...slug].astro   # Individual skill detail pages
│   │   └── category/[category].astro # Category listing pages
│   └── lib/
│       └── skills.js            # Data loader + helper functions
│
├── public/                      # Static assets (favicon, robots.txt)
│
└── .github/workflows/
    └── daily-scrape.yml         # Daily scrape-filter-build-deploy cron (6:30 AM UTC)
```

## Data model

Each skill in `skills.json` has roughly this shape:

```typescript
interface SkillRecord {
  // Identity
  id: string;                   // "repo_full_name/skill_path"
  name: string;                 // Cleaned skill name (lowercase, hyphens)
  slug: string;                 // "author/skill-name" for URLs
  description: string;          // From SKILL.md frontmatter or first paragraph
  skill_path: string;           // Path within the repo

  // Repo metadata (from GitHub API)
  repo_full_name: string;
  repo_url: string;
  repo_stars: number;
  repo_forks: number;
  repo_open_issues: number;
  repo_topics: string[];
  repo_license: string | null;
  repo_language: string | null;
  repo_created_at: string;      // ISO 8601
  repo_updated_at: string;
  repo_pushed_at: string;
  repo_owner_type: 'Organization' | 'User';
  repo_owner_avatar: string;
  repo_archived: boolean;
  repo_is_fork: boolean;
  repo_description: string | null;

  // Parsed SKILL.md content
  frontmatter: Record<string, any>;
  body_markdown: string;        // Truncated to 1500 chars in filter output
  body_length: number;
  has_name: boolean;
  has_description: boolean;

  // Computed
  quality_score: number;        // 0-100
  quality_tier: 'featured' | 'solid' | 'listed';  // 90+ / 70-89 / <70
  category: string;             // One of 8 categories
  tags: string[];

  // Phase 3.1 — embedding-derived
  is_duplicate: boolean | null; // true when cosine sim > 0.92 to another
                                // record. null = not assessed yet (record
                                // has no embedding). false = assessed clean.
  canonical_slug: string | null;// when is_duplicate=true, the slug of the
                                // older canonical skill in the dup cluster.
  novelty_score: number | null; // 0-1; 1 - max cosine sim to any other
                                // record. null for duplicates and
                                // un-assessed records. Phase 3.4 UI will
                                // surface skills in the top 5% percentile.

  // Pipeline metadata
  scraped_at: string;
  content_sha: string;
  source: 'code-search' | 'topics' | 'seed' | 'discover';
}
```

Daily history snapshots in `data/history/YYYY-MM-DD.json` use short keys:

```typescript
{
  date: 'YYYY-MM-DD',
  timestamp: string,           // ISO 8601
  repo_count: number,
  repos: {
    [repo_full_name: string]: {
      s: number,               // stars
      f: number,               // forks
      i: number,               // open_issues
      p: string                // pushed_at (ISO 8601)
    }
  }
}
```

## Quality scoring — 7-signal composite (0-100)

| Signal          | Weight | What it measures                                    |
|-----------------|--------|-----------------------------------------------------|
| Stars           | 20%    | Log-scaled GitHub stars                             |
| Recency         | 20%    | Days since last push (cliff at 180 days)            |
| Frontmatter     | 20%    | SKILL.md has name + description                     |
| Documentation   | 15%    | Body length + repo description quality              |
| Issue health    | 10%    | Open-issues-to-stars ratio                          |
| License         | 10%    | Permissive open-source license present              |
| Description     | 5%     | Repo has a meaningful description                   |

Tiers:
- **Featured** ≥ 90
- **Solid** 70–89
- **Listed** < 70

Post-filter gates (in `filter.js`):
- Minimum 10 repo stars
- Minimum 500-char body length
- No template/placeholder names (e.g. `agent-name`, `example`)
- No biz-slop names (e.g. `carrier-relationship-management`)
- Language variant dedup (`-de`, `-fr`, `-zht`, etc.)
- Max 2 skills per repo (prevents mega-repo dominance)

## Key commands

```bash
# Full pipeline (scrape → filter → ready to build)
GITHUB_TOKEN=ghp_xxx npm run pipeline

# Scrape only (writes data/skills-raw.json) — long, ~7 hours for full run
GITHUB_TOKEN=ghp_xxx npm run scrape

# Filter only (reads skills-raw.json, writes skills.json) — fast, <1s
npm run filter

# Astro dev server (http://localhost:4321)
npm run dev

# Production build (outputs to dist/)
npm run build

# Preview production build (http://localhost:4322)
npm run preview
```

## Deployment

- **Hosting:** Cloudflare Workers Static Assets (configured via `wrangler.toml`)
- **Deploy command:** `npx wrangler deploy` (runs inside CI)
- **Daily cron:** `.github/workflows/daily-scrape.yml` runs at 6:30 AM UTC — scrapes, filters, builds, deploys, commits updated `data/skills.json` and `data/history/<today>.json` back to main
- **Required GitHub Actions secrets:** `SCRAPE_PAT`, `CF_API_TOKEN`, `CF_ACCOUNT_ID`

## Known issues / things a new session should know

1. **ETag cache is huge (~500 MB).** It lives in `data/etag-cache.json`, is gitignored, but must be regenerated on a fresh clone. First scrape without the cache takes ~7 hours; subsequent runs with cache are ~5-10 minutes.
2. **Scraper can hit socket errors** during very long runs. Retry logic + checkpoint saves at every 1,000 skills are in place.
3. **Scoring has been calibrated once** against real data (2026-04-10). First raw run had 18k skills hitting Featured tier; filter rules were tuned to get to 305 Featured. Don't drift from the current filter settings without re-validating.
4. **Daily star snapshots started 2026-04-11.** Every day of the scraper running adds more history. Delay is genuinely lost data.
5. **The homepage shows only the top 60 skills** for performance. Full catalog is browsable via categories.
6. **Smoke seed needs annual review.** `data/smoke-seed.json` (Phase 3.0.1)
   hand-picks 10 repos to exercise distinct discovery code paths. Some
   intentionally don't exist (`vercel-labs/skills`) to test the 404 branch.
   Verify annually that the seed still exercises the path coverage it
   claims (purpose strings on each entry) — if too many seed entries 404,
   the smoke harness's "≥5 of 10 responding" gate could fail spuriously.
7. **Track 1 burns ~500-800 fresh GitHub API requests per day, by design.**
   The per-repo `GET /repos/{owner}/{repo}` etags invalidate daily because
   stars/forks/issues tick up on most repos, so the conditional GETs come
   back as 200s rather than 304s. This is fine: with the Phase 3.0.2 Bug 1
   fix (blob-sha-based skip in Track 2), Track 2's content-fetch volume
   dropped by ~95%, leaving the 5000/hr budget comfortably for Track 1's
   fresh fetches. Track 1 finishes in ~7 minutes; the daily run completes
   end-to-end in <30 minutes. **Do not "optimize" Track 1 by gating its
   per-repo refresh on time** — that breaks the daily history snapshot
   contract (`data/history/<today>.json` needs same-day numbers). If
   Track 1 ever becomes the binding constraint (e.g., the corpus grows
   past ~3000 repos), the lever is migrating Track 1 from REST per-repo
   GETs to a single GraphQL `repository(...) { stargazerCount, ... }` batch
   query — research finding documented in
   `.planning/phases/3.0.1-pipeline-state-persistence/RESEARCH.md`. Until
   then, Track 1's daily fresh-request cost is a known and accepted line
   item in the daily budget.
8. **Phase 3.1 added embedding-based dedup; if enrich.js fails,
   skills.ndjson may carry stale `is_duplicate` flags.** The daily
   pipeline order is Filter → Embed → Enrich → Upload-vectors → Build.
   If `npm run enrich` fails (most likely cause: skill-vectors.ndjson
   missing because the embed step was skipped or evicted), the
   downstream skills.ndjson keeps yesterday's enrichment values for
   records that survived (preserved via `PRESERVED_FIELDS` in filter.js),
   and `is_duplicate=null` for any new records. The site still renders
   correctly — the new fields are additive and the rendering layer
   degrades to "show everything" when values are null. To force a clean
   re-enrich: `gh workflow run daily-scrape.yml`. If the vectors NDJSON
   itself is corrupted or missing, run `npm run embed` locally with a
   fresh `OPENAI_API_KEY` then push the regenerated file (or re-run
   the workflow once OpenAI is available again).

   Novelty is gated as a **percentile** (top 5% within the current
   catalog), not an absolute threshold. The score lives on every
   record; the gate lives in Phase 3.4 UI code (TBD). **Don't reintroduce
   the absolute `novelty > 0.45` gate** from the early spec drafts —
   research confirmed it's the noise floor for `text-embedding-3-small`
   embeddings (`.planning/phases/3.1-filter-overhaul/RESEARCH.md` §Q2).

## Pipeline footguns (F1 streaming foundation, Phase 3.1.1)

V8 has a ~536 MB single-string ceiling. The entire pipeline used to assume
JSON files fit comfortably below that — F1 removed the assumption. These
patterns are banned in `scripts/`, `worker/`, `src/`, `astro.config.mjs`,
`wrangler.toml`, and `.github/workflows/*.yml`. Lint script:
`npm run check:patterns`. CI status check: `lint` job in
`.github/workflows/lint-pipeline.yml`.

**Banned:**

- `readFileSync(<path>, 'utf-8')` on anything under `data/`. Use
  `scripts/lib/ndjson.js` (`readNdjsonRecords`) instead. Materializing a
  >500 MB file as a single string crashes with
  `RangeError: Invalid string length`. Cited cases: Research §A, three
  CI crashes on 2026-05-17, three more latent sites on main pre-F1.
- `JSON.stringify(<arr>, null, 2)` on records arrays (in `scripts/`). The
  pretty-print indent inflates a 295 MB raw write past the V8 ceiling.
  Use chunked `writeSync` via `writeNdjsonStreaming`.
- `array.map(JSON.stringify).join('\n')`. Same V8 crash class — the
  `.join` materializes one giant string.
- `array.push(JSON.stringify(...))` followed by `array.join('')` within
  ~40 lines. Same V8 crash class; common refactor of the `.map().join()`
  pattern.
- Inline `node -e` blocks in `.github/workflows/*.yml` that do
  `JSON.parse(readFileSync(...))` against `data/` files. Replace with
  `wc -l data/foo.ndjson` for record-count guards (Rev 2 B4).

**Reserved keys in NDJSON records:**

- `_header: true` — sentinel for the file's first-line header (used by
  F2 to carry `schema_version` alongside the data, no sidecar). The
  `_header` key MUST NOT appear on real records. `scripts/lib/ndjson.js`
  filters records with `_header: true` from reads (defensive — any
  position, not just line 1) and prepends them via the writer's
  `opts.header`. F2 owns the header schema; F1 owns the mechanism. See
  `scripts/lib/__tests__/ndjson.test.js` Tests 12 + 13.

**Allowed (explicit allowlist in `scripts/check-banned-patterns.js`):**

- `src/lib/skills.js:21` — `similar-skills.json` read. Bounded sidecar
  per Research §A; safe through 200k records.
- `src/lib/skills.js:30` — `api-graph.json` read. Bounded sidecar per
  Research §A; safe at projected catalog sizes.
- `scripts/lib/ndjson.js` — the helper itself contains the primitives.
- `__tests__/` and `*.test.js` — fixtures intentionally contain banned
  strings.
- `pipeline-stats.json`, `kv-published.json` — bounded sidecars
  (added when their producers land in later F1 tasks).

**Required:**

- Streaming `openSync` / `writeSync` / `closeSync` / `renameSync` for
  any growing data file. Always tmp+rename for atomicity.
- `npm run check:patterns` runs on every PR via the `lint` job. Use
  baseline mode (`--mode=baseline`) when intentionally adding a new
  allowlisted hit; switch to strict mode (`--mode=lint`) at the gate.
- Capture a pre-deploy sitemap snapshot before any F1 wave deploys —
  see `.planning/phases/03.1.1-streaming-foundation/pre-f1-sitemap-snapshot.xml`.

### Embedding cost controls (F1 T3 / Decision B)

`scripts/embed-skills.js` honors `EMBED_DRY_RUN=1` to short-circuit the
OpenAI call and emit deterministic SHA-256-seeded fake vectors instead.
Output NDJSON has identical shape to a live run (only the float values
differ); downstream consumers (compute-similar, compute-clusters,
upload-vectors) work transparently against the fake data.

When to use it:

- **CI fixture/smoke runs.** The 50k-record verification at F1 V3 would
  burn ~$0.42 of OpenAI credit per attempt and hit the tier-1 rate
  limit at >17 min. `EMBED_DRY_RUN=1` skips both.
- **Plan-check rev cycles.** Each Rev runs CI; sharing one $0.42 across
  many attempts isn't viable. Dry-run is the default; the live path is
  verified separately on a small (100-record) push-event smoke.
- **Local dev iterations.** `EMBED_DRY_RUN=1 npm run embed` lets you
  exercise the pipeline without an OpenAI key.

When NOT to use it:

- **Daily production scrape.** Live cron MUST embed real vectors.
- **Pre-deploy verification of a real release.** Always do at least one
  live-OpenAI smoke before declaring a milestone complete.

The fake vectors are produced by hashing `skill.id` (SHA-256) and
mapping bytes to floats in [-1, 1]. Deterministic — same input
produces same output, useful for snapshot diff tests.

## GitHub API facts (verified Phase 3.0.1 research)

Claude's training data is wrong on some specifics; trust these:

1. **GHA cache 10 GB cap was REMOVED on Nov 20, 2025.** No per-repo
   size ceiling; LRU + 7-day inactive eviction only. The 295 MB
   skills-raw.json fits comfortably; future growth is unconstrained by
   this. ([changelog](https://github.blog/changelog/2025-11-20-github-actions-cache-size-can-now-exceed-10-gb-per-repository/))

2. **304 conditional responses do NOT count against the primary REST
   rate limit.** ETag-cached calls are effectively free for budget
   purposes. ([best-practices docs](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api))
   This is why scripts/scrape-discover-repos.js's tree-fetch pass is
   cheap on warm runs.

3. **GitHub code search supports a LIMITED qualifier set:** `language`,
   `repo`, `path`, `extension`, `filename`, `org`, `user`, `size`,
   `in`, plus boolean operators. It does NOT support `pushed:`,
   `created:`, `updated:`, or `sort:`. The 3.0.0 incremental path
   silently broke because `filename:SKILL.md pushed:>2026-04-22` was
   treated as a literal text search (or ignored). Use
   `/search/repositories?q=topic:X+pushed:>` for recency-filtered
   discovery — repository search supports the full qualifier set.
   ([searching-code docs](https://github.com/github/docs/blob/main/content/search-github/searching-on-github/searching-code.md))

4. **skills-raw.json grows ~5 MB/day.** Track 2 discovery accumulates
   entries; with body_markdown truncated to 5000 chars per record,
   steady-state growth is ~100–500 new records/day × ~9 KB ≈ 5 MB/day.
   Phase 3.x can add 90-day-stale eviction if/when this matters. For now,
   the GHA cache (no size cap) and the release-asset bootstrap fallback
   handle any size.

### Recovery: if GHA cache is evicted/corrupted (skills-raw.json)

Symptom: daily-scrape.yml's filter step logs `Track-1-only day` (graceful
fallback fired). Site keeps serving but Track 2 discovery has paused.

Fix: re-run the bootstrap workflow.

```bash
gh workflow run bootstrap-skills-raw.yml
gh run watch
# Next scheduled daily-scrape will go warm.
```

The release asset `skills-raw-bootstrap` is permanent — do NOT delete it.
If the asset itself is missing, re-upload from a local
`data/skills-raw.json` (~295 MB) and re-run the bootstrap workflow.

> T4 (2026-05-25) renamed the legacy release to
> `skills-raw-bootstrap-jsonarray-legacy` and added a new
> `skills-raw-ndjson-bootstrap` release with the migrated NDJSON
> format. The bootstrap workflow now pulls from the NDJSON release.

### Recovery: F1 deploy broken (Phase 03.1.1 / T8)

Three rollback paths exist for F1 issues. All target <5 min recovery.
Full procedure walkthrough in
`.planning/phases/03.1.1-streaming-foundation/3.1.1-ROLLBACK-REHEARSAL.md`.

**Scenario A — Worker bug** (Listed pages 5xx or static deploy broken):

```bash
git revert <BAD_SHA>
git push origin main
# Push-event fires daily-scrape.yml → fetches skills-latest →
# rebuilds + deploys reverted code. ~3 min to live.
curl -sI https://claudeatlas.com/skills/<known-slug>/ | head -1   # expect 200
```

**Scenario B — Data-shape divergence** (filter changed shape, then was
reverted; skills-latest still has the new shape):

```bash
git revert <BAD_SHA>
git push origin main
# If push-event build fails (shape mismatch):
gh release download skills-latest-prev --pattern skills.ndjson \
  --output data/skills.ndjson
gh release upload --clobber skills-latest data/skills.ndjson
git commit --allow-empty -m "deploy: refetch via skills-latest-prev"
git push origin main
# ~5 min to live.
```

The `skills-latest-prev` release is tagged automatically by daily-scrape's
"Tag previous skills-latest as skills-latest-prev" step before each new
publish. Carries the prior day's data shape.

**Scenario C — Astro build broken**:

```bash
git revert <BAD_SHA>
git push origin main
# Push-event rebuilds and redeploys cleanly. ~3 min to live.
# Edge cache continues serving the prior deploy during this window.
```

### Recovery: KV corruption / SKILLS_KV reset

If SKILLS_KV namespace becomes corrupted (wrong shape, partial writes
from a failed publish-kv run, or simply needs a clean rebuild):

```bash
# Option 1 — full namespace reset (preferred when corruption is broad):
wrangler kv namespace delete SKILLS_KV --force
wrangler kv namespace create SKILLS_KV
# Copy new namespace ID into wrangler.toml + GH secret SKILLS_KV_NAMESPACE_ID.

# Option 2 — force re-upload of every record by clearing the sidecar:
rm data/kv-published.json
gh workflow run daily-scrape.yml
# Bump KV_PUBLISH_BUDGET in the workflow YAML temporarily if catalog
# exceeds the 1k-writes/day free-tier cap (or shard across 5 days at
# default budget).
```

The `data/kv-published.json` sidecar is the slug→content_sha map that
publish-kv.js uses to skip unchanged records. Deleting it forces a full
re-publish on the next run.

## Methodology

- **Planning methodology:** Org OS (see `.objective/` locally — not committed to repo)
- **Execution methodology (recommended for Phase 1.5+):** GSD (`.planning/` directory, phase-based delegation)
- **Project history:** Phase 1 was planned with a full Org OS 12-phase pipeline and executed in one long session. Phase 1.5 onward should use GSD for execution discipline.

<!-- GSD:project-start source:PROJECT.md -->
## Project

**ClaudeAtlas**

ClaudeAtlas is a curated discovery index of top Claude ecosystem skills. It automatically discovers SKILL.md files across GitHub, scores them on 7 transparent signals, categorizes them, and publishes a browsable static site at [claudeatlas.com](https://claudeatlas.com). Built for Claude Code users and agent authors who want to find trustworthy, high-quality skills without wading through thousands of repos.

**Core Value:** **Users can find the best Claude skill for a given task in under 30 seconds, with visible signals for why it's trustworthy.**

If everything else fails, this must work — the single browse-and-discover loop drives every other decision about moats, creator tools, analytics, and infrastructure.

### Constraints

- **Tech stack:** Astro 5 + Cloudflare Workers Static Assets — locked. Do not swap renderers or hosts.
- **Cost:** Free tier for everything except the domain (~$12/year). Any Phase 1.5 addition that breaks this (paid analytics, paid D1 capacity, paid Workers) requires explicit approval.
- **Scraper footprint:** GitHub API rate limit is 5,000 requests/hour with a PAT. Any Phase 1.5 feature that needs backfill (skill birth dates, star history) must fit inside the rate limit with room for the daily cron.
- **Data integrity:** Do not drift from the calibrated filter rules in `scripts/filter.js` without re-running against `skills-raw.json` and comparing the before/after distributions.
- **Deployment:** Zero-downtime rollout is mandatory. The live site must keep serving through every Phase 1.5 deploy.
- **Privacy:** Any analytics/search logging must hash or omit PII. Search query log uses hashed IP for dedup only; no raw identifiers.
- **Static-site discipline:** Wherever possible, compute at build time and serve static files. Cloudflare Workers endpoints are allowed for the search query log (D1 insert) but should not be used for anything that can be baked.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->
## Technology Stack

Technology stack not yet documented. Will populate after codebase mapping or first phase.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->

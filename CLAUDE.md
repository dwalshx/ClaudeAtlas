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
│   ├── skills-raw.json          # GITIGNORED: full raw scraper output (~8 MB, 33k skills)
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

  // Pipeline metadata
  scraped_at: string;
  content_sha: string;
  source: 'code-search' | 'topics' | 'seed';
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

## Methodology

- **Planning methodology:** Org OS (see `.objective/` locally — not committed to repo)
- **Execution methodology (recommended for Phase 1.5+):** GSD (`.planning/` directory, phase-based delegation)
- **Project history:** Phase 1 was planned with a full Org OS 12-phase pipeline and executed in one long session. Phase 1.5 onward should use GSD for execution discipline.

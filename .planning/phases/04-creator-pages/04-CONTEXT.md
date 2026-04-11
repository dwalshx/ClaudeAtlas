# Phase 4: Creator Pages - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous overnight run)

<domain>
## Phase Boundary

Every creator with at least one indexed skill gets:
1. A profile page at `/creators/[username]/` (CREATOR-01)
2. Inclusion in the leaderboard at `/creators/` (CREATOR-02)
3. Computed badges (Prolific / Quality / Rising) on their profile (CREATOR-03)
</domain>

<decisions>
## Implementation Decisions

### Data source: no GitHub user API fetches in Phase 1.5
- The scope doc suggests fetching `/users/{username}` for bios, but the session token is currently rate-limit-constrained by two parallel backfills.
- Phase 1.5 uses `repo_owner_avatar` (already present on every skill), `repo_owner_type`, and the creator's top-scored skill's `repo_description` as a fallback bio.
- Real GitHub user bio fetching is deferred to Phase 2.5 creator claim verification work.
- Acknowledged gap: bios will read as repo descriptions not personal bios. Flag in PHASE-1.5-MORNING.md.

### Routes
- `src/pages/creators/index.astro` — top-level leaderboard
- `src/pages/creators/[username].astro` — individual creator profile page

### Creator data assembly
- New helper `getCreators()` in `src/lib/skills.js` builds a `Map<username, CreatorRecord>` from `allSkills`, computing:
  - `username` (GitHub login)
  - `avatar_url` (from `repo_owner_avatar`)
  - `type` ('Organization' | 'User' from `repo_owner_type`)
  - `bio_fallback` (from the top-scored skill's `repo_description`)
  - `skills[]` (all their indexed skills, sorted by quality_score desc)
  - `total_skills`, `total_stars`, `avg_quality_score`, `tier_counts`
  - `categories` (unique category names across their skills)
  - `first_commit_at` (earliest `skill_first_commit_at` or `repo_created_at` across their skills)
  - Badges: `isProlific` (>= 5 skills), `isQuality` (all skills Featured), `isRising` (has a Featured skill with first_commit in last 30 days)
- Helper exported and called from both creator pages.

### Leaderboard structure
- `/creators` renders four top-10 tables side-by-side (or stacked on mobile):
  1. **By Featured count** — most Featured-tier skills
  2. **Prolific** — most indexed skills (tie-break by avg quality score)
  3. **Quality** — highest avg quality score (min 2 skills to qualify — avoids single-skill creators dominating)
  4. **Rising** — newest Featured skill, ordered by `first_commit_at` descending
- Each row is a card with avatar, name, count/score, and a link to the profile

### Profile page structure
- Header: avatar, username, optional badge row (Prolific / Quality / Rising)
- Stats block: total skills, total stars, tier counts, avg score
- Skills grid: all their indexed skills sorted by quality_score, using the existing `SkillCard` component
- Category chips: unique categories this creator covers
- Back link to /creators and external link to https://github.com/[username]

### Linking from skill detail pages
- The plan calls for skill detail pages to link to the creator profile.
- Phase 1.5 adds a small "Maintained by [@username]" link on each skill detail page that points to `/creators/[username]/`.

### SSG concerns
- Astro generates a page per username at build time via `getStaticPaths`. 776 creators → 776 new pages.
- `prerender: true` is the default for static builds.

### Quality badge threshold
- "All indexed skills are Featured" — but almost no one has 2+ indexed skills that are all Featured. To keep the badge meaningful, require **min 2 skills** AND all Featured.
</decisions>

<code_context>
## Existing Code Insights

- `src/components/SkillCard.astro` — reused for the profile skills grid
- `src/components/CategoryChip.astro` — reused for category coverage
- `src/lib/skills.js` — add `getCreators()` and `getCreatorByUsername()`
- `data/skills.json` fields used: repo_full_name, repo_owner_avatar, repo_owner_type, repo_description, repo_stars, quality_tier, quality_score, category, skill_first_commit_at (when DATA-01 lands), repo_created_at
</code_context>

<specifics>
## Specific Ideas

- Profile URL pattern: `/creators/[username]/` (trailing slash, Astro's default)
- Badge styling: small pills next to the creator name, matching the skill quality badge styling
- If a creator has 0 Featured skills, they still get a profile page (they're indexed), but they won't appear on the Featured leaderboard
- Username is case-preserved on display ("AIPexStudio") but lowercase-matched in routing (URLs are case-sensitive on some servers but Cloudflare Workers Static Assets is case-insensitive for assets — test with a mixed-case username)
</specifics>

<deferred>
## Deferred Ideas

- GitHub user API bio fetching — Phase 2.5
- Creator claim verification — Phase 2.5
- Custom bios from claimed profiles — Phase 2.5
- Follow-this-creator / RSS per creator — Phase 2.5
- Creator-of-the-week editorial — Phase 3
</deferred>

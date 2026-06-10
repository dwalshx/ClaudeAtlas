# Session Handoff — 2026-06-10 (post scraper-saga + security audit)

> For the NEXT session. Read this + CLAUDE.md + STATE.md to get up to speed.
> The headline: a 5-day firefight is OVER. Pipeline is green, site is fresh,
> security is hardened, git tree is clean. **Next task = the HNSW optimization phase.**

## Current state (all green)

- **Scraper:** healthy. 3+ consecutive green full cron runs (2026-06-08 dispatch, 06-09, 06-10). Runs take **4.5–5.5h — tight under the 360-min cap.**
- **Site:** fresh, self-updating daily ("Updated 2026-06-10" confirmed live). Catalog ~50,959 skills.
- **Security audit (2026-06-08):** fully closed.
- **Git:** clean working tree (the perpetual `data/regression-*` noise is now gitignored + untracked).
- **Plugins/MCP:** intentionally **GATED OFF** (`PLUGINS_ENABLED=false` in daily-scrape.yml) — see decision #2.

All scraper-health + security work lives under quick task **260603-e96**; running log in
`.planning/quick/260603-e96-fix-failing-daily-scrape-track-1-star-pu/260603-e96-SUMMARY.md`.

## ▶ NEXT TASK: HNSW optimization phase

**Goal:** kill the O(N²) build long-pole so the cron has comfortable headroom under 360min,
AND unblock re-enabling plugins (3.3). User has confirmed OK with approximate-NN trade-offs.

**Two O(N²) cosine scans at ~50k records are the targets (both recur every run):**
1. `scripts/compute-similar.js` — the build's dominant cost (~94→162min+ at 50k; was the
   last wall, only fits 360 because the build *barely* completes). All-pairs top-K similarity.
2. `scripts/enrich.js` dedup — ~59min/run. Cosine dedup (`is_duplicate`/`canonical_id`).

**Approach (evaluate both in planning):**
- **hnswlib-node** — local HNSW (Hierarchical Navigable Small World) approximate-NN index →
  O(N²) → ~O(N log N). Minutes instead of hours.
- **Query Cloudflare Vectorize** — the embeddings are ALREADY uploaded there (it's an ANN
  index). Could fetch top-K neighbors at build time, possibly avoiding a local lib entirely.
  Likely the cleaner path; check Vectorize query limits/cost at 50k.

**Warm-run timing breakdown (for sizing):** Track1+2 ~25m · filter ~0 · embed (incremental,
warm cache) ~5m · enrich ~59m · build >162m. Build dominates; enrich is #2.

**After optimization:** re-enable plugins (3.3), then 3.4. Order from `docs/VISION.md`:
**Optimization → 3.3 (plugins) → 3.4 (New & Noteworthy)**. Analytics feedback loop is
cross-cutting. **Audit B (content-scanner filter) is queued to fold into this phase.**

## Key decisions + rationale (the 6 scraper walls, in order cleared)

1. **Track 1 → batched GraphQL** (`scripts/lib/github-graphql.js`, wired in `scrape-pulse.js`).
   REST per-repo at 4,351 repos tripped GitHub's *secondary* (abuse) rate limit AND drained
   the shared 5,000/hr REST budget (starving Track 2 + plugin discovery). GraphQL has a
   **SEPARATE 5,000-points/hr budget**. **CRITICAL GOTCHA: GraphQL requires a CLASSIC PAT** —
   the fine-grained `SCRAPE_PAT` is 403'd by the GraphQL API. So the workflow sets
   `GITHUB_TOKEN=secrets.SCRAPE_PAT_CLASSIC` for the **Track 1 step ONLY**; Track 2 / plugin
   discovery stay on `SCRAPE_PAT` (REST). Both PAT secrets exist. The earlier REST-fallback
   commit (1e5d1a5) is retired; github-graphql.js has 403-body logging so future GraphQL
   failures are diagnosable.
2. **Plugin/MCP pipeline GATED OFF** (`PLUGINS_ENABLED=false`, 9 steps in daily-scrape.yml).
   Plugin discovery is a whole-ecosystem sweep that never completed in time, and plugin PAGES
   (3.3) aren't built yet → all cost, no benefit. **Re-enable** (`PLUGINS_ENABLED=true`) only
   after 3.3 makes plugin discovery incremental (blob-sha skip like Track 2's 3.0.2 fix) +
   a one-time `plugins-raw` bootstrap. Downstream scripts (generate-feeds, llms-txt,
   upload-vectors) already degrade gracefully when plugin data is absent.
3. **`filter.js` body_length invariant: throw → warn+auto-correct.** A single benign record
   (CJK/multibyte or trailing-whitespace length drift >10 chars) was aborting the ENTIRE
   filter → dropping the unreplayable daily history snapshot. Principle: data-quality checks
   must not be pipeline circuit-breakers.
4. **`skill-vectors.ndjson` cross-run persistence** (GHA cache, mirrors skills-raw) +
   `force_reembed` workflow_dispatch input + drift-guard threshold 0.99→0.90 in
   `embed-skills.js`. Root cause: skill-vectors was a committed **1,078-vector Phase-1 seed**
   with NO cross-run persistence → embed re-embedded ~all 50k daily (cost ~$0.40/run, over
   the ~$102/yr ceiling) and the 3.2 B-2 drift guard correctly aborted. The cache makes embed
   truly incremental (~99% hit, only new skills embedded). Bootstrap was a one-time
   `gh workflow run daily-scrape.yml -f force_reembed=true` (DONE — cache is warm now;
   future runs need NO flag).
5. **`check-sitemap-completeness.js`: sum `<loc>` across all numbered sitemaps.** Catalog
   crossed 45,000 URLs → @astrojs/sitemap split into `sitemap-0.xml` (45k cap) + `sitemap-1.xml`;
   the checker only read sitemap-0 → false FATAL. (This was the LAST wall — build was fine.)
6. **`timeout-minutes` 330 → 360** (GHA platform max). Stopgap only; the build is the binding
   constraint at 50k. **HNSW (next phase) is the durable fix** — 360 is the ceiling, no more
   stopgap room as the catalog grows.

## Security audit (2026-06-08) — all closed

- **Malicious + jailbreak skills** (`claude-world/super-helper`, `cisco-ai-defense/jailbreak-override`):
  repo-level denylist `FIXTURE_REPO_DENYLIST` in `scripts/lib/filter-rules/common.rules.js`
  (denylists `claude-world/claude-skill-antivirus` + `cisco-ai-defense/skill-scanner` — both are
  scanner repos whose contents are eval/test fixtures, 9 records total, none real skills). The 9
  KV keys were manually deleted from SKILLS_KV. Denylist strips them from the catalog on every
  filter run.
- **devalue DoS** (GHSA-77vg-94rm-hx3p): bumped 5.7.1→5.8.1 + `overrides` pin in package.json.
- **`/api/v1/search` rate limit:** per-IP 30/min, counter in QUERY_CACHE keyed by hashed IP,
  fail-open, gated before the OpenAI call. CORS left `*` (intentional for the agent API).
- **Command injection** in `check-sitemap-stability.js`: `execSync` shell-string → `execFileSync`.
- **PostHog `phc_` key:** it's a PUBLIC project key (ships in client JS) — NOT a secret. No
  rotation. The regression fixtures holding it are now untracked/gitignored.
- **CORS wildcard, D1 id in wrangler.toml:** accepted (intentional / not secrets).
- **Audit B — content-scanner filter:** QUEUED for the optimization phase. Would catch FUTURE
  malicious samples from OTHER repos (curl|bash exfil + jailbreak/injection markers), tuned to
  avoid false-positives on legit security-education skills. NOT a blanket path filter (95
  legit example-path skills exist — don't nuke those).

## Operational gotchas (save future pain)

- **Windows ARM64: `wrangler` CANNOT run locally** (workerd has no win32-arm64 build). Deploys
  are CI-only. D1/KV ops go via the Cloudflare **dashboard** or the **CF REST API** (curl /
  Invoke-RestMethod) — never local wrangler. Worker also can't be previewed locally.
- **`gh workflow run` 403:** the env `GITHUB_TOKEN`/`GH_TOKEN` (a fine-grained scrape PAT) lacks
  `workflow` scope and shadows the keyring token. Clear it first: cmd `set GH_TOKEN=` /
  `set GITHUB_TOKEN=`; PowerShell `$env:GH_TOKEN=$null; $env:GITHUB_TOKEN=$null`.
- **The cron commits data back to `main`** (pipeline-stats.json, history/, kv-published.json),
  so local `main` diverges. Before pushing: `git pull --no-edit origin main` (clean auto-merge
  — cron touches data files, your work touches code).
- **Push-event runs** (any push to main) = FAST build+deploy from the `skills-latest` release
  (skips scrape/embed, ~10-16min). **Full scrape** only on `schedule` or `workflow_dispatch`.
- **Homepage "Updated" date** comes from committed `pipeline-stats.json`, which is committed
  only at the END of a full run (after build+deploy). So a build timeout = stale stamp.
- **GitHub rate limit is shared per-user across `gh` + SCRAPE_PAT** (5,000/hr REST). Heavy
  `gh` polling during a scrape can exhaust it. Use `gh api rate_limit` (free) to check.
- **The timestamp hook** (UserPromptSubmit injects `[clock] ...`) was built by us in another
  session — it shows wall-clock + gap since last message. Genuinely useful for pacing across
  multi-day gaps; lean on it.

## Pointers
- `docs/VISION.md` — north star + 5-layer vision + the near-term roadmap sketch (Optimization
  → 3.3 → 3.4) + the agent-citation tripwires (agent-ping guestbook, LLM referrals,
  search_events — armed, baking, months-scale; do NOT build more agent infra until a signal
  appears).
- `.planning/quick/260603-e96-.../260603-e96-SUMMARY.md` — the full saga + security log.
- CLAUDE.md — project orientation (data model, scoring, pipeline footguns, GitHub API facts).

# Session memo: 2026-04-13 → 2026-05-17

**For:** the next session resuming Phase 3.1 execution
**Authored:** 2026-05-17
**Status of phase tree:** 3.0.0, 3.0.1, 3.0.2 done; 3.1 planned and ready to execute

---

## TL;DR

Five-week saga of cascading pipeline failures, ending with a fully-healthy daily scrape and a properly-planned 3.1 ready to execute. The infrastructure trilogy (3.0.0, 3.0.1, 3.0.2) was unplanned — it inserted itself between the original spec's Phase 3.0 ambitions and the actual work of getting plugins on the site. The lessons learned are documented inline below so the next session doesn't repeat them.

**Current state (verified 2026-05-17):**
- Site: https://claudeatlas.com fresh as of 2026-05-17, 1,885 indexed skills (up from 1,078)
- Daily cron: runs unattended at 06:30 UTC, completes in ~15 min, commits fresh data back
- Weekly cron: re-enabled, Sundays 03:00 UTC (full code-search safety net)
- Bot commit chain: verified end-to-end on `ebb5a80` (first real bot commit since 2026-04-11)
- Open: Phase 3.1 (filter overhaul) planned, ready to execute; plugins still deferred to 3.2/3.3

---

## What was supposed to happen vs what did

**Original plan (mid-April):**
- Audit Phase 1.5 + v2.0 (YELLOW close)
- Kick off Phase 3.0 (Comprehensive Agent Tooling Index) per `docs/PHASE-3.0-SPEC.md`
- Ship 9 sub-phases (3.1–3.9) over 3-5 sessions
- Site gets plugins, novelty detection, "New & Noteworthy" homepage, etc.

**What actually happened:**
- Pipeline was broken (6h timeouts, then 90-min, then OPENAI_API_KEY typo, then KV placeholder, then bot push permission denied)
- Three INSERTED phases (3.0.0, 3.0.1, 3.0.2) all about infrastructure hardening before Phase 3.0 work could even begin
- ~5 weeks elapsed before Phase 3.1 was ready to plan
- Spec corrections needed during 3.1 research (0.45 novelty noise floor, active-fork dead code, slug collisions count wrong)

The "why" matters for the next session: **the daily pipeline now works reliably and is genuinely self-sustaining.** That was not true 5 weeks ago. Phase 3.1+ can proceed with confidence in the foundation.

---

## The cascade — bug-by-bug timeline

This section is the "lessons learned" record. Each bug surfaces a pattern the next session should watch for.

### Bug 1: f7d293d's `if: always()` post-step didn't run

**When:** 2026-04-14 → 2026-04-18
**Trigger:** Cron stalled since 4/11. Initial diagnosis: 5h50m timeout. Fix: bump timeout to 7h + add `actions/cache/save@v4` with `if: always()` so cache persists on cancel.
**Failure mode:** GitHub-hosted runners have a **6-hour hard platform cap** that supersedes any user-set `timeout-minutes`. When the runner is hard-killed at the platform cap, even `if: always()` post-job steps don't execute — they require the job to terminate naturally, not be force-killed.
**Lesson:** GitHub Actions has multiple layers of timeout (step-level, job-level, workflow-level, platform-level). The user-configurable layers are below the platform cap. Architect for sub-6h jobs unconditionally.
**Resolution:** Phase 3.0.0 split the scrape into Track 1 + Track 2 to fit under the cap.

### Bug 2: `pushed:>` doesn't filter on `/search/code`

**When:** 2026-04-25 → 2026-04-27
**Trigger:** Phase 3.0.0 Track 2 incremental ran for 90 min and processed 31,316 of 32,083 candidates. The filter only narrowed search by ~5%.
**Failure mode:** GitHub's `/search/code` endpoint does NOT support `pushed:`, `created:`, `updated:`, or `sort:` qualifiers. The qualifier was either silently ignored or treated as literal text. The 3.0.0 plan-check missed this because nobody verified against authoritative API docs.
**Lesson:** When a plan asserts "this filter narrows X to Y," demand the API docs citation. Plausible-sounding != documented.
**Resolution:** Phase 3.0.1 pivoted Track 2 to `/search/repositories` (which DOES support `pushed:>`) + per-repo tree enumeration.

### Bug 3: skills-raw.json gitignored ⊥ skip-known-IDs needs it on runner

**When:** 2026-04-29
**Trigger:** Phase 3.0.1 Track 2 incremental's skip-known-IDs logic found an empty Set on the CI runner.
**Failure mode:** `data/skills-raw.json` is 295 MB (exceeds GitHub's 100 MB single-file push limit) so it's gitignored. After `actions/checkout@v4`, the runner has no skills-raw.json on disk. The skip-known logic builds knownIds from an empty array → zero skips → re-parses entire corpus → hits 90-min cap.
**Lesson:** State that lives in gitignored files isn't actually persistent. Either commit it (size-permitting), GHA-cache it, store in cloud (R2/KV/S3), or accept re-derivation each run.
**Resolution:** GHA cache for skills-raw.json + bootstrap workflow seeded from a GitHub Release asset (proven pattern from the etag-cache bootstrap).

### Bug 4: V8 string limit on `JSON.stringify`

**When:** 2026-04-26
**Trigger:** `saveETagCache(getETagCache())` crashed with `RangeError: Invalid string length`.
**Failure mode:** V8 has a ~536 MB hard limit on string length. The etag cache grew past 500 MB on the runner. `JSON.stringify(cache)` tried to produce a string longer than V8 allows.
**Lesson:** Any operation that materializes a large object as a single string has a hidden ceiling. For files approaching 256 MB, use streaming I/O (chunk writes via `writeSync` to an fd, NOT `writeFileSync(JSON.stringify(...))`).
**Resolution:** Streaming save with `openSync/writeSync/closeSync/renameSync` (commit `82cc7ab`).

### Bug 5: Mega-repos blow the API budget

**When:** 2026-05-05 (Phase 3.0.1 in production)
**Trigger:** Daily runs were finishing but timing out at 90 min. CI log showed a 58-minute stall between repos 450 and 500.
**Failure mode:** Some repos contain hundreds of SKILL.md files (awesome-list aggregators). The 3.0.1 implementation fetched every SKILL.md file via the contents API. 100+ fetches × candidate count = exhausted 5000/hr budget → 1-hour rate-limit wait → cap hit.
**Lesson:** Per-repo cost can be unbounded if you don't cap it. Even with a "skip already-indexed" check, the first encounter still fetches everything. Cap per-repo file count well below the user-facing limit (filter caps at 2 per repo anyway — fetching 100s is wasted work).
**Resolution:** Phase 3.0.2 added `MAX_FILES_PER_REPO = 50` cap + content_sha-based skip-known (using tree blob shas to detect unchanged content without per-file fetches).

### Bug 6: 24h staleness re-fetch wasted budget

**When:** 2026-05-05 (same diagnosis as Bug 5)
**Trigger:** "updated" counter in Track 2 jumped 1,804 → 6,903 in 50 repos.
**Failure mode:** The skip-known logic only skipped if `scraped_at` was <24h old. After day one, every entry is >24h, so every entry gets re-fetched daily even if content is identical.
**Lesson:** "Skip if recently scraped" is a time-based heuristic. "Skip if content unchanged" is content-based. Always prefer content-based when possible.
**Resolution:** Phase 3.0.2 replaced the 24h check with `existing.content_sha === blobSha` (where blobSha comes from the trees endpoint response, which is git's content hash).

### Bug 7: OPENAI_API_KEY secret name typo

**When:** 2026-05-16
**Trigger:** Daily runs completing scrape/filter, failing at Embed step. 12 days of consecutive failures because Embed needs `OPENAI_API_KEY` (the standard OpenAI env var) but the GitHub secret was named `OPEN_API_KEY` (missing the I).
**Failure mode:** Workflow references `${{ secrets.OPENAI_API_KEY }}`. Secret store has `OPEN_API_KEY`. Mismatch → empty env var → embed-skills.js errors out → workflow fails → no commit.
**Lesson:** Secret names are case-sensitive AND typo-sensitive. There's no validation at workflow-setup time. Worth a one-line check at workflow start that fails loud if expected secrets are blank.
**Resolution:** Renamed secret to `OPENAI_API_KEY` in the GitHub repo settings.

### Bug 8: KV namespace placeholder in `wrangler.toml`

**When:** 2026-05-16 (after Bug 7 fixed)
**Trigger:** Deploy step failed with `KV namespace 'REPLACE_WITH_NAMESPACE_ID' is not valid [code: 10042]`.
**Failure mode:** Back on 2026-04-18, the KV binding was uncommented in `wrangler.toml` with a placeholder ID. Note at the time: "safe because Cloudflare will reject deploy with a placeholder ID before it breaks anything." That WAS true — protected the worker from breaking silently — but blocked all deploys until a real namespace existed. Nobody noticed for ~4 weeks because every prior deploy attempt had failed earlier in the pipeline.
**Lesson:** Latent landmines in placeholder values surface only when the path that uses them becomes reachable. Audit `REPLACE_WITH_*` markers regularly.
**Resolution:** Created `claudeatlas-QUERY_CACHE` KV namespace in Cloudflare dashboard, pasted real ID into `wrangler.toml`.

### Bug 9: Bot push permission denied (`github-actions[bot]` → 403)

**When:** 2026-05-16 (the final wall)
**Trigger:** First fully-green daily-scrape ran, but `git pull` returned "Already up to date." The bot's commit was created locally but the push silently failed.
**Failure mode:** GitHub changed default `GITHUB_TOKEN` scope to read-only (~2023 security tightening). Workflow's `Commit skills data` step: bot creates commit ✓, `git push` returns 403, `|| true` swallows the error, step reports green. CI showed success while no data ever reached origin.
**Lesson:** `|| true` on a push step is a footgun. It silently turns auth failures into successes. ALWAYS fail loud on git push. Either grant `contents: write` permission explicitly OR use a PAT with appropriate scope.
**Resolution:** Added `permissions: contents: write` at the job level + removed `|| true` from `git push` in both daily-scrape.yml and weekly-discover.yml (commit `83195a3`).

---

## Pattern-of-patterns lessons

The cascade was a sequence of silent-failure bugs:

1. **`|| true` masks push failures** (Bug 9)
2. **Placeholder values in config** that you forgot about (Bug 8)
3. **Secret name typos** that don't fail at workflow-load time (Bug 7)
4. **Unbounded per-item costs** that work fine for the median and explode on the tail (Bug 5)
5. **Time-based skip heuristics** that degrade over time (Bug 6)
6. **API qualifiers that look right but aren't documented** (Bug 2)
7. **Gitignored state that the pipeline depends on** (Bug 3)
8. **Memory limits hidden behind helper functions** (Bug 4)
9. **Platform limits that supersede user config** (Bug 1)

**Common thread: silent green CI while no real work happened.** Every fix landed via plan-check that demanded ground-truth evidence over plausible-sounding claims. The 3.1 plan-check explicitly added a "would this have caught the 3.0.x bugs?" sanity check and surfaced two more silent-failure landmines (vectorizeId mismatch, PRESERVED_FIELDS regression) BEFORE execution.

The 3.0.x lesson is: **demand empirical evidence in research and plan-check, especially for claims about API behavior, memory limits, and silent fall-through paths.**

---

## Decisions log (all locked, in chronological order)

### Phase 3.0.0 — Split-track scrape

- **Track 1** = daily Star Pulse over 826 known repos (engagement signals only)
- **Track 2** = daily discovery (new SKILL.md content)
- **Snapshot writes from Track 1**, not Track 2 (Track 1 always completes; Track 2 is best-effort)
- **Both tracks share `data/etag-cache.json`** via existing helpers
- **Weekly Sunday workflow** for full code-search safety net

### Phase 3.0.1 — State persistence

- **Decision A:** Discovery uses `/search/repositories` (NOT `/search/code`) because the latter doesn't support `pushed:>` filters
- **Decision E:** `skills-raw.json` persists via GHA cache + release-asset bootstrap (mirror of etag-cache bootstrap pattern)
- **Decision G:** Track 1 stays REST (not GraphQL). Track 1 already finishes <5 min; migration not worth complexity
- **Filter graceful fallback** for missing skills-raw.json (Track-1-only days don't break CI)

### Phase 3.0.2 — Discovery cost reduction

- **Bug 1 fix:** Use trees-endpoint blob shas to detect actually-unchanged SKILL.md files (zero content fetches for stable files)
- **Bug 2 fix:** `MAX_FILES_PER_REPO = 50` caps mega-repo cost
- **Bug 3 (Track 1 etag invalidation):** Documented as acceptable; daily ~500-800 fresh requests is fine because Bug 1 freed up Track 2's budget

### Phase 3.1 — Filter overhaul (planned, not yet executed)

- **Decision A:** 0.92 cosine = duplicate (empirically validated via pair-similarity histogram on `data/skill-vectors.ndjson` — clean natural valley between 0.88 and 0.92)
- **Decision B:** Novelty is PERCENTILE-based (top 5%), NOT absolute 0.45 (the spec's value is at the noise floor of random pair similarities)
- **Decision C:** Active-fork detection DROPPED (scrape.js skips git forks at discovery; spec's logic was dead code). Replaced with semantic-clone via `skill_first_commit_at`
- **Decision D:** 13 slug collisions in current skills.json (not 6 as audit said); fix is path-aware slug + Worker 301 redirects for old URLs
- **Decision E:** Novelty computed LOCALLY from `data/skill-vectors.ndjson`, NOT via Cloudflare Vectorize ANN (would break $12/yr budget at daily query volume)
- **Decision F:** Dedup is now the load-bearing gate (replaces MAX_PER_REPO=2 which currently suppresses 88% of raw records)
- **Decision G:** Multi-pass pipeline — Filter → Embed → Enrich (new) → Compute-similar → Upload-vectors → ...
- **Decision H:** Tier thresholds stay absolute (90 / 70) per spec — "Top" is meant to be rare

### Cross-phase decisions

- **Plugin work explicitly deferred** to Phase 3.2 (scoring) and 3.3 (pages). 3.1 is skills-only.
- **The `is_duplicate` flag is honored site-side** in `src/lib/skills.js` (per FLAG 1 in 3.1 plan-check) so default browse stays clean even though raw catalog includes duplicates.
- **`PRESERVED_FIELDS` extended** to carry `is_duplicate`/`canonical_slug`/`novelty_score` across daily runs so a single failed enrich doesn't wipe state.

---

## What's actively working in production

Verified 2026-05-17:

### Daily pipeline (scheduled + workflow_dispatch)
- 06:30 UTC daily cron
- ~15 min runtime
- Steps: Restore caches → Track 1 → Track 2 (via repo search) → Save caches → Filter → Embed → Upload to Vectorize → Build → Deploy → Health → Commit
- Bot commits fresh `data/skills.json`, `data/pipeline-stats.json`, `data/history/<today>.json` back to main

### Weekly pipeline (scheduled)
- 03:00 UTC Sundays
- 7h budget (will hit 6h platform cap; cache save persists progress for next week)
- Full code-search safety net for SKILL.md files in repos without recognized topics

### Bootstrap workflows (workflow_dispatch only, one-shot)
- `bootstrap-etag-cache.yml` — re-seeds etag cache from a release asset (used once on 4/26)
- `bootstrap-skills-raw.yml` — re-seeds skills-raw.json from a release asset (used once on 4/29)
- Release assets `etag-cache-bootstrap` and `skills-raw-bootstrap` exist; keep them permanent

### Live site
- https://claudeatlas.com served by Cloudflare Workers (Static Assets binding)
- KV binding `QUERY_CACHE` active for semantic-search query embedding cache
- Vectorize binding `VECTORIZE` for the actual semantic search
- D1 binding `DB` for search query log
- Cloudflare Web Analytics enabled (~3.6k visits over 30 days, May 14 spike to ~940 visits)
- PostHog custom events (EU cloud, `PUBLIC_POSTHOG_KEY` in CI secrets)

### Repo state
- `main` branch: clean, all 3.0.x infrastructure landed
- 65+ history snapshots in `data/history/` will accumulate from today forward (current: 4/11, 4/25, 5/16, 5/17 — bootstrap snapshots + first two bot-committed)
- `data/skills.json`: 1,885 skills, refreshed daily

---

## Open items for the next session

### Ready to execute
- **Phase 3.1 (filter overhaul)** — all planning artifacts committed at `6c55715`
  - 10 tasks, 5 waves, ~4-6 hours
  - Path: `/gsd:execute-phase 3.1`
  - First product-facing change in v3.0 milestone

### Carryover (still pending; not blocking)
- `scripts/scrape-plugins.js` has uncommitted local diff from 2026-04-13 (defensive null-safety on marketplace_manifest unpacking). Memo at `.planning/MORNING-SCRAPE-PLUGINS-MEMO.md`. Disposition: recommended commit. Pending user sign-off.
- `data/plugins-raw.json` (~34 MB) gitignored, sitting on disk from 4/13 research scrape. Will be input to Phase 3.2.
- Smoke seed (`data/smoke-seed.json`) should be reviewed annually — some entries deliberately don't exist (e.g., `vercel-labs/skills`); verify those still 404 as expected.

### Phase 3 sub-phase queue
- **3.1 (Filter overhaul)** — planned, ready
- **3.2 (Plugin scoring + filtering)** — not yet planned; inputs available in `data/plugins-raw.json`
- **3.3 (Plugin pages)** — not yet planned; depends on 3.2 output shape
- **3.4 (New & Noteworthy section)** — not yet planned; uses 3.1's `novelty_score` field
- **3.5 (Homepage + nav redesign)** — not yet planned; depends on 3.3 (Top Plugins section needs plugin data)
- **3.6 (Tier rename Featured → Top)** — not yet planned; codebase-wide rename
- **3.7 (Pipeline integration)** — not yet planned; daily cron handles both skills + plugins
- **3.8 (Cross-entity enrichment)** — creator profiles + API graph include plugins
- **3.9 (/trends page)** — daily snapshot data has been compounding since 5/16; could ship after a few weeks of data

### Spec corrections (rolled into 3.1 Task 8)
- `docs/PHASE-3.0-SPEC.md` will be edited to:
  - Replace "0.45 novelty" with "top 5% by novelty percentile"
  - Replace "active-fork detection" with "semantic-clone via skill_first_commit_at"
- This prevents 3.2-3.9 planning from inheriting the wrong constants

---

## Where to find what

| Topic | Authoritative file |
|---|---|
| Project mission, core value, constraints | `CLAUDE.md` (project section at bottom) |
| Phase 3.0 spec (v3.0 milestone scope) | `docs/PHASE-3.0-SPEC.md` |
| 3.0.0 plan + check | `.planning/phases/03.0.0-split-track-scrape/` |
| 3.0.1 plan + research + check | `.planning/phases/03.0.1-pipeline-state-persistence/` |
| 3.0.2 plan + check | `.planning/phases/03.0.2-discovery-cost-reduction/` |
| 3.1 plan + research + check | `.planning/phases/03.1-filter-overhaul/` |
| Codebase map (4/14 snapshot) | `.planning/codebase/*.md` |
| 1.5 + v2.0 audit | `.planning/VERIFICATION-1.5-v2.0.md` |
| Roadmap | `.planning/ROADMAP.md` |
| Current state (updated this session) | `.planning/STATE.md` |
| This memo | `.planning/SESSION-MEMO-2026-04-to-05.md` |

---

## How to resume in the next session

1. Read this memo (you're doing it).
2. Confirm current pipeline state:
   ```cmd
   gh run list --workflow=daily-scrape.yml --limit=3 --repo dwalshx/ClaudeAtlas
   git log origin/main --oneline -5
   ls data/history/ | wc -l
   ```
   Expect: recent runs green, fresh bot commits, growing snapshot count.
3. Read `.planning/phases/03.1-filter-overhaul/3.1-PLAN.md` (Rev 2, 2,463 lines).
4. Invoke `/gsd:execute-phase 3.1`.
5. The plan is executor-ready — embedded code, tagged tasks, atomic commits, verification protocol.

If anything in the daily pipeline regresses while 3.1 is in flight, the rollback is to revert the 3.1 commits — existing fields are additive so site rendering survives.

---

*Memo authored 2026-05-17 to capture session context for next-session handoff. Update when significant new context emerges.*

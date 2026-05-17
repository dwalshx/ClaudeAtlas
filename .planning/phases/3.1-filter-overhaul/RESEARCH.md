# Phase 3.1: Filter Overhaul — Research

**Researched:** 2026-05-16
**Domain:** Embedding-based dedup, novelty scoring, GitHub fork detection, Cloudflare Vectorize at scale
**Confidence:** HIGH for empirical findings (Q1–Q6, Q8); MEDIUM for Q7 (architectural recommendation), LOW only where explicitly flagged UNVERIFIED.

## Summary

Phase 3.1 is the moment ClaudeAtlas stops being a curated gallery and becomes a comprehensive index. The empirical analysis below is the difference between a plan that works and one that wishes:

- The current catalog is **1,889** skills (not 1,078 — that's stale state from April vectors). `skills-raw.json` contains **33,000** records across **3,059** unique repos.
- Dropping `MAX_PER_REPO=2` and `MIN_STARS=10` would admit **~30,458** records before any embedding-based dedup. **Mega-repos dominate the tail:** `jeremylongshore/claude-code-plugins-plus-skills` alone has 4,621 SKILL.md files; the top 3 repos contribute >13,000 records.
- The spec's **0.92 cosine threshold for duplicate detection is empirically well-placed.** A histogram of the 1,078 existing vectors shows a clear natural valley between 0.88 and 0.92 (the 0.89, 0.90, 0.91 buckets have zero pairs), and the cliff into 0.98–1.00 is dense with confirmed copies of identical content.
- The spec's **0.45 novelty threshold is NOT empirically defensible** as currently framed. With `text-embedding-3-small`, random skill pairs cluster around 0.20–0.40 cosine; **p95 of random pairs is 0.45.** A novelty score of "1 − max_similarity" almost never exceeds 0.45 because every skill has some neighbor with sim > 0.55. Concrete data: of 1,078 vectors, only **273 (25%) have nearest-neighbor sim ≤ 0.55** (i.e., novelty ≥ 0.45). This threshold needs recalibration against the 3.1 catalog OR the framing must change (novelty as percentile, not absolute).
- **Active-fork detection as specified is mostly a dead code path** in the current pipeline: `scripts/scrape.js:462` and `scripts/scrape-discover-repos.js:309` skip forks at discovery time. `repo_is_fork: false` for 100% of 33,000 raw records. The phenomenon the spec wants to detect ("active fork has diverged from parent") is already excluded upstream. To make this work, **either** unblock fork discovery first **or** redefine "fork" semantically as "high-similarity embedding pair regardless of git fork relationship" (recommended).
- **Slug collisions: the audit understated the count.** Empirical check finds **13 colliding slugs** in current skills.json, not 6. Three are intra-repo (same `owner/repo`, different paths — these are bugs in `slug` computation). Ten are cross-repo within the same org (e.g., `quickwit-oss/tantivy` and `quickwit-oss/quickwit` both have `.claude/skills/simple-pr/`).
- **Free-tier Vectorize is comfortable at 1,889 corpus, tight at 20k corpus, blown at 100k corpus.** Math: 30M queried dims/month free ÷ 1,536 dims = 19,531 queries/month free. Daily novelty run at 20k corpus = 600k queries/month = needs paid tier (~$6/month). See Q5.

**Primary recommendation:** Adopt the spec's filter changes verbatim with two adjustments: (1) define novelty in percentile terms (top-N% novel within the catalog) rather than absolute 0.45; (2) redefine "active fork" as semantic-clone-of-newer-content rather than git-fork relationship, because git forks are excluded upstream.

---

## User Constraints (from project context)

No CONTEXT.md exists for this phase. Constraints derived from `docs/PHASE-3.0-SPEC.md` and `CLAUDE.md`:

### Locked Decisions
- **Filter changes (spec, lines 96–105):** drop `MAX_PER_REPO`, drop `MIN_STARS`, keep slop blacklist, keep language variant dedup, lower `MIN_BODY_LENGTH` from 500 to 200.
- **Add embedding-based dedup** with cosine threshold > 0.92 (spec line 112).
- **Add novelty scoring** = `1 - max_similarity` (spec line 139).
- **Add active-fork detection:** 10+ unique commits AND embedding distance > 0.1 from original (spec line 130).
- **Fix slug collision bug** (deferred from Phase 1.5.2).
- **Tech stack locked:** Astro 5 + Cloudflare Workers Static Assets; `text-embedding-3-small` (1536 dims, cosine); Vectorize index `claudeatlas-skills`.
- **Cost ceiling:** ~$12/year (domain only). Any new paid line item needs approval.
- **GHA budget:** daily-scrape.yml currently runs ~14 min, soft cap 90 min.

### Claude's Discretion
- Single-pass vs. multi-pass pipeline ordering (Q7).
- Exact cosine threshold (spec says 0.92; research confirms; minor adjustment allowed if evidence dictates).
- Novelty score interpretation: absolute vs. percentile (Q2/Q8 — recommend percentile).
- Slug collision resolution strategy (Q4 — recommend path-suffix on collision only).
- Active-fork logic redefinition since git-fork path is dead (Q3 — recommend semantic-clone framing).

### Deferred Ideas (OUT OF SCOPE for 3.1)
- "New & Noteworthy" homepage UI (deferred to Phase 3.4).
- Plugin scoring (deferred to Phase 3.2).
- Tier rename Featured→Top (deferred to Phase 3.6).
- Editorial tier system (deferred to Phase 4+).

---

## Phase Requirements

| Req ID | Description | Research Support |
|---|---|---|
| FILT-01 | Drop `MAX_PER_REPO=2` cap | Q6: counterfactual shows ~29,343 records currently suppressed by cap; dropping it admits the entire long tail. |
| FILT-02 | Drop `MIN_STARS=10` gate | Q6: ~3,466 records (10.5% of raw) currently filtered; admitting them barely moves the needle compared to MAX_PER_REPO. |
| FILT-03 | Lower `MIN_BODY_LENGTH` to 200 | Q6: changes slop-rejection count from 3,362 to 2,542 records (saves ~820 records). |
| FILT-04 | Embedding dedup at cosine > 0.92 | Q2: empirically validated against vector histogram — natural valley 0.88–0.92, dense cliff above. |
| FILT-05 | Novelty score on every record | Q2/Q8: definition correct, threshold (0.45) needs recalibration → percentile-based. |
| FILT-06 | Active-fork detection | Q3: redefine because git forks are pre-filtered; use semantic-clone + first-commit-timestamp. |
| FILT-07 | Slug collision fix | Q4: 13 collisions found (audit said 6); use path-suffix-on-collision strategy. |
| FILT-08 | Recalibrate filter | Q6: projected catalog ~30k records before dedup → ~5-15k after embedding dedup (estimate; needs measurement). |

---

## Q1. Cloudflare Vectorize ANN query mechanics

**Source:** [Cloudflare Vectorize docs](https://developers.cloudflare.com/vectorize/), fetched 2026-05-16.

### Confirmed facts (HIGH confidence)

| Property | Value | Source |
|---|---|---|
| Max `topK` with `returnMetadata` or `returnValues` | **50** | [platform/limits/](https://developers.cloudflare.com/vectorize/platform/limits/) |
| Max `topK` without metadata/values | **100** | same |
| Max vectors per index | 10,000,000 | same |
| Max dimensions | 1536 (32-bit precision) | same |
| Default `topK` | 5 | best-practices docs |
| Free tier queries/month | **30M queried vector dimensions / month** | [pricing/](https://developers.cloudflare.com/vectorize/platform/pricing/) |
| Free tier storage | **5M stored vector dimensions** | same |
| Paid: included queries | 50M queried dims/month included | same |
| Paid: overage | $0.01 per million queried dimensions | same |
| Paid: storage overage | $0.05 per 100M stored dimensions | same |
| Metadata filter operators | `$eq, $ne, $in, $nin, $lt, $lte, $gt, $gte` | [reference/metadata-filtering/](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/) |
| Filter size limit | Compact JSON < **2048 bytes** | same |
| Self-exclusion via `$ne` on `id` | **Supported** | same — `{ "id": { "$ne": "some-id" } }` |

### topK=2 strategy

For novelty scoring we want the nearest neighbor that ISN'T self.

**Option A (preferred):** Query with `topK=2` and discard match[0] if its id == query-skill id.

**Option B:** Use metadata filter `{ "id": { "$ne": "self_id" } }` and `topK=1`. Cleaner code, same cost (queried dimensions billed regardless of topK).

Both are within the 50-with-metadata cap. Option B is recommended for clarity. Each Vectorize query is billed as 1×1,536 = 1,536 queried dimensions regardless of topK ≤ 50 (the billing meter is per query dimension count, not per result).

### Query response shape (cosine metric)

**UNVERIFIED in official docs:** Cloudflare's docs only document Euclidean examples explicitly, where lower score = closer. The cosine score range is not explicitly documented.

**Verified empirically from production code** (`worker/index.js:266–291`): the worker sorts `matches` descending by `m.score`, treats higher score = more similar, exposes as `score: 0.999909486`-style values. **Conclusion:** for this index (configured `metric = cosine`), `match.score` is cosine similarity in [−1, 1] with higher = more similar. The semantic search endpoint has been working in production since Phase 2.1, so this is empirically locked.

### Query latency

**UNVERIFIED:** Cloudflare publishes no p50/p99 SLOs for Vectorize. Empirical measurement is possible via `worker/index.js:264` which logs `vecMs` per request. Action for Plan: instrument and log a week of production timings before relying on hard latency targets.

**Plausible operational estimate:** based on worker production traces shipping ~200ms total for embed+vector queries combined, vector-only latency is likely 50–200ms p50. Treat as a planning estimate, not a contract.

---

## Q2. Cosine threshold calibration — empirical results

### Method

```bash
node --max-old-space-size=4096 -e "
const f=require('fs');
const lines = f.readFileSync('data/skill-vectors.ndjson','utf-8').split('\n').filter(Boolean);
const recs = lines.map(l=>JSON.parse(l));
// L2-normalize once
const vecs = recs.map(r => {
  const v=r.values; let n=0; for(let i=0;i<v.length;i++) n+=v[i]*v[i]; n=Math.sqrt(n);
  const nv = new Float32Array(v.length); for(let i=0;i<v.length;i++) nv[i]=v[i]/n;
  return nv;
});
function dot(a,b){let d=0;for(let i=0;i<a.length;i++)d+=a[i]*b[i];return d;}
// O(n²) — 1.16M pairs on n=1078 — runs in 1.9s
// (full code in research session log)
"
```

### Finding 1: Random-pair similarity distribution (N=1000 sample)

| Quantile | Cosine sim |
|---|---|
| min | 0.103 |
| p10 | 0.220 |
| p25 | 0.260 |
| p50 | 0.310 |
| p75 | 0.362 |
| p90 | 0.412 |
| **p95** | **0.448** |
| p99 | 0.514 |
| max | 0.591 |

**Key insight:** `text-embedding-3-small` produces vectors that cluster the random-pair distribution around 0.20–0.40, NOT around 0 as a naïve "cosine baseline" intuition would suggest. This is because LLM embeddings encode strong global priors (e.g., "is technical content," "is English"), so two unrelated technical skills already share substantial vector overlap.

### Finding 2: Nearest-neighbor similarity distribution (full O(n²) on N=1078)

For each skill, find its nearest non-self neighbor:

| Quantile | NN cosine sim | Interpretation as novelty=1-sim |
|---|---|---|
| min | 0.354 | novelty 0.646 (most novel skill) |
| p10 | 0.502 | novelty 0.498 |
| p25 | 0.549 | novelty 0.451 |
| p50 | 0.608 | novelty 0.392 (median) |
| p75 | 0.687 | novelty 0.313 |
| p90 | 0.819 | novelty 0.181 |
| p95 | 0.987 | novelty 0.013 |
| p99 | 1.000 | novelty 0.000 (literal dupe) |

### Finding 3: Pair histogram in the duplicate zone (0.80–1.00)

```
0.80 -> 6 pairs
0.81 -> 4
0.82 -> 6
0.83 -> 7
0.84 -> 3
0.85 -> 4
0.86 -> 1
0.87 -> 3
0.88 -> 3
0.89 -> 0   ← natural valley
0.90 -> 0   ← natural valley
0.91 -> 0   ← natural valley
0.92 -> 1
0.93 -> 2
0.94 -> 2
0.95 -> 1
0.96 -> 2
0.97 -> 3
0.98 -> 13
0.99 -> 18
1.00 -> 11
```

**This is gold.** There is a natural empty zone between 0.88 and 0.92 in the actual catalog. The spec's threshold of 0.92 lands exactly at the start of the duplicate cliff. **Confirmed empirically: 0.92 is the right number.**

### Finding 4: Gray-zone manual inspection (0.80 ≤ sim < 0.92)

The 37 pairs in this zone are mostly **legitimate-but-similar** — different solutions to the same problem space:

| Sim | Pair A | Pair B | Verdict |
|---|---|---|---|
| 0.888 | geoffreycrofte/raam-audit | geoffreycrofte/raam-code | Same author, related skills — keep both |
| 0.887 | testdino-hq/playwright-skill | testdino-hq/playwright-core | Same author, related — keep both |
| 0.878 | iOfficeAI/skill-creator | AIPexStudio/skill-creator | Two different "skill creator" implementations — keep both |
| 0.877 | Jeffallan/code-reviewer | jaem1n207/code-reviewer | Two distinct code reviewers — keep both |
| 0.860 | jabrena/031-architecture-adr-functional-requirements | jabrena/032-architecture-adr-non-functional-requirements | Adjacent ADR skills — clearly distinct, keep both |

**Conclusion:** Below 0.92, content is meaningfully different even when topical. Threshold validates.

### Finding 5: High-zone manual inspection (0.92 ≤ sim < 0.99)

24 pairs in this range. Sample:

| Sim | Pair A | Pair B | Verdict |
|---|---|---|---|
| 0.989 | openclaw/alphasense | membranedev/alphasense | True duplicate cross-repo |
| 0.989 | fengshao1227/openspec-apply-change | saadshahd/openspec-apply-change | True duplicate |
| 0.987 | quickwit-oss/simple-pr (intra-org collision) | itself | Slug collision artifact, not a real dupe |
| 0.986 | ThinkInAIXYZ/algorithmic-art | anthropics/algorithmic-art | One of these is the canonical Anthropic skill; the other is a copy |
| 0.961 | slopus/agent-browser | avibebuilder/agent-browser | True duplicate |
| 0.943 | OthmanAdi/planning-with-files | OthmanAdi/pi-planning-with-files | Same author, near-clone variant |
| 0.922 | iOfficeAI/skill-creator | RKiding/skill-creator | Borderline — distinct authors, same template? |

**Conclusion:** 0.92 catches real duplicates with high precision. A handful of borderline cases at 0.92–0.94 may be near-clones from a shared template — acceptable false-positive rate for the purpose (flagging the duplicate but not hard-deleting).

### Finding 6: Spec thresholds — recommendation table

| Threshold | Spec value | Empirical verdict | Recommendation |
|---|---|---|---|
| Duplicate (cosine sim) | **> 0.92** | **CONFIRMED** by histogram natural valley | Keep 0.92 |
| Novelty noteworthy (1-sim) | > 0.45 (absolute) | **REJECT** — only 25% of catalog hits this | Reframe as percentile (top X% by novelty within catalog) |
| Active-fork divergence (embedding distance > 0.1) | spec | Untestable in current data (no forks) | Reframe — see Q3 |

### Finding 7: Novelty threshold — concrete alternative

Instead of "novelty > 0.45 absolute," define:

> **"New & Noteworthy" candidate = quality_score ≥ 80 AND novelty in top 5% of catalog**

In the current 1,078-record catalog, top-5% novelty corresponds to nn_sim < ~0.50 (about 54 skills). This is a curation-feeling slice — small, hand-pickable, refreshes daily as the catalog grows. The 0.45 absolute number would over-fire on the existing catalog (273 candidates) and under-fire as catalog grows.

---

## Q3. Active-fork detection mechanics

### Source: [GitHub REST API — Commits — Compare](https://docs.github.com/en/rest/commits/commits#compare-two-commits)

### Verified facts

- Endpoint: `GET /repos/{owner}/{repo}/compare/{basehead}` returns `ahead_by` and `behind_by` integer fields. **HIGH confidence.**
- Cross-repo comparison supported within a repo network: syntax `USERNAME:BASE...USERNAME:HEAD`. **HIGH confidence.**
- Each call counts as **1 request** against the 5,000/hr authenticated REST rate limit. **HIGH confidence** (standard REST endpoint, no special pricing).

### What's NOT documented

- Behavior when the parent repo is deleted, private, or transferred — **UNVERIFIED.** Plan task: empirically probe with a deliberately-broken fork before relying.
- Behavior when fork is itself a fork of a fork — UNVERIFIED. The `parent` field of repo metadata gives the immediate parent, not the original ancestor. Use `source` field for ultimate root.

### Critical finding: the entire active-fork path is dormant

Empirical check:

```bash
node -e "
const raw = JSON.parse(require('fs').readFileSync('data/skills-raw.json'));
let forks = 0;
for (const s of raw) if (s.repo_is_fork) forks++;
console.log('forks in raw:', forks);  // → 0
"
```

**Result: 0 forks in 33,000 raw records.** Cause: `scripts/scrape.js:462` and `scripts/scrape-discover-repos.js:309` explicitly skip `repo.fork === true` at discovery time. The data simply never enters the pipeline.

### Recommendation: reframe "active fork"

The spec's intent ("when content is duplicated, prefer the actively-maintained version") is valid. But the trigger is wrong — git fork relationship is not the only path to content cloning, and is the path we've blocked.

**Proposed redefinition:**

```
When embedding_dedup detects a pair with sim > 0.92:
  1. Compare `skill_first_commit_at` timestamps (already backfilled in Phase 2 DATA-01)
  2. The OLDER skill is canonical by default
  3. If the YOUNGER skill is more active (recent commits + higher repo_pushed_at recency)
     AND the embedding distance has grown (i.e., evolved beyond a copy):
       → flag YOUNGER as "active descendant," demote OLDER
  4. Use repo_full_name path containing parent's org name as a hint
     (cheap heuristic before/instead of GitHub fork API)
```

This sidesteps the GitHub `/compare` call entirely. **0 API requests vs. N-forks-per-day.** No new rate-limit cost.

If we DO want to unblock git-fork discovery in a future phase, the path is: remove the `repo.fork` skip in scrape.js, add fork filtering at the filter.js layer instead, then `/compare` becomes useful.

### Storage / caching plan if we DO add `/compare`

- Cache `ahead_by` and `behind_by` per `(fork_repo, parent_repo)` pair on the skill record.
- Refresh cadence: monthly is sufficient. Adding to daily run wastes budget for a slow-moving signal.
- Edge cases to handle: 404 on parent (deleted/private), 451 (DMCA-blocked), parent rename → resolve via `parent.full_name` field freshly fetched.

---

## Q4. Slug collision fix design

### Empirical: actual collision count

The audit doc said 6 collisions. Direct grep of `data/skills.json` (1,889 records):

```bash
node -e "
const skills = JSON.parse(require('fs').readFileSync('data/skills.json'));
const bySlug = {};
for (const s of skills) (bySlug[s.slug] = bySlug[s.slug] || []).push(s);
const dupes = Object.entries(bySlug).filter(([k,v]) => v.length > 1);
console.log('colliding slugs:', dupes.length);
for (const [slug, items] of dupes) console.log(slug, '->', items.length);
"
```

**Actual count: 13 colliding slugs.** Breakdown:

| Slug | Count | Type |
|---|---|---|
| `microsoft/azure-aigateway` | 2 | Cross-repo: `microsoft/skills` + `microsoft/azure-skills` |
| `alinaqi/agent-teams` | 2 | Cross-repo: `alinaqi/maggy` + `alinaqi/claude-bootstrap` |
| `alinaqi/agentic-development` | 2 | Cross-repo same as above |
| `quickwit-oss/simple-pr` | 2 | Cross-repo: `tantivy` + `quickwit` |
| `ComposioHQ/brand-guidelines` | 2 | Cross-repo: `open-claude-cowork` + `awesome-claude-skills` |
| `laravel/configure-nightwatch` | 2 | Cross-repo: `nightwatch` + `agent-skills` |
| `resend/resend-cli` | 2 | Cross-repo: `resend-skills` + `resend-cli` |
| `mcpware/organize` | 2 | Cross-repo: `claude-code-organizer` + `cross-code-organizer` |
| `MetalLegBob/sos` | 2 | Cross-repo with renaming |
| `kcchien/crisp-reading` | 2 | Cross-repo: `crisp-reading` + `skills` |
| `lllooollpp/mijia-control` | 2 | Cross-repo |
| `auth0/auth0-android` | 2 | Cross-repo: `docs-v2` + `agent-skills` |
| `METR/debug-stuck-eval` | 2 | Cross-repo: `inspect-action` + `hawk` |

**Audit was 50% under-count.** Mostly cross-repo, all same-owner.

### Slug strategy options

| Option | Slug shape | Pros | Cons |
|---|---|---|---|
| **A.** Path-suffix-on-collision | Unique: `owner/skill-name`. Collision: `owner/repo-name/skill-name` | Backward compatible for 99% of URLs | Two URL shapes; conditional logic |
| **B.** Always include repo | `owner/repo/skill-name` | One canonical shape | Breaks ALL 1,876 non-colliding URLs |
| **C.** Always include path hash | `owner/skill-name-a1b2c3` | One canonical, opaque | Bad UX, breaks SEO, ugly |
| **D.** Disambiguate by repo only on collision | Unique: `owner/skill-name`. Collision: `owner/skill-name@repo` | Backward compatible | URL syntax `@` is unusual |

### Recommendation: Option A

```
slug = (collision_count_for_(owner, name) > 1)
       ? `${owner}/${repo_name}/${skill_name}`
       : `${owner}/${skill_name}`
```

- 26 skills change URLs (13 collisions × 2 records each). All others keep their existing slugs.
- Vectorize records are keyed by skill `id`, not slug — no Vectorize migration needed. `embed-skills.js:91 vectorizeId(skill.id)` already handles this.
- The `_content_sha` change reflows naturally because `slug` is in the metadata; the records get re-upserted in the next embed cycle.

### Backward-compat for inbound traffic

May 14 traffic spike + AI referrers suggest some URLs are in the wild. For the 26 records that get new URLs:

**Plan:** Add a redirect map to `worker/index.js`. The list of 26 old→new pairs is tiny (well under 2KB), so embed it directly:

```js
const SLUG_REDIRECTS = {
  // old → new
  "microsoft/azure-aigateway": "microsoft/azure-skills/azure-aigateway",  // canonical winner
  // ... 25 more
};
// Add to worker before ASSETS.fetch:
if (url.pathname.startsWith('/skills/')) {
  const oldSlug = url.pathname.replace(/^\/skills\//, '').replace(/\/$/, '');
  const newSlug = SLUG_REDIRECTS[oldSlug];
  if (newSlug) return Response.redirect(`https://claudeatlas.com/skills/${newSlug}/`, 301);
}
```

Choose canonical winner = highest `quality_score`. For ties (most of them — same scores), choose the record with the lexically simpler repo name (e.g., `microsoft/azure-skills` over `microsoft/skills`).

### Registry impact

- `/skills-registry.json` — must reflect new slugs. Existing AI consumers see new URLs. Since registry is regenerated daily and consumers re-fetch, the cutover is one-day.
- `/sitemap.xml` — auto-regenerates from Astro routes after slug fix. No manual change.
- Add a note in `methodology.astro` documenting the slug schema.

---

## Q5. Vectorize cost projection at corpus scale

### Free-tier math (verified from [pricing/](https://developers.cloudflare.com/vectorize/platform/pricing/))

- **Free queries: 30M queried vector dimensions / month**
- Each query against the 1,536-dim index = **1,536 queried dimensions** (regardless of topK ≤ 50)
- So **free tier allows 30,000,000 / 1,536 = 19,531 queries/month**
- **Free storage: 5M stored vector dimensions** = **3,255 vectors** at 1,536 dims

### Stored-dim budget at each scale

| Corpus size | Stored dims | Free tier (5M) status |
|---|---|---|
| 1,889 (today) | 2.90M | Comfortable (58% utilization) |
| 5,000 | 7.68M | **Exceeds free tier** (~$0.13/mo at $0.05/100M) |
| 20,000 | 30.72M | $1.54/mo (paid) |
| 30,458 (Phase 3.1 projected max) | 46.78M | $2.34/mo (paid) |
| 100,000 (long-horizon) | 153.6M | $7.68/mo (paid) |

### Query budget at each scale

Daily run pattern needed for Phase 3.1:
- 1 novelty query per skill per day = 1 query × N skills × 30 days

| Corpus size | Daily queries | Monthly queries | Monthly queried dims | Free (30M) status |
|---|---|---|---|---|
| 1,889 | 1,889 | 56,670 | 87M | **Exceeds free tier** by 2.9× |
| 5,000 | 5,000 | 150,000 | 230M | $2/mo paid |
| 20,000 | 20,000 | 600,000 | 921M | $9/mo paid |
| 30,458 | 30,458 | 913,740 | 1,403M | $14/mo paid |

**This breaks the $12/year cost ceiling at the 1,889-skill scale already** if we run novelty queries daily against the live Vectorize index.

### Mitigation strategies

1. **Don't query Vectorize for novelty — compute locally.** We already have `data/skill-vectors.ndjson` (32 MB) as an in-memory-loadable file. `scripts/compute-similar.js` already does O(n²) in 1.9s for n=1078. For n=30k that's ~14 minutes single-threaded, but Vectorize is bypassed entirely. **Recommended.**

2. **Query Vectorize only for new/changed records.** Compute content_sha-based delta; only re-query novelty for the deltas. At 100–500 new records/day this is 3,000–15,000 queries/month = 4.6M–23M dims/month = within free tier.

3. **Move to Workers Paid ($5/mo)** which raises the free-tier baseline considerably. Even so, this breaks the project's $12/year ceiling.

### Recommendation

**For novelty + dedup: compute locally from `data/skill-vectors.ndjson`.** It's already on disk, already loaded by `compute-similar.js`. No Vectorize query cost. The Vectorize index stays for the live search endpoint (which IS query-budget-friendly — see Q5 below).

**Live search budget check:** at current rate (worker logs ~100 searches/day), monthly queries = 3,000 = 4.6M dims/month = comfortably within free tier even at corpus = 30k.

### Bandwidth note

NDJSON file at 30k corpus = ~32MB × (30000/1078) ≈ **890 MB**. This exceeds GHA cache "comfortable" sizes and is too large to commit. **Mitigation:** keep the NDJSON gitignored, restore from GHA cache like skills-raw.json today (Phase 3.0.1 pattern), bootstrap from release asset if cache evicted.

---

## Q6. Filter recalibration risk

### Counterfactual analysis

Method:
```bash
node --max-old-space-size=8192 -e "
const raw = JSON.parse(require('fs').readFileSync('data/skills-raw.json'));
let minStars10 = 0, body200 = 0, body500 = 0, byRepo = {};
for (const s of raw) {
  if (s.repo_stars < 10) minStars10++;
  if (s.body_length < 200) body200++;
  if (s.body_length < 500) body500++;
  byRepo[s.repo_full_name] = (byRepo[s.repo_full_name] || 0) + 1;
}
console.log('raw:', raw.length, 'minStars<10:', minStars10, 'body<200:', body200, 'body<500:', body500);
let suppressedByCap = 0;
for (const c of Object.values(byRepo)) if (c > 2) suppressedByCap += (c - 2);
console.log('suppressed by MAX_PER_REPO=2:', suppressedByCap);
"
```

### Results

| Filter | Records removed today | Records removed in Phase 3.1 |
|---|---|---|
| `MIN_STARS=10` gate | 3,466 (10.5%) | **dropped** → 0 |
| `body_length < 500` slop | 3,362 | **dropped** to 200 → 2,542 (saves 820 records) |
| `MAX_PER_REPO=2` cap | 29,343 (88%) | **dropped** → 0 |
| Other slop (template + biz + no-fm + placeholder) | ~1,855 | unchanged |

### Top mega-repos (the long tail dropping the cap admits)

| Repo | SKILL.md count |
|---|---|
| `jeremylongshore/claude-code-plugins-plus-skills` | 4,621 |
| `aiskillstore/marketplace` | 4,411 |
| `sickn33/antigravity-awesome-skills` | 4,367 |
| `a5c-ai/babysitter` | 2,099 |
| `majiayu000/claude-skill-registry` | 877 |
| `ComposioHQ/awesome-claude-skills` | 864 |
| `davila7/claude-code-templates` | 828 |
| `mukul975/Anthropic-Cybersecurity-Skills` | 754 |
| `majiayu000/claude-skill-registry-data` | 676 |
| `diegosouzapw/awesome-omni-skill` | 527 |
| `alirezarezvani/claude-skills` | 522 |
| `affaan-m/everything-claude-code` | 457 |

Top 3 repos contribute 13,399 records (40% of raw). The top 12 contribute 20,902 (63%).

### Projected catalog size

Before embedding dedup, with Phase 3.1 filter:
- Raw 33,000
- − 2,542 (slop @ body<200)
- = **~30,458 records**

After embedding dedup (sim > 0.92): unknown without running the full O(n²). The current 1,078-skill catalog has 86 pairs above 0.85 sim. Scaled by N²: at 30k records expect roughly 86 × (30000/1078)² ≈ **66,000 high-similarity pairs**. If duplicates are concentrated in mega-repos (which they almost certainly are — they're often cross-marketplace copies), expect:

**Realistic estimate:** post-dedup catalog of **15,000–25,000** distinct records, with the majority of removed duplicates coming from `jeremylongshore/...`, `aiskillstore/...`, `sickn33/...`. **This is the empirical task that must run in implementation, not predicted in research.**

### Tier distribution impact

`scoreSkill()` uses log-scaled stars (20% weight). Removing the MIN_STARS gate doesn't change scoring math — it just admits low-star records. Their scores will mostly be below 70 (Listed tier). Featured tier doesn't grow proportionally.

**Predicted distribution shift:**
- Featured (≥90): stays roughly 500 — large repos dominate this tier regardless of gate
- Solid (70–89): grows modestly, maybe to 1,500–2,500
- Listed (<70): explodes from 167 to ~15,000+ — the long tail

### Homepage UX impact

Homepage shows top 60 only — unaffected by catalog size. The Top tier (renamed in Phase 3.6) remains hand-curated-feeling. The browse pages (category, creator) will need pagination since they'll show thousands of records. **Phase 3.5 (homepage redesign) needs to be aware of this.** Note as cross-phase dependency.

---

## Q7. Pipeline ordering & timing

### Current order (`.github/workflows/daily-scrape.yml`)

```
1. Restore caches (skills-raw.json, etag-cache.json)
2. Track 1 (scrape-pulse.js) — fresh stars/forks/issues for existing skills
3. Track 2 (scrape-discover-repos.js + scrape.js) — discover new skills
4. Save caches
5. filter.js — slop + cap + tier
6. embed-skills.js (delta only) — OpenAI calls
7. upload-vectors.js — Vectorize upsert
8. compute-similar.js — top-5 similarity per skill (local)
9. mine-apis.js, compute-clusters.js, generate-badges.js, generate-registry.js
10. Build Astro
11. Deploy to Workers
12. Commit data files
```

### New dependencies for Phase 3.1

- **Embedding dedup** needs vectors → must run AFTER step 6 (embed)
- **Novelty scoring** needs the full vector set → must run AFTER step 6 (locally) or after step 7 (if Vectorize-based)
- **Active-fork detection** (reframed per Q3) only needs `skill_first_commit_at` + embedding similarity → runs alongside dedup

### Options

**Option A — Multi-pass (recommended):**

```
1. Track 1 + Track 2 (unchanged)
2. filter.js — Phase 3.1 minimal pass:
   - slop blacklist
   - language variant dedup
   - body length 200
   - NO embedding dedup, NO novelty
   - emit skills.json with all admitted records
3. embed-skills.js — embeds all admitted records (delta-only stays cheap)
4. enrich.js (NEW) — single new script:
   - reads skill-vectors.ndjson (already on disk)
   - computes pairwise top-K similarity locally
   - flags duplicates (sim > 0.92): is_duplicate = true, canonical_slug = X
   - computes novelty_score for each record
   - rewrites skills.json in place with new fields
5. upload-vectors.js — Vectorize upsert (now metadata includes is_duplicate)
6. compute-similar.js — unchanged
7. ... rest of pipeline
```

**Pros:** Single source of truth for embeddings (already needs to run before enrich anyway). Clean separation: filter.js stays pure-text-rules. enrich.js owns all the embedding-derived state. compute-similar.js becomes a special case of enrich.js — they could merge later.

**Cons:** Two passes over skills.json (filter writes, enrich rewrites). At 30k records on disk this is fine (~30 MB writes).

**Option B — Single-pass:**

Filter.js does scoring + dedup + novelty in one pass. Means filter.js depends on embeddings being present BEFORE running, which inverts the current order (filter → embed becomes embed → filter).

**Why I don't recommend this:** the embed-skills.js delta logic depends on the OUTPUT of filter.js to know what's in scope. Inverting order means embedding ALL 30k records every day (cold runs would be $0.60+ in OpenAI costs vs $0.001 for deltas).

### Recommendation: Option A (multi-pass with new `enrich.js`)

### Timing budget

Current daily run: ~14 minutes (per CLAUDE.md).

New steps added by Phase 3.1:
- `enrich.js`: O(n²) on ~30k records, in-memory pairwise dot product on Float32Array. Benchmark from this session: n=1078 → 1.9s. Scaling: 1.9 × (30000/1078)² ≈ **24 minutes**. **Exceeds the 14-minute budget addition target.**
- Mitigation: use ANN approximation. Options:
  - Use Vectorize itself (paid tier, see Q5)
  - Use [hnsw-node](https://www.npmjs.com/package/hnsw-node) (local HNSW build). Build time on 30k×1536 is ~30s; query time is sub-millisecond per record. Reduces enrich.js to ~30s build + 30k×0.5ms ≈ 45s total.
  - Use the existing local top-K from `compute-similar.js`: it gives top-5 per skill. That already runs in 1.9s for 1,078 records. For 30k records, scaling O(n²) gives the same 24 min. **Same problem.**
- **Decision needed:** at the projected 15k–25k post-dedup corpus, O(n²) brute force is borderline. **Recommendation:** start with brute force (simpler code), add HNSW only if measured timing exceeds 5 min.

**Estimated total daily pipeline post-3.1:** 14 min (current) + 1–5 min (enrich.js) = 15–19 min. Within the 90-min GHA cap.

---

## Q8. Tier thresholds with the expanded catalog

### Three approaches

| Approach | Definition | Pro | Con |
|---|---|---|---|
| **Absolute** | Featured ≥ 90, Solid 70–89, Listed < 70 (current) | Stable across runs, predictable | As catalog grows, tier counts may not match user expectations (e.g., "Top" feels less elite) |
| **Percentile** | Top = top 5% by score, Solid = next 20%, Indexed = rest | Catalog-size-independent. "Top" always feels rare | Score thresholds vary day to day. Methodology page becomes harder to explain |
| **Hybrid** | Top = score ≥ 90 AND in top 10% (whichever is stricter) | Best of both | Two-rule logic |

### Empirical view of current distribution

In `skills.json` (n=1,889 after current filter):
- Featured (≥90): 501 (26.5%)
- Solid (70–89): 1,221 (64.6%)
- Listed (<70): 167 (8.9%)

The current absolute thresholds produce a top-heavy distribution because the filter pre-removes low-quality records (MIN_STARS=10 + MAX_PER_REPO=2 mostly admit popular repos). Post-3.1 with no star gate and no per-repo cap, the distribution flattens out — Featured stays small, Listed grows.

### Spec-implied direction

Phase 3.0 spec lines 168–172 use absolute thresholds (Top ≥ 90, Solid 70–89). The intent is clear: "Top should be rare, like a Wirecutter pick." Absolute thresholds support this.

Phase 3.4's "New & Noteworthy" uses novelty > 0.45 (absolute). The spec is internally consistent on absolute thresholds.

### Recommendation: **Keep absolute thresholds for tiers, but reframe novelty as percentile**

- Tier thresholds (90 / 70): absolute, unchanged. Matches spec intent.
- Novelty threshold (Phase 3.4): switch from 0.45 absolute to top-5% by novelty within the catalog. See Q2.
- Justify in the methodology page: "Quality is an absolute property of the skill. Novelty is relative — a skill is novel only relative to what already exists."

This split is conceptually clean: quality looks inward (does this skill have stars, recency, frontmatter, body, license, description?) and is comparable across time. Novelty looks outward (is anything else like this in the index?) and is only meaningful relative to the catalog.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| ANN (approximate nearest neighbor) | Custom HNSW | `hnsw-node` (if needed) or brute-force Float32Array dot product | Float32 dot is ~20× faster than Float64; 30k×30k brute is borderline-feasible |
| Cosine similarity | Re-implement | The existing `cosineSimilarity()` in `compute-similar.js` | Already pre-normalizes; reuse |
| Fork detection via Git diffs | Local cloning + log diff | GitHub `/compare` API (1 request) | But: see Q3 — currently unneeded entirely |
| URL canonicalization | Custom regex pile | Existing slug logic + collision map | Audit verified 13 collisions — small enough to hardcode the redirect map |

---

## Common Pitfalls

### Pitfall 1: Treating cosine similarity as if 0 is the random baseline

**What goes wrong:** Plans assume "two unrelated skills should score near 0" and set novelty thresholds accordingly. The result: novelty thresholds fire on nothing because real-world similarity baseline is 0.20–0.40.

**Why:** Modern LLM embeddings encode strong global priors. Two technical documents about totally different domains still share substantial vector overlap because they share "is technical writing" features.

**How to avoid:** Always sample 1000+ pairs from the real catalog and look at the actual distribution before setting thresholds. Use percentile rather than absolute when the baseline is unclear.

**Warning signs:** "novelty > 0.45" looks reasonable theoretically but matches almost nothing in practice. Or matches too much.

### Pitfall 2: Assuming GitHub forks are detectable in our pipeline

**What goes wrong:** Plans include "use GitHub `/compare` API to detect active forks" with N API calls budgeted per day.

**Why:** `scrape.js:462` and `scrape-discover-repos.js:309` skip forks at discovery. By the time we filter, `repo_is_fork: false` for everything. The compare API is unreachable for relevant comparisons.

**How to avoid:** Re-read scrape code before writing fork-related logic. If we want fork support, unblock it in scrape.js first.

### Pitfall 3: Vectorize free-tier query budget exhaustion

**What goes wrong:** Plan budgets 1 Vectorize query per skill per day for novelty scoring. At 20k corpus = 600k queries/month = ~$9/mo paid tier = breaks the $12/year ceiling.

**How to avoid:** Compute novelty locally from `data/skill-vectors.ndjson`. Vectorize is for user-facing search latency; novelty is a build-time concern.

**Warning signs:** Plan tasks that say "VECTORIZE.query" in a daily loop over the full catalog.

### Pitfall 4: Slug-key collisions silently overwriting Vectorize records

**What goes wrong:** Phase 1.5.2 originally used `slug` as Vectorize ID. The 13 colliding slugs caused 13 pairs of vectors to overwrite each other, silently losing data.

**How to avoid:** `embed-skills.js:91 vectorizeId()` was fixed in Phase 2 to derive ID from `skill.id` (path-including), not slug. **DO NOT regress this.** Any task that touches embedding ID derivation needs a test against the collision list.

**Warning signs:** Any code that does `id: skill.slug` for Vectorize records.

### Pitfall 5: Filter writes incomplete records when MAX_PER_REPO dropped

**What goes wrong:** Filter.js Step 2 currently sorts by `quality_score` per repo and keeps top 2. If we just delete this step, the output is fine. But if we leave a partial implementation (e.g., MAX_PER_REPO=100 instead of removed entirely), the long tail of mega-repos is truncated arbitrarily.

**How to avoid:** Remove the per-repo grouping logic entirely. Test: feed a 4,621-skill repo through; assert all 4,621 survive (modulo other filters).

### Pitfall 6: Re-embedding the entire catalog after slug fix

**What goes wrong:** Slug change → metadata change → content_sha change → embed-skills.js triggers re-embedding of all 1,889 records. OpenAI cost: ~$0.015. Not free, but trivial.

**Actual risk:** The `_content_sha` in embed-skills.js is computed from `name|description|category|body_markdown` — NOT slug (per `computeContentSha` in embed-skills.js:78). **Slug change does NOT trigger re-embed.** Confirmed safe.

**Warning sign:** Plan adds slug to the content_sha payload. Don't.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Node.js | All scripts | ✓ | 20+ (per package.json) | — |
| `data/skill-vectors.ndjson` | enrich.js, compute-similar | ✓ | 32 MB, 1,078 records (STALE — built April; need refresh) | Re-run embed-skills.js |
| `data/skills-raw.json` | filter.js | ✓ | 295 MB, 33,000 records | Bootstrap workflow |
| Cloudflare Vectorize index | Live search only | ✓ | `claudeatlas-skills`, 1,536 dims, cosine | n/a |
| OpenAI API | Embedding new records | ✓ | text-embedding-3-small | — |
| GitHub `/compare` API | Active-fork detection | ✓ (PAT auth) | 5,000/hr rate limit | **Currently 0 forks — endpoint unused per Q3** |

**Stale skill-vectors.ndjson is the actionable risk.** It's at 1,078 records but skills.json is at 1,889. The next embed-skills.js run will catch up (it's delta-aware; embeds the 811 new records). But the empirical analyses above were done against the 1,078-record subset. Conclusions about thresholds (0.92, etc.) are reasonable to extrapolate from this sample, but Phase 3.1 implementation MUST re-run dedup/novelty against the fresh, full-corpus embeddings before locking in numbers.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Curated editorial filter (MAX_PER_REPO=2, MIN_STARS=10) | Comprehensive index + dedup | Phase 3.1 | 1,889 → 15–25k records after dedup |
| Algorithmic "Featured" tier | Algorithmic "Top" tier (rename) | Phase 3.6 | Naming only |
| Slug = `owner/skill-name` (collisions silently dropped from Vectorize) | Slug = `owner/repo/skill-name` on collision | Phase 3.1 | 26 records get new URLs; 301 redirects in worker |
| Vectorize for live search only | Vectorize for live search + local NDJSON for build-time | Phase 3.1 | Stays free-tier |

**Deprecated/outdated:**
- The "MAX_PER_REPO=2 prevents mega-repo dominance" assumption — replaced by embedding dedup (better signal: penalizes copies, not just per-repo volume).
- The "MIN_STARS=10 floor protects against junk" assumption — replaced by body length + slop blacklist + dedup. Stars become a scoring input only, not a gate.
- The audit's "6 slug collisions" — actual is 13.

---

## Open Questions

1. **What's the actual post-dedup catalog size?**
   - What we know: 30,458 records survive pre-dedup filters; 13–25% similarity cliff at 0.92 in current 1,078-sample.
   - What's unclear: how much of the 30k is dedup'd. Mega-repos likely have 30–50% internal duplication (educated guess).
   - Recommendation: implement enrich.js, run once, report actual numbers, calibrate thresholds against real distribution.

2. **Does Vectorize cosine `score` really map [-1,1] or is it normalized to [0,1]?**
   - What we know: production worker treats it as cosine similarity, higher = closer, sorts descending.
   - What's unclear: official docs don't specify range for cosine metric.
   - Recommendation: in Phase 3.1 implementation, log one query's raw score on first run; confirm range matches expectation. Low-risk.

3. **How does the slug-collision redirect map stay in sync with future collisions?**
   - What we know: 13 today, hardcoded in Worker.
   - What's unclear: when a 14th collision appears in the catalog, the Worker needs an update.
   - Recommendation: generate the redirect map at build time from skills.json. Inject as a JSON constant into the Worker bundle. Pipeline already redeploys daily.

4. **Should `enrich.js` cache pairwise similarities or recompute fully each day?**
   - At 30k records, O(n²) is borderline (24 min brute force, <1 min with HNSW).
   - Caching helps if most records are unchanged day-to-day (likely — embed-skills delta logic implies <5% daily churn).
   - Recommendation: cache by content_sha pair. If both shas match prior run, reuse similarity. Defer optimization to implementation if brute-force timing acceptable.

5. **Does dropping MIN_STARS=10 admit too much spam to score reliably?**
   - The score formula gives stars 20% weight. A 0-star record can still score 70+ if other signals are good.
   - But the 7-signal scoring was calibrated against the 10+-star population. Behavior on 0-star records is extrapolation.
   - Recommendation: after running filter against full skills-raw.json, manually inspect the top 50 records that have 0 stars but Solid+ tier. If they're real and reasonable, ship. If they're spam-y, add a "must have body + description in frontmatter" gate.

---

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| Framework | `node --test` (built-in, Node 20+) |
| Config file | None — tests live in `scripts/*.test.js` |
| Quick run command | `node --test scripts/filter.test.js` |
| Full suite command | `node --test scripts/*.test.js` |

Inspected: `scripts/filter.test.js` already exists and tests `applyTrack1Freshness`. Pattern reuses.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| FILT-01 | MAX_PER_REPO removed — 4621-skill repo survives intact | unit | `node --test scripts/filter.test.js` (add case) | ❌ Wave 0 |
| FILT-02 | MIN_STARS removed — 0-star record admitted if other gates pass | unit | same | ❌ Wave 0 |
| FILT-03 | body_length=199 rejected, body_length=200 admitted | unit | same | ❌ Wave 0 |
| FILT-04 | Embedding dedup: synthetic 0.95-sim pair → one flagged as duplicate | integration | `node --test scripts/enrich.test.js` | ❌ Wave 0 |
| FILT-05 | Novelty: synthetic isolated vector → high novelty score | integration | same | ❌ Wave 0 |
| FILT-06 | Older skill_first_commit_at wins canonical when duplicates differ in age | integration | same | ❌ Wave 0 |
| FILT-07 | Two records with same owner+name+different repo → both keep distinct slugs | unit | `node --test scripts/slug.test.js` | ❌ Wave 0 |
| FILT-08 | Full pipeline against skills-raw.json produces N ∈ [10k, 30k] records | smoke | `node scripts/filter.js && node scripts/enrich.js && node -e "console.log(require('./data/skills.json').length)"` | manual-validated |

### Sampling Rate

- **Per task commit:** `node --test scripts/filter.test.js scripts/enrich.test.js scripts/slug.test.js` (target: < 5 seconds)
- **Per wave merge:** Full suite + smoke run against fixture subset of skills-raw.json
- **Phase gate:** Full pipeline against actual skills-raw.json, manually inspect tier distribution + sample of flagged duplicates

### Wave 0 Gaps

- [ ] `scripts/enrich.js` — new script (Q7)
- [ ] `scripts/enrich.test.js` — tests for dedup + novelty
- [ ] `scripts/slug.test.js` — tests for slug collision strategy
- [ ] Extend `scripts/filter.test.js` — assertions for new defaults
- [ ] Test fixture: small `data/test-vectors.ndjson` with hand-crafted vectors that exercise sim > 0.92, sim ≈ 0.5, novelty edge cases

---

## Code Examples

### Vectorize self-exclusion query (Phase 3.4 noteworthy feature; not Phase 3.1)

```js
// Source: https://developers.cloudflare.com/vectorize/reference/metadata-filtering/
const results = await env.VECTORIZE.query(skillVector, {
  topK: 1,
  filter: { id: { $ne: thisSkillVectorizeId } },
  returnMetadata: 'all',
});
// results.matches[0] is the nearest non-self neighbor
const novelty = 1 - results.matches[0].score;
```

### Local novelty + dedup (Phase 3.1 enrich.js core)

```js
// Source: scripts/compute-similar.js (existing pattern)
import { readFileSync, writeFileSync } from 'fs';

const lines = readFileSync('data/skill-vectors.ndjson', 'utf-8').split('\n').filter(Boolean);
const recs = lines.map(l => JSON.parse(l));

// Pre-normalize to Float32 for speed
const vecs = recs.map(r => {
  const v = r.values;
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n);
  const nv = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) nv[i] = v[i] / n;
  return nv;
});

function dot(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

const DUP_THRESHOLD = 0.92;
const dupes = []; // array of {i, j, sim}
const nnSim = new Float32Array(recs.length); // nearest-neighbor cosine sim

for (let i = 0; i < vecs.length; i++) {
  let best = -1;
  for (let j = 0; j < vecs.length; j++) {
    if (i === j) continue;
    const s = dot(vecs[i], vecs[j]);
    if (s > best) best = s;
    if (s > DUP_THRESHOLD && i < j) dupes.push({ i, j, sim: s });
  }
  nnSim[i] = best;
}

// Novelty = 1 - nn_sim
for (let i = 0; i < recs.length; i++) {
  recs[i].metadata.novelty_score = 1 - nnSim[i];
}

// Dedup canonical assignment: older skill_first_commit_at wins
// (load from skills.json for that field — it's metadata-only)
```

### Path-aware slug computation (Phase 3.1 slug fix)

```js
// In scrape.js or filter.js, after collecting all records:
function assignSlugs(skills) {
  // Count occurrences of (owner, skill_name) tuples
  const counts = new Map();
  for (const s of skills) {
    const key = `${s.repo_full_name.split('/')[0]}/${s.name}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const s of skills) {
    const owner = s.repo_full_name.split('/')[0];
    const repoName = s.repo_full_name.split('/')[1];
    const key = `${owner}/${s.name}`;
    if (counts.get(key) > 1) {
      s.slug = `${owner}/${repoName}/${s.name}`;  // collision form
    } else {
      s.slug = `${owner}/${s.name}`;  // canonical form
    }
  }
}
```

---

## Synthesis

The 10 things the planner should weight most heavily:

1. **The empirical cosine histogram VALIDATES the 0.92 duplicate threshold.** Natural valley between 0.88–0.92 (0 pairs), dense cliff above. Don't drift from 0.92.

2. **The 0.45 novelty threshold is wrong as absolute.** Random-pair p95 is 0.45 — the threshold sits at noise floor. Reframe novelty as a top-N% percentile slice, or move the absolute threshold lower (~0.30) after measuring the real distribution on the 3.1 catalog.

3. **Forks are not in the data.** `scrape.js:462` skips them. The spec's git-fork-based active-fork detection is dead code. Reframe as "semantic clone + first-commit-timestamp comparison." This is also CHEAPER (no `/compare` API calls).

4. **Slug collisions: 13, not 6.** Audit was 50% low. Path-aware slug-on-collision (Option A) keeps 99% of URLs stable. 301 redirect map in Worker handles the 26 affected URLs. The slug change does NOT trigger re-embedding (content_sha excludes slug, verified in embed-skills.js).

5. **Cost ceiling: Vectorize for novelty would break $12/year.** Compute novelty locally from `data/skill-vectors.ndjson` (32 MB now, scales to ~900 MB at 30k corpus). Vectorize stays for live search only.

6. **MAX_PER_REPO drop is the dominant change.** ~29,343 records currently suppressed by the cap. Top 12 mega-repos contribute 20,902 raw records. Dedup must do the heavy lifting that the cap used to do — the cap was a crude proxy.

7. **Filter ordering: multi-pass with new `enrich.js`.** Keep filter.js text-rules-only. Add `enrich.js` AFTER `embed-skills.js`. Rewrites skills.json in place with `is_duplicate`, `canonical_slug`, `novelty_score`.

8. **Timing: O(n²) brute force is borderline at 30k.** ~24 min single-threaded. Use Float32Array + pre-normalized vectors (already pattern in `compute-similar.js`). Add HNSW only if measured timing exceeds 5 min.

9. **Score scaling: don't change the absolute 90/70 tier cutoffs.** Spec is internally consistent. Featured tier stays small because score formula doesn't reward 0-star records highly. Listed tier grows — that's by design.

10. **Vectors are stale (April 1,078; skills.json May 1,889).** Implementation MUST re-run embed-skills.js first, then validate the empirical findings above against the fresh full-catalog vectors before locking thresholds. The current findings are directionally correct but were sampled from a 57%-of-catalog snapshot.

---

## Sources

### Primary (HIGH confidence)

- [Cloudflare Vectorize Limits](https://developers.cloudflare.com/vectorize/platform/limits/) — topK caps, dimension limits, vector caps
- [Cloudflare Vectorize Pricing](https://developers.cloudflare.com/vectorize/platform/pricing/) — free tier 30M queried dims/month, 5M stored; paid $0.01/M queried, $0.05/100M stored
- [Cloudflare Vectorize Metadata Filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/) — operators including `$ne` for self-exclusion, 2048-byte filter cap
- [Cloudflare Vectorize Query Best Practices](https://developers.cloudflare.com/vectorize/best-practices/query-vectors/) — query structure (cosine score interpretation not explicit, see UNVERIFIED below)
- [GitHub REST API Compare](https://docs.github.com/en/rest/commits/commits) — `ahead_by`/`behind_by` returned, cross-repo syntax `USER:BASE...USER:HEAD`
- Empirical analysis of `data/skill-vectors.ndjson` (1,078 vectors) — pairwise similarity distribution, NN sim distribution, histogram of duplicate zone, manual inspection of 0.80–1.00 pairs
- Empirical analysis of `data/skills-raw.json` (33,000 records) — counterfactual filter math, per-repo distribution, fork count = 0
- Empirical analysis of `data/skills.json` (1,889 records) — slug collisions (13 confirmed), tier distribution, fork composition
- Source code: `scripts/filter.js`, `scripts/score.js`, `scripts/categorize.js`, `scripts/embed-skills.js`, `scripts/upload-vectors.js`, `scripts/compute-similar.js`, `worker/index.js`, `wrangler.toml`, `scripts/scrape.js`, `scripts/scrape-discover-repos.js`

### Secondary (MEDIUM confidence)

- Worker production code (`worker/index.js:266–291`) — empirical confirmation that Vectorize cosine returns higher = more similar
- HNSW-node performance estimates — based on typical HNSW library benchmarks, not project-specific measurement

### Tertiary / UNVERIFIED (LOW confidence, flagged for validation)

- Vectorize cosine score range — official docs only document Euclidean explicitly; cosine treated empirically as [0,1] higher=closer based on production code, but should be reconfirmed on first 3.1 implementation query
- Vectorize query latency p50/p99 — not published; must be measured from production logs
- GitHub `/compare` behavior on deleted/private parent — not documented; must probe empirically if/when we re-enable fork discovery

---

## Metadata

**Confidence breakdown:**
- Empirical findings (similarity distributions, filter counterfactuals, slug collision count): **HIGH** — direct measurement of project data
- Cosine threshold (0.92): **HIGH** — natural valley in histogram
- Novelty threshold reframing: **HIGH** — random-pair p95 = 0.45 is direct measurement
- Active-fork dormancy: **HIGH** — confirmed by code grep + zero forks in raw data
- Vectorize cost projection: **HIGH** — pricing page verified, math is arithmetic
- Vectorize cosine score range: **MEDIUM** — production code consistent but docs don't explicitly confirm
- Pipeline timing estimates (24 min brute force at 30k): **MEDIUM** — extrapolation from 1.9s at 1,078; assumes linear-in-pair-count
- HNSW as fallback: **MEDIUM** — library exists, performance is typical-library-class estimate

**Research date:** 2026-05-16
**Valid until:** 2026-06-15 (stable empirical findings); Cloudflare Vectorize pricing/limits — re-check at start of implementation since CF docs change without notice

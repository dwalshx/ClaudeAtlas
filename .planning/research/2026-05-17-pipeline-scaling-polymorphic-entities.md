# Research: Pipeline Scaling + Polymorphic Entity Model

**Researcher:** gsd-phase-researcher (Claude Opus 4.7)
**Date:** 2026-05-17
**For:** ClaudeAtlas v3.x foundation rethink (post-3.1 rollback)
**Status:** First-pass empirical research. Several sections flag MEDIUM/LOW confidence and propose measurement steps.

---

## TL;DR

Phase 3.1 didn't fail because the plan was wrong. It failed because **the entire pipeline was built around `readFileSync('utf-8') + JSON.parse + JSON.stringify` on monolithic JSON arrays**, and that pattern silently stops working once any one of the files crosses V8's ~536 MB single-string ceiling. That ceiling will be re-hit on at least three more sites at known growth rates, plus a fourth structural cliff (O(n²) enrich) at ~80–100k records.

The right response is **not** "add more streaming patches as files cross the ceiling." It's a **foundation phase** that (a) standardizes the on-disk format on streamable NDJSON for every dataset that can grow with corpus size, (b) replaces brute-force cosine with an ANN index (`hnswlib-node` is the right pick, with measurable caveats), and (c) introduces a **polymorphic entity envelope** so plugins / MCPs / frameworks / future-weirder-things share one pipeline rather than each cloning the skill stack.

**Do this in order:**

1. **Phase F1 — Streaming foundation (1–2 days).** Migrate `skills-raw.json`, `skills.json`, and any other monotonically-growing JSON-array file to NDJSON. Replace every `readFileSync('utf-8')` and `JSON.stringify(...)` over those files with streaming I/O. Touch `src/lib/skills.js`'s build-time loader to stream the new NDJSON. **No feature changes.** Land green. (4 known crash sites + ~3 latent + one structural — table in §A.)
2. **Phase F2 — Entity envelope (1–2 days, can run in parallel with F1).** Introduce one `EntityRecord` base shape with `entity_type` discriminator. Migrate `SkillRecord` to extend it. Plumb the type through filter / embed / enrich / build with no behavior change. Schema migration only. (§E proposes the shape.)
3. **Phase F3 — ANN replacement for enrich (1–2 days).** Drop `hnswlib-node` in behind a small adapter (so it's replaceable later). Verify it builds on `ubuntu-latest`. Hold the brute-force code path behind a feature flag for emergencies, then delete it once F3 is stable. (§D recommends `hnswlib-node` with prebuild-binary caveat.)
4. **Then resume 3.1's feature intent on the new foundation.** Filter-gate drop, dedup, novelty, slug fix. Cherry-pick the 5 isolated-good commits from `phase-3.1-archive`; rewrite the 4 that are obsolete after the foundation lands. (§G lists per-commit disposition.)
5. **Then 3.2 plugins.** Same scraper engine pattern, distinct discovery recipe. Plug into the unified pipeline by setting `entity_type: 'plugin'`.

**Hard constraints that change planning shape:**

- **Cloudflare Workers Free plan caps static assets at 20,000 files. Paid caps at 100,000.** ([changelog Sep 2025](https://developers.cloudflare.com/changelog/post/2025-09-02-increased-static-asset-limits/)) At the user's projected scale of 200k records with `/skills/[...slug]/` pages we **physically cannot** generate one HTML file per skill without going to Workers Paid AND restructuring routes. **Must be addressed in F1 or F2.** (§F has the math.)
- **Daily bot commit of a multi-megabyte file is fine. Daily bot commit of a multi-hundred-megabyte file is not.** At 50k+ skills, `data/skills.json` crosses 100 MB and the daily bot commit history bloats git fast. NDJSON doesn't fix this — it's a *transport-channel* problem. (§B has the consequence analysis.)
- **GitHub API budget is the binding constraint for plugin / MCP / framework discovery.** Track 1 + Track 2 already use 500–800 fresh req/hr daily. Adding two more entity scrapers requires the same content-sha-based skip pattern from 3.0.2 (Bug 1 fix) or it won't fit. (§E discusses.)

---

## A. V8 string-limit risk sites — full inventory

### How the ceiling works

V8's `String::kMaxLength` is `0x1fffffe8` = **~536,870,888 bytes (~512 MiB)** on 64-bit. Any operation that materializes a string longer than that crashes with `RangeError: Invalid string length`. The crash is deterministic at the byte-count crossing — there's no warning lead time. The 3.1 archive commits (`cf76247`, `6d74f64`, `82cc7ab`) all share the same root cause: a helper that *looks* normal but builds one giant string under the hood.

The danger pattern is any of:
1. `readFileSync(path, 'utf-8')` on a file > 512 MiB
2. `JSON.stringify(largeObject)` where the serialized form > 512 MiB
3. `array.map(JSON.stringify).join('\n')` where total > 512 MiB
4. `array.join('...')` over any large array where joined length > 512 MiB
5. `chunks.join('')` after collecting reads — same shape

### Inventory (HIGH confidence — read from current main HEAD)

Format: `file:line — pattern — file backing — current size — crash threshold — fix class`.

| Site | Pattern | File backing | Today | Crashes at | Fix class |
|------|---------|--------------|-------|-----------|-----------|
| `scripts/filter.js:233` | `JSON.parse(readFileSync(RAW_PATH,'utf-8'))` | `data/skills-raw.json` (JSON array) | ~295 MB | ~512 MB raw bytes (~50k records at 9 KB each = ~450 MB; soft margin) | **B-1**: Migrate file to NDJSON + streaming reader |
| `scripts/filter.js:348` | `writeFileSync(OUTPUT_PATH, JSON.stringify(capped, null, 2))` | `data/skills.json` (JSON array, pretty-printed × ~3 inflation) | ~4 MB at 1,885 records → ~10 MB at 5k → ~200 MB at 100k → ~400 MB at 200k | Pretty-print blows up 3×: ~170 MB serialized at 80k records crosses ceiling | **B-2**: Stop pretty-printing OR switch file to NDJSON. (NDJSON is the right answer.) |
| `scripts/filter.js:362` | `writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2))` | `data/pipeline-stats.json` | KB scale (a few stats fields) | Never (small struct) | **safe** — leave |
| `scripts/scrape.js:518` | `writeFileSync(SKILLS_PATH + '.partial', JSON.stringify(skills))` | `data/skills-raw.json.partial` (compact) | ~150 MB at last checkpoint (50k × 3 KB) | ~170k records | **B-1**: Stream partial writes via NDJSON append; checkpoint becomes "current file as-of-line-N" |
| `scripts/scrape.js:565` | `JSON.parse(readFileSync(SKILLS_PATH,'utf-8'))` in incremental merge | `data/skills-raw.json` | same as above | same as above | **B-1**: same fix |
| `scripts/scrape.js:576` | `writeFileSync(SKILLS_PATH, JSON.stringify(writeSkills, null, 2))` | `data/skills-raw.json` (JSON array, pretty) | ~295 MB now × 3 pretty-print inflation = ~900 MB serialized **already in the danger zone** | **probably already crashing on full=mode runs** — this is the most urgent one | **B-1**: NDJSON streaming write |
| `scripts/scrape.js:608` | `writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2))` | tiny stats | safe | safe | leave |
| `scripts/scrape-discover-repos.js:243` | `writeFileSync(RAW_PARTIAL_PATH, JSON.stringify(merged, null, 2))` | partial | identical concern to scrape.js:576 | **already in danger zone** | **B-1** |
| `scripts/scrape-discover-repos.js:252` | `JSON.parse(readFileSync(RAW_PATH,'utf-8'))` | skills-raw.json | same | same | **B-1** |
| `scripts/scrape-pulse.js:122` | `JSON.parse(readFileSync(SKILLS_PATH,'utf-8'))` reads `data/skills.json` | skills.json | as skills.json grows | ~80k records (per archive's enrich.js comment) | **B-2** |
| `scripts/scrape-pulse.js:180` | `writeFileSync(SKILLS_PATH, JSON.stringify(skills, null, 2))` | skills.json | same | same | **B-2** |
| `scripts/embed-skills.js:190` | `JSON.parse(readFileSync(SKILLS_PATH,'utf-8'))` | skills.json | follows B-2 | ~80k records | **B-2** |
| `scripts/embed-skills.js:123` | `readFileSync(OUTPUT_PATH,'utf-8').split('\n')` reads NDJSON vectors | `data/skill-vectors.ndjson` | **1.6 GB at 53,811 records (verified in commit 6d74f64)** | **ALREADY CRASHED on 3.1 attempt** — this is fixed on `phase-3.1-archive` (commit cf76247) but the fix is not on main | **A**: Cherry-pick streaming reader from `cf76247` |
| `scripts/embed-skills.js:217,253,289` | `kept.map(r=>JSON.stringify(r)).join('\n')` writes NDJSON | skill-vectors.ndjson | **at ~50k vectors** | **ALREADY CRASHED** | **A**: Cherry-pick streaming writer from `cf76247` |
| `scripts/compute-similar.js:69` | `readFileSync(VECTORS_PATH,'utf-8').split('\n')` | skill-vectors.ndjson | same as embed-skills:123 | same — at ~50k vectors | **A**: same fix pattern |
| `scripts/compute-similar.js:127` | `writeFileSync(OUTPUT_PATH, JSON.stringify(output))` | `data/similar-skills.json` (JSON object: ~slugs × top-5 entries) | At 50k skills with top-5 each → ~50k × ~500 bytes = ~25 MB → safe through 200k records | safe through any realistic v3 catalog | **safe** — leave |
| `scripts/compute-clusters.js:203` | `readFileSync(VECTORS_PATH,'utf-8').split('\n')` | vectors | same | same | **A** |
| `scripts/compute-clusters.js:207` | `JSON.parse(readFileSync(SKILLS_PATH,'utf-8'))` | skills.json | follows B-2 | ~80k records | **B-2** |
| `scripts/mine-apis.js:223` | `JSON.parse(readFileSync(SKILLS_PATH,'utf-8'))` | skills.json | follows B-2 | ~80k records | **B-2** |
| `scripts/generate-registry.js:42` | `JSON.parse(readFileSync(SKILLS_PATH,'utf-8'))` | skills.json | follows B-2 | ~80k records | **B-2** |
| `scripts/generate-registry.js:103` | `writeFileSync(OUTPUT_PATH, JSON.stringify(registry))` | `public/skills-registry.json` — compact JSON | At 200k entries × ~500 bytes = ~100 MB serialized | **safe through ~1M entries** if compact. **NOT safe if pretty-printed.** Currently compact (verified line 103). | **safe** — leave |
| `scripts/generate-marketplace.js:47, 117` | read skills.json, write marketplace (compact JSON) | same | as above | as above | **B-2** for read; write safe (compact, small) |
| `scripts/generate-badges.js:237` | read skills.json | same | as above | as above | **B-2** |
| `scripts/upload-vectors.js:101` | `readFileSync(NDJSON_PATH,'utf-8').split('\n')` | skill-vectors.ndjson | as above | ~50k vectors | **A** |
| `scripts/scrape-plugins.js:446` | `writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2))` | `data/plugins-raw.json` | 34 MB today; grows with plugin discovery (today ~1,700 repos; if it grows to 20k entries × ~5 KB pretty-printed × 3 = ~300 MB — danger zone in months) | ~30k entries | **B-3**: NDJSON-ify plugins-raw on Phase F2 as part of polymorphic envelope; same writer helper as B-1 |
| `scripts/backfill-skill-birth-dates.js:208` | `writeFileSync(SKILLS_PATH, JSON.stringify(skills))` | skills.json (compact) | as B-2 | ~170k records (compact, no pretty inflation) | **B-2** — script is one-shot, lower urgency, but uses same file |
| `scripts/backfill-star-history.js:261` | `writeFileSync(OUTPUT_PATH, JSON.stringify(finalOutput))` | `data/star-history.json` | KB-MB scale (only Featured-tier) | safe | leave |
| `worker/index.js:259` | Vectorize query in production | streamed result, never built into a single string | always safe | safe | safe |

**Fix classes:**

- **Class A:** Cherry-pick the existing streaming I/O helpers from `phase-3.1-archive` commits `cf76247` (embed-skills) and `6d74f64` (enrich). Add to `scripts/lib/ndjson.js` as `readNdjsonRecords(path)` and `writeNdjsonStreaming(path, records)`. Use everywhere a `.ndjson` file is read/written. **Low risk, high coverage.** ~10 sites collapse to two helpers.
- **Class B-1 (skills-raw.json migration):** Migrate this single file from JSON array to NDJSON. Touch every site that reads/writes it (scrape.js, scrape-discover-repos.js, filter.js read, bootstrap workflow). The release-asset bootstrap (`skills-raw-bootstrap`) needs to be regenerated as NDJSON, and the bootstrap workflow updated to expect NDJSON. The GHA cache layer is format-agnostic. **Medium risk** because the bootstrap pipeline has to be re-seeded carefully.
- **Class B-2 (skills.json migration):** Migrate from JSON array → NDJSON. **This is the one that touches `src/lib/skills.js`** — the Astro build-time loader. Astro's static-import path (`import skillsData from '../../data/skills.json'`) won't work with NDJSON; we'd switch to a build-time read using a streaming parser, OR load synchronously via the new lib helper. (See §B for the consequence analysis.)
- **Class B-3 (plugins-raw.json):** Same as B-1 but for plugins. Do it once when introducing the polymorphic envelope (§E) so we get one consistent NDJSON convention across all entity types.

### Latent sites that the inventory above doesn't catch

These deserve a separate look during F1 implementation:

- **`data/etag-cache.json` write** (`scripts/lib/github-fetch.js:144`): Already migrated to chunked write in commit `82cc7ab`. ✅ Verified safe. The flat-object chunk-write pattern there is reusable for any "many small entries" case where NDJSON is awkward.
- **`data/etag-cache.json` read** (`scripts/lib/github-fetch.js:120`): Still uses `readFileSync('utf-8')`. **At ~500 MB this is at the crash threshold.** Not yet crashed because the file shape happens to compress slightly in real-world runs, but it's a latent landmine. **Recommend: convert read to streaming JSON parser (stream-json) OR migrate etag-cache to NDJSON line-per-entry.** Stream-json parsing of the existing object shape is the lower-diff fix.
- **Any `astro build` step that pulls the whole skills.json into memory.** Astro static build now (since the [scaling blog post](https://astro.build/blog/experimental-static-build/)) renders pages in parallel chunks and is expected to handle 10k+ pages. But: it imports `skillsData` once at module load via the `import skillsData from '../../data/skills.json'` line in `src/lib/skills.js:9`. Vite resolves that JSON import at build time. **It is unverified whether Vite uses native JSON.parse (crashes >512 MB) or a streaming parser.** Assume crashes. (§B has the fix.)

### Code patterns that should be banned in future PRs

Add to `CLAUDE.md` under "Known issues":

```
PIPELINE FOOTGUNS (always use streaming alternatives):
- readFileSync(path, 'utf-8') on any data/*.json or data/*.ndjson
  → use scripts/lib/ndjson.js readNdjsonRecords() or stream-json
- JSON.stringify(arr, null, 2) on any array of >100 records
  → pretty-printing triples the size; use compact OR NDJSON
- arr.map(JSON.stringify).join('\n')
  → builds one giant string; use writeNdjsonStreaming()
- chunks.join('') after readSync loops
  → defeats the purpose of chunked reading
```

A lint rule (custom ESLint rule or simple grep in CI) that flags `readFileSync(*, 'utf-8')` on `data/` paths and `JSON.stringify(*, null, 2)` would prevent the next-five-quarters version of this category of bug.

---

## B. Format migration: JSON-array → NDJSON

The previous section's fix classes B-1, B-2, B-3 all migrate a JSON array file to NDJSON. This is the right pattern for **every monotonically-growing dataset**. It's the wrong pattern for **bounded structured data** (configuration, registries, the API graph). Decisions per file:

### `data/skills-raw.json` (B-1): MIGRATE TO NDJSON

| Concern | Disposition |
|---------|-------------|
| In-repo? | No — gitignored. Lives in GHA cache + release-asset bootstrap. |
| Migration cost | Convert the release-asset `skills-raw-bootstrap` to NDJSON. One workflow run via `bootstrap-skills-raw.yml`. Document the conversion in `.planning/runbooks/`. |
| Consumers | scrape.js (read+write), scrape-discover-repos.js (read+write), filter.js (read), parse-skill.js indirectly. ~6 call sites. |
| Diff readability for diffs | N/A — gitignored. |
| Release asset preservation | Keep both during transition: rename old to `skills-raw-bootstrap-jsonarray-2026-05-17` and treat as historical recovery only. |

**Recommendation: do it.** Confidence HIGH.

### `data/skills.json` (B-2): MIGRATE TO NDJSON — biggest blast radius

This is the load-bearing one. Tradeoffs:

| Concern | NDJSON | Keep JSON array |
|---------|--------|-----------------|
| **Git diff readability** | Line-per-record. Adding a skill = +1 line. Editing a field = full record rewrite on one line. Renaming a skill = -1/+1. **Better than current pretty-printed array** for daily bot commits because the bot rewrites the entire array every day → giant diff. NDJSON makes per-record changes visible as per-line diffs. | Currently pretty-printed → daily bot commits show field-level diffs but also touch every record (timestamp, recency-derived fields) → still a giant diff. Marginal advantage to NDJSON. |
| **Astro build-time loader (`src/lib/skills.js:9`)** | Static import broken. Switch to `const allSkills = readNdjsonRecords(path)` at module load. Astro / Vite tolerate this. **Risk:** Vite's JSON import path may have been doing tree-shaking or perf optimization that disappears; mitigation = wrap in a memoization. | Works as-is. **Risk:** Vite calling JSON.parse on a 200 MB string crashes the build at ~80k records. Unverified, assume crashes. |
| **GitHub UI rendering of file in PRs/blame** | Each record is one very long line. GitHub stops rendering files at 5 MB anyway; current pretty-printed skills.json already past that. No regression. | Same. |
| **Daily bot commit size** | Compact NDJSON ≈ 33–50% smaller than pretty-printed JSON. Still ~50–100 MB at 50k records. Git commit history grows fast. **At 200k records (~200 MB committed daily), git repo bloats by ~70 GB/year.** This is THE problem with committing the data at all at scale. NDJSON helps marginally but doesn't fix it. | Same problem, worse magnitude. |
| **Bootstrap on fresh clone / fresh CI runner** | NDJSON cached the same way. Bootstrap pattern reusable. | Same. |
| **Streaming consumers** | Natural fit. All readers and writers become streaming. | Awkward — every consumer has to know how to chunk-parse. |

**The brutal truth: at >50k records, committing `skills.json` daily is the wrong primitive.** NDJSON makes it less awful but doesn't fix the structural problem.

**Three options, ranked:**

1. **(recommended) Migrate skills.json to NDJSON AND move it from committed-to-main to a release asset.** Daily cron uploads new `data/skills.ndjson` to release asset `skills-latest`. CI build (Astro) fetches this asset at build time. Removes the daily bloat-the-git-history problem entirely. **Cost: one workflow change + one CI fetch step + one CDN cache invalidation step.** The build is no longer reproducible from a git SHA alone — you also need the matching release-asset SHA. Tradeoff acceptable because:
   - `skills.json` is *generated*, not source. Git is for source.
   - The release-asset pattern is already proven (etag-cache, skills-raw).
   - The site's daily build already depends on the daily cron — committing the data just creates the illusion of reproducibility.

2. Migrate to NDJSON but keep committing. Accept the git bloat. Buy time. **Don't recommend** because the bloat compounds — 70 GB/year of git history at 200k records.

3. Migrate to NDJSON committed via Git LFS. Adds LFS to repo. **Don't recommend** because (a) LFS on GitHub free tier has a 1 GB bandwidth/month cap that the daily Astro build would blow through, (b) LFS adds a moving part for contributors.

**Recommendation: Option 1 (release asset).** Confidence MEDIUM — the release-asset-as-build-input pattern works for skills-raw (bootstrap) but has never been used for site-build input; verify the daily-scrape workflow can publish + Astro build can fetch atomically in the same workflow run.

### `data/plugins-raw.json` (B-3): MIGRATE TO NDJSON

Easier than skills-raw because nothing on the site consumes it yet. Do it as part of F2 (polymorphic envelope) so we land one consistent NDJSON convention across all entity types. Confidence HIGH.

### `data/skill-vectors.ndjson`: ALREADY NDJSON ✅

Just needs the streaming reader/writer cherry-picked from `phase-3.1-archive` commit `cf76247`. Confidence HIGH.

### `data/similar-skills.json`, `data/api-graph.json`, `data/skill-clusters.json`: KEEP AS JSON

These are bounded by structure (top-5 neighbors, services × skills, k=16 clusters). Even at 200k records they stay under 50 MB. Don't migrate. Confidence HIGH.

### `data/pipeline-stats.json`: KEEP AS JSON

Tiny config-shaped data. Pretty-print is fine. Confidence HIGH.

### `data/history/YYYY-MM-DD.json`: KEEP AS JSON

One per day, ~225 KB each. Bounded by repo count (~3,000). Stays small. Confidence HIGH.

### `data/etag-cache.json`: CHUNKED-WRITE ALREADY DONE, ADD CHUNKED-READ

The write was patched in commit `82cc7ab`. The read still uses `readFileSync('utf-8')` and will crash at 500+ MB. **Add a streaming JSON-object reader.** Stream-json's `Parser` + `StreamObject` filter is the canonical pattern (see §C). Confidence MEDIUM — needs implementation work to verify.

---

## C. Streaming JSON parser libraries

For files we **don't** migrate to NDJSON but that may exceed 512 MB (etag-cache.json is the only one), survey:

| Library | Latest version | Weekly downloads (approx) | Maintenance | Notes |
|---------|---------------|---------------------------|-------------|-------|
| **`stream-json`** | 2.1.0 (published ~April 2026) | very high (millions/wk on npm; canonical) | Active — maintained by uhop | Apache-2.0. Mature, well-documented. SAX-style API; `StreamArray`/`StreamObject`/`Pick`/`Parser` composable. **Recommended for the etag-cache read.** ([npm](https://www.npmjs.com/package/stream-json), [github](https://github.com/uhop/stream-json)) |
| **`JSONStream`** | 1.3.5 (2018) | high but declining | Largely unmaintained — last release 2018 | Older API. Works but no recent activity. Skip in favor of stream-json. |
| **`@streamparser/json`** | active in 2026 | growing | Active | Modern alternative with TypeScript types and a more ergonomic API. Could substitute for stream-json. Worth a look during implementation but stream-json is the safer default. ([npm](https://www.npmjs.com/package/@streamparser/json)) |
| **`clarinet`** | older | low | Less active | SAX-style only, no convenience filters. Skip. |
| **`big-json`** | active | medium | Active | Backed by streamArray internally. Convenience wrapper. Adds dep without much value if we're using stream-json directly. Skip. |

**Recommendation:** Add `stream-json` as a dependency, use it for the etag-cache read (and for any future "bounded but large JSON object" cases). Use the in-tree `lib/ndjson.js` helpers (cherry-picked from `cf76247` / `6d74f64`) for all NDJSON I/O — no third-party dep needed.

Confidence: HIGH on stream-json choice (canonical, mature). MEDIUM on whether we actually need it in F1 vs. defer to F3 — depends on whether the etag-cache read is currently bumping the ceiling. **Action: instrument the etag-cache read in F1 to log file size at load and alert if > 400 MB.** Don't fix what's not breaking yet.

---

## D. ANN / HNSW for `enrich.js` (and beyond)

### The problem in numbers

- 53,811 records × 53,811 comparisons = **2.9 billion cosine ops** = ~70–90 min CPU on a single-core GHA runner. (Empirical from the archive run.)
- 100,000 records → **10 billion ops** = ~4–5 hours CPU on the same runner. Most of a 6-hour platform cap on its own.
- 200,000 records → **40 billion ops** = >12 hours. **Impossible on a single GHA runner.**

So `enrich.js` brute-force is good at 50k, marginal at 100k, broken at 200k. ANN is non-optional past 100k.

### Candidate libraries

| Library | Approach | Build on `ubuntu-latest` | Notes |
|---------|----------|--------------------------|-------|
| **`hnswlib-node` (v3.0.0)** | Native C++ addon via node-gyp | **NO prebuilt binaries** ([Issue #439](https://github.com/proffesor-for-testing/agentic-qe/issues/439) confirms via search). Compiles from source on install. Requires `build-essential` + Python on Ubuntu. **Works on ubuntu-latest with a `apt-get install build-essential` step**, which is already implicit in setup-node@v4 image. ([Issue #82, #176](https://github.com/yoshoku/hnswlib-node/issues/82) document Ubuntu install paths.) | Apache-2.0. Mature, well-known, the canonical Node binding to nmslib's HNSW. Last release ~2 years ago but stable. **Recommended primary.** |
| **`hnswlib-wasm`** | WASM-compiled HNSW | Cross-platform — no native compile step | ShravanSunder fork. Browser-friendly. Likely slower than native by 2–4×. Useful if CI build-tools become a problem. Backup option. |
| **`hnsw_lite` (darshandesai1095)** | Pure JS | No native step | Lightweight, but "lightweight" usually means "slow at 50k+." Untested at our scale. **Skip** unless `hnswlib-node` and `hnswlib-wasm` both fail. |
| **`faiss-node`** | Native binding to FAISS | Heavy (CMake, large binary) | Overkill for our scale. Skip. |
| **Cloudflare Vectorize for enrich (O(n) instead of O(n²))** | Cloud service | N/A | At 200k records, 200k queries × 1,536 dims = 307M queried dims/run. Free tier is 30M/month. Daily = 9.2B/month. Far exceeds free; on paid = $0.01/M × 9,200 ≈ **$92/month — blows the $12/year budget.** Stays a viable fallback only if we run enrich less than monthly. **Reject for daily use.** |
| **Local Annoy / faiss / NMSLIB via Python subprocess** | External | Adds Python runtime to CI image | Adds operational complexity. Skip. |

**Recommendation: `hnswlib-node` primary, `hnswlib-wasm` fallback if native build fails on the runner.** Wrap behind a small adapter interface (`buildIndex`, `queryNearest`) so either can be swapped without changing call sites. Confidence MEDIUM — we MUST verify the native build works on `ubuntu-latest` in a smoke CI step before committing to it. The build-stability evidence from search results is mixed: yes-it-works for most users, but multiple users have hit node-gyp errors. **Action for F3: minimal-repro install + index-build + index-query test on ubuntu-latest as the first task, gate the rest of F3 on its green outcome.**

### Architecture for the adapter

```
scripts/lib/ann-index.js
  export interface AnnIndex {
    add(id: string, vector: Float32Array): void
    build(): void
    queryNearest(vector: Float32Array, k: number): Array<{id, score}>
    save(path: string): void
    load(path: string): void
  }
  // hnswlib-node implementation
  // hnswlib-wasm implementation (behind feature flag for fallback)
```

`scripts/enrich.js` calls only the interface. Brute-force code stays under `--ann=brute` flag for emergency rollback. Defaults to `--ann=hnswlib`.

### Sanity-check on quality

HNSW is approximate. For dedup at threshold 0.92 we don't need exact nearest neighbor — we need to find ANY neighbor with sim > 0.92. HNSW's recall@k=10 with `ef_search=50` is empirically >99% on text embeddings ([Zilliz benchmarks](https://zilliz.com/learn/learn-hnswlib-graph-based-library-for-fast-anns)). Acceptable. For novelty (1 − max sim), we want the actual max. HNSW with `ef_search` cranked to 100 still has recall@1 > 99%. Acceptable for the percentile-based novelty gate (a few records mis-ranked doesn't move the top-5% threshold meaningfully).

---

## E. Polymorphic entity model

### What needs to be indexed (entity inventory)

| Entity type | Discovery signal | Current status | Notes |
|-------------|-----------------|----------------|-------|
| **Skill** | `filename:SKILL.md` GitHub code search | Live (1,885 indexed) | Done. |
| **Plugin** | `path:.claude-plugin filename:plugin.json` + `filename:marketplace.json` | Scraped (1,700 repos in `data/plugins-raw.json` — gitignored) | Manifest schema: requires `name`, `description`, `source`. Marketplace file points to plugins via source URLs. ([Anthropic docs](https://code.claude.com/docs/en/plugin-marketplaces)) |
| **MCP server** | Multiple signals: `dependencies` includes `@modelcontextprotocol/sdk`; presence of `claude_desktop_config.json` references; `.well-known/mcp.json` (SEP-2127 draft, not standard yet); `awesome-mcp-servers` aggregator. Official registry exists at `registry.modelcontextprotocol.io`. | Not scraped | Discovery is **heterogeneous**. Best primary source is probably the official registry API (low-cost, structured) + secondary GitHub search for repos that publish without registering. ([modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers), [official registry](https://registry.modelcontextprotocol.io/)) |
| **Agent framework / methodology** (Hermes, GSD, Org OS, BMAD) | Heterogeneous: README badge text ("Powered by GSD", "Built on Hermes"), repo topics (`agent-framework`, `claude-methodology`), npm package conventions, `.gsd/` `.objective/` `.hermes/` directory presence | Not scraped | **No standardized manifest exists.** Discovery is signal-based: a combination of file-system pattern matching + README parsing + repo topics. Has the highest false-positive risk; needs human curation gate for the first iteration. |
| **Slash command library** | `.claude/commands/*.md` directory present, multiple .md files inside | Not scraped | Similar to skills but discoverable as a directory pattern not a single file. Could be modeled as "skill collection with `type=commands`." |
| **Subagent collection** | `.claude/agents/*.md` | Not scraped | Same shape as commands. |
| **Hook collection** | `.claude/hooks/` or hooks.json | Not scraped | Same shape. |

The unifying observation: **most of these are "directories of files following a convention plus an optional manifest."** A single configurable discovery engine plus per-entity recipes can cover skills, plugins, command libs, subagent collections, hook collections, and MCP servers. Frameworks are the outlier — they're not directory shapes, they're "this repo orchestrates Claude in a specific way." Frameworks need a different discovery path (curated seed list + README signal detection) and probably a separate per-instance human review for the first batch.

### Proposed entity envelope

A single base shape with discriminated extensions:

```typescript
interface EntityRecord {
  // --- Identity (always present) ---
  id: string;                  // canonical unique id: `${entity_type}:${repo_full_name}/${path_within_repo}`
  entity_type: 'skill' | 'plugin' | 'mcp_server' | 'framework' | 'command_lib' | 'agent_lib' | 'hook_lib';
  slug: string;                // URL-safe, scoped by entity_type → `/{entity_type}s/{owner}/{name}/`
  name: string;
  description: string;

  // --- Repo metadata (always present — every entity lives in a repo) ---
  repo_full_name: string;
  repo_url: string;
  repo_stars: number;
  repo_forks: number;
  repo_open_issues: number;
  repo_topics: string[];
  repo_license: string | null;
  repo_language: string | null;
  repo_created_at: string;
  repo_updated_at: string;
  repo_pushed_at: string;
  repo_owner_type: 'Organization' | 'User';
  repo_owner_avatar: string;
  repo_archived: boolean;
  repo_is_fork: boolean;
  repo_description: string | null;

  // --- Content (entity-type-shaped, but every entity has SOME text) ---
  content: {
    body_markdown: string;      // first 5000 chars from primary content file
    body_length: number;
    // Free-form per-entity-type addenda go in `extra` to avoid migration churn
  };

  // --- Computed (filled by enrich.js) ---
  quality_score: number;       // 0-100, computed by per-entity-type scorer
  quality_tier: 'top' | 'solid' | 'indexed';   // post-3.6 naming
  novelty_score: number;       // 0-1 from embedding distance
  is_duplicate: boolean;
  canonical_id: string | null; // points to canonical EntityRecord.id if this is a dup
  category: string | null;     // OPTIONAL — only if classifier confidence > 0.8
  tags: string[];              // PREFERRED over category — multiple, free-form

  // --- Type-specific extensions (opaque to base pipeline) ---
  extra: SkillExtra | PluginExtra | McpExtra | FrameworkExtra | ...;

  // --- Lineage ---
  scraped_at: string;
  content_sha: string;         // for content-based skip-known
  source: string;              // 'code-search' | 'topics' | 'seed' | 'registry' | 'manual'
  discovery_signals: string[]; // which signals matched this entity
}

interface SkillExtra {
  type: 'skill';
  skill_path: string;
  frontmatter: Record<string, any>;
  has_name: boolean;
  has_description: boolean;
  skill_first_commit_at: string | null;
}

interface PluginExtra {
  type: 'plugin';
  manifest: { name; description; version; author; ... };
  components: { skills: number; agents: number; commands: number; hooks: number; mcp_servers: number; total: number };
  component_list: Array<{ type; name; path; description? }>;
  from_marketplace: string | null;
  install_command: string;
}

interface McpExtra {
  type: 'mcp_server';
  transport: 'stdio' | 'sse' | 'http';
  capabilities: string[];      // tools | resources | prompts
  registry_id: string | null;  // if registered with official registry
  install_command: string;
}

interface FrameworkExtra {
  type: 'framework';
  discovery_signals_detail: { readme_badge: boolean; repo_topic_match: string[]; directory_match: string[] };
  manual_curation_status: 'unreviewed' | 'approved' | 'rejected';  // first-iteration human gate
  install_instructions_url: string | null;
}
```

### Key design choices and why

| Choice | Why |
|--------|-----|
| **`category: optional` + `tags: required-array`** | The current 8-category taxonomy was strained at 1,885 skills. At polyglot 50k+ across multiple entity types, rigid taxonomy breaks. Tags are more honest: a plugin can be `["testing", "ci/cd", "github"]` without forcing a single category. Category becomes a *display convenience* derived from primary tag, not the data. |
| **`extra: <discriminated union>`** | Avoids forcing every entity to carry null fields for things that don't apply (`components.skills` on a SKILL entity, `frontmatter` on a plugin). Each entity-type extension is a separate TS type; consumers narrow by `entity_type`. **Alternative:** flat with optional fields — works for ~3 entity types, gets unwieldy at 7+. |
| **`id = "${entity_type}:${repo}/${path}"`** | Scopes id by entity type so the same repo can host skills + plugins without ID collisions. URL slug stays scoped by entity type (`/skills/owner/name`, `/plugins/owner/name`) for the same reason. |
| **`canonical_id` (not `canonical_slug`)** | Dedup may eventually cross entity types (a plugin that *is* a skill bundle, for instance). Pointing at id rather than slug allows cross-type canonical mapping. |
| **`discovery_signals: string[]`** | For audit. When a framework gets indexed because three signals matched, store *which three* so we can later improve heuristics. |
| **Per-entity-type scorer in F2, not foundation** | Quality score weights differ by entity type (a plugin's "manifest completeness" doesn't apply to a skill). Foundation just declares the shape; F2+ wires up `scoreSkill`, `scorePlugin`, etc. and selects by `entity_type`. |

### Scraper architecture

**One discovery engine, multiple recipes.**

```
scripts/scrape-engine.js          ← new: shared engine
  - takes a DiscoveryRecipe
  - runs the discovery phase (code search OR repo search OR registry pull)
  - delegates per-record parsing to recipe.parse()
  - emits EntityRecord stream to data/{entity_type}-raw.ndjson

scripts/recipes/
  skill.recipe.js                 ← existing scrape.js logic, refactored
  plugin.recipe.js                ← existing scrape-plugins.js logic, refactored
  mcp.recipe.js                   ← NEW: pulls from MCP registry + GitHub
  framework.recipe.js             ← NEW: curated seed + signal-based discovery
  command-lib.recipe.js           ← NEW
  agent-lib.recipe.js             ← NEW
```

A recipe is:

```typescript
interface DiscoveryRecipe {
  entity_type: EntityType;
  discover(): AsyncIterable<DiscoveryHit>;    // emits {repo, path, signals[]}
  parse(hit: DiscoveryHit): Promise<EntityRecord>;
  output_path: string;                         // data/{entity_type}-raw.ndjson
}
```

Downstream pipeline (filter, embed, enrich, build) is **entity-type-agnostic** — it operates on the EntityRecord shape. Per-entity-type logic injects via lookup tables keyed by `entity_type`:

```typescript
// scripts/lib/scorers.js
import { scoreSkill, scorePlugin, scoreMcp, scoreFramework } from './scorers/';
export const scorers = { skill: scoreSkill, plugin: scorePlugin, mcp_server: scoreMcp, framework: scoreFramework };
// scripts/filter.js
const score = scorers[record.entity_type](record);
```

This means **adding a new entity type later is**: write a recipe, write a scorer, register both. No filter/embed/enrich/build changes.

### Filter rules per entity type

Different entity types need different despam rules. Keep one `filter.js` engine; the rule packs live in per-entity files:

```
scripts/filter-rules/
  skill.rules.js     ← current isSlop() + min body length + frontmatter rules
  plugin.rules.js    ← manifest validity + min 1 component + name not in blacklist
  mcp.rules.js       ← transport specified + at least one capability
  framework.rules.js ← manual_curation_status === 'approved'
```

Filter loops once over all entities, dispatches by `entity_type`. Confidence HIGH on the architecture; MEDIUM on whether one filter.js stays manageable past 4 entity types — defer the split until it actually feels bad.

### Output structure: unified or per-type?

**Recommended: `data/entities.ndjson` is the source of truth.** Per-entity-type files (`data/skills.ndjson`, `data/plugins.ndjson`) become *views* generated at the same time for build-time efficiency. Reasoning:

- Mixed-type search (`/api/v1/search`) needs to query across types → wants unified store.
- Per-entity-type browse pages (`/skills/`, `/plugins/`) want pre-filtered views to avoid loading the whole catalog → wants partitioned files.
- Best-of-both: one source-of-truth NDJSON + a `partition-by-type.js` step in the build that emits per-type NDJSONs (and per-type registries) for the build.
- Vectorize stays one index — embeddings are entity-type-agnostic in vector space. Vectorize metadata carries `entity_type` for filtered queries.

### Categorization in a polymorphic world

The current 8-category system was already strained at skills. With plugins, MCPs, and frameworks added, categories break: "DevOps" is a skill category AND an MCP capability AND a framework focus. Force-fitting all entities into the same 8 categories collapses signal.

**Recommended:** keep `tags: string[]` as the primary classifier. Generate them from:
1. Frontmatter/manifest declared tags (when present)
2. Repo topics (always present)
3. Embedding cluster membership (already computed by compute-clusters.js — k=16 today, could grow)
4. Per-entity-type curated keyword lists (`scripts/filter-rules/{type}.tags.js`)

Display "category" pills on cards as the top-1 tag. Stop treating category as a structural field. Confidence MEDIUM — the right migration path depends on what the homepage redesign (3.5) actually needs; revisit when 3.5 is concretely planned.

### Search ranking across entity types

When `/api/v1/search?q=...` returns mixed-type results, naive ranking by quality_score is wrong because per-type quality scores aren't directly comparable (a plugin scored 85 isn't "better" than a skill scored 80 — they're on different rubrics).

**Recommended ranking formula:**

```
display_score = semantic_similarity * 0.7
              + (quality_tier == 'top' ? 0.2 : quality_tier == 'solid' ? 0.1 : 0)
              + small_boost_for_entity_type_relevance_to_query
```

That is: relevance dominates; quality tier (not raw score, normalized across types) is a secondary boost; entity-type relevance is a small re-rank (a query containing "plugin" boosts plugins; a query containing "MCP" boosts MCP servers). Confidence LOW — this needs an empirical eval on real queries during 3.5 planning. **Action: collect search query log via existing D1 logger; after a month, evaluate ranking on top 100 queries.**

### Embedding model fit for mixed types

`text-embedding-3-small` is general-purpose; it handles mixed-type content fine but might benefit from per-entity-type prompting. Today `embed-skills.js:106-114` builds the input as `name + description + category + body_markdown.slice(0, 1500)`. For an MCP server, "description + capabilities + readme excerpt" might score better. **Recommended:** keep the current "single embedder, type-aware input builder" pattern. Each entity type implements `buildEmbeddingInput(record)`. One vector space, one model. Confidence MEDIUM — vector space coherence across entity types is unverified empirically. Worth a measurement step in F2: embed 100 records of each type, eyeball cluster separation.

---

## F. Cloudflare infrastructure at scale

All numbers verified from official Cloudflare docs 2026-05-17. Cite-pages linked.

### Workers Static Assets

| Constraint | Free | Paid (Workers Paid plan) |
|------------|------|--------------------------|
| **Max files per Worker version** | **20,000** | **100,000** |
| Max individual file size | 25 MiB | 25 MiB |
| Total bundle size | not documented | not documented |
| Requests to static assets | unlimited + free | unlimited + free |

Sources: [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/), [Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [Sept 2025 changelog](https://developers.cloudflare.com/changelog/post/2025-09-02-increased-static-asset-limits/). Increase required Wrangler ≥ 4.34.0.

**Implications at projected scale:**

| Scale | `/skills/{owner}/{name}/` pages | Total static files (incl. `/category/`, `/creators/`, `/apis/`, assets, badges) | Free OK? | Paid OK? |
|-------|--------------------------------|----------------------------------------------------------------------------------|----------|----------|
| 1,885 (today) | 1,885 | ~3,000 | ✅ | ✅ |
| 5,000 | 5,000 | ~7,000 | ✅ | ✅ |
| 15,000 | 15,000 | ~18,000 | ✅ (margin) | ✅ |
| **20,000** | 20,000 | ~25,000 | **❌ hits cap** | ✅ |
| 50,000 | 50,000 | ~60,000 + plugins/mcps if rendered | ❌ | ✅ |
| **100,000** | 100,000 | ~115,000 | ❌ | **❌ hits cap** |
| 200,000 | 200,000 | ~230,000 | ❌ | ❌ |

**This is the hard architectural cliff.** Current static-page-per-record approach physically can't reach the user's 200k target on **either** plan tier.

**Three options to handle it, ranked by alignment with the project's static-site discipline:**

1. **(recommended) Pre-render only Top + Solid tier pages; serve Listed tier dynamically from the Worker.** At 200k catalog with ~5% Top, ~20% Solid → 50k pre-rendered pages. Fits in Paid plan with headroom. Listed-tier pages get served by `worker/index.js` which renders an HTML response on-demand from the same skills.ndjson stored in R2 or as a release-asset. Tradeoff: dynamic pages have higher latency than static (~50-100ms vs ~10ms) and consume Worker CPU time (still free at low volume). Acceptable for the "find via direct URL" path which is the Listed-tier user journey. **Most static-site-discipline-aligned option.**

2. **Render pages with pagination — one HTML page per N records, no per-record pages.** Browse by category → paginated list. Direct skill URLs become anchors on paginated pages, or query-string params handled by Worker. Loses per-skill SEO + clean URLs. **Worse for the discovery use case.** Reject.

3. **Switch from static prerender to full SSR on the Worker.** Workers Paid + Pages allows it. Throws away the project's static-site-discipline constraint. **Reject unless 200k scale is years away** (it might be) and we'd rather defer.

**Recommendation:** Plan for (1) but **don't implement it in the foundation phase.** Build for it: ensure `worker/index.js` already has the routing scaffold to handle `/skills/{slug}/` dynamically as a fallback. At ~15k catalog, do nothing. At ~18k catalog, start spending engineering on (1). At 20k Free cap, ship it. Currently at 1,885 → ~6 months of organic growth before urgency. Confidence HIGH on the architecture, MEDIUM on the timing forecast (depends entirely on filter-overhaul yield).

### Vectorize

| Constraint | Free | Paid |
|------------|------|------|
| Stored vector dimensions | 5M | first 10M included; $0.05 / 100M overage |
| Queried vector dimensions / month | 30M | first 50M included; $0.01 / M overage |
| Max topK (with metadata) | 50 | 50 |
| Max vectors per index | 10M | 10M |

Source: [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/), [Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/).

**Storage cost projection (per stored vectors × 1,536 dims):**

| Catalog | Stored dims | Free OK? | Paid cost |
|---------|-------------|----------|-----------|
| 3,255 (free tier ceiling) | 5M | ✅ | included |
| 6,510 (paid included ceiling) | 10M | ❌ | included |
| 50,000 | 76.8M | ❌ | ($66.8M / 100M) × $0.05 ≈ **$0.03/mo** |
| 200,000 | 307M | ❌ | ($297M / 100M) × $0.05 ≈ **$0.15/mo** |

**Vectorize storage is essentially free at any plausible scale.** $1.80/year at 200k vectors. Well within budget. ✅

**Query cost projection (per query × 1,536 dims):**

Current production load: estimated <100 search queries/day from real traffic, with KV cache likely cutting OpenAI embed cost (not Vectorize query cost) by ~50%. Vectorize is queried once per user search. At 100 queries/day × 30 days × 1,536 dims = 4.6M dims/month. **Comfortable in free tier today.** ✅

At 10× traffic growth (1,000 queries/day) → 46M dims/mo → exceeds 30M free → needs Paid plan ($5/mo) + 16M overage at $0.01/M = essentially $5/mo. **Workers Paid plan would be the binding cost line item, not Vectorize itself.**

**Don't run Vectorize for enrich-time novelty queries.** §D math: 200k vectors × monthly enrich = 307M dims = $92/mo on paid. Reject. Use local HNSW (§D).

### Workers KV (QUERY_CACHE)

| Constraint | Free | Paid |
|------------|------|------|
| Storage | 1 GB | unlimited |
| Reads/day | 100,000 | unlimited |
| Writes/day (different keys) | 1,000 | unlimited |
| Key size | 512 bytes | 512 bytes |
| Value size | 25 MiB | 25 MiB |

Source: [Workers KV limits](https://developers.cloudflare.com/kv/platform/limits/).

Current use: caching OpenAI query embeddings keyed by query-hash. At ~100 distinct queries/day → 100 writes/day → comfortably under 1,000 cap. Cache hit serves repeat queries from KV — at 1,000 queries/day with 50% repeat rate, that's 500 KV reads/day → comfortably under 100k cap. ✅

Doesn't scale with catalog size — scales with traffic. Stays free until ClaudeAtlas gets large user traffic. **No action.**

### D1 (search query log)

| Constraint | Free | Paid |
|------------|------|------|
| Rows read / day | 5,000,000 | first 25B/month included |
| Rows written / day | **100,000** | first 50M/month included |
| Storage per DB | 500 MB | 10 GB |
| Total storage | 5 GB | 1 TB |

Source: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

Current use: one row inserted per search query (debounced). At 100 queries/day = 100 writes/day → way under 100k/day cap. Reads are admin-only (dashboard inspection) → trivial. ✅

At 10× traffic (1,000/day) → 1,000 writes/day → fine. At 100× traffic (10,000/day) → 10k writes/day → fine. Free tier supports up to **100,000 search queries per day** — that's a massive amount of traffic. **No action — D1 is the most generous of the bindings.**

### Workers compute (the worker/index.js scripts)

Worker requests are billed per invocation + CPU time. The `[assets]` binding serves static files **without invoking the worker** for matched paths (returning the asset directly). Only `/api/log-search`, `/api/v1/search`, and Worker-routed dynamic paths consume Worker quota.

| Constraint | Free | Paid ($5/mo base) |
|------------|------|------|
| Requests/day | 100,000 | included 10M/mo |
| CPU time/request | 10ms | 50ms |
| Subrequests/request | 50 | 1,000 |

At current traffic (~100 searches/day) → ~100 Worker invocations/day → trivial. The `/api/log-search` adds another ~100/day. Total ~200/day vs 100k free cap. ✅

If we move to dynamic-page-rendering (option F.1 above) for Listed-tier pages, Worker request count rises with crawler + user direct-URL traffic. At 1,000 dynamic page views/day → still fine on Free. At 10,000 dynamic page views/day → still fine. Free Worker tier handles a *lot* of dynamic rendering. ✅

**Conclusion: the $12/yr cost ceiling holds at every projected scale up to 200k records.** The binding constraints are:
1. Static asset file count (20k Free / 100k Paid — see F.1 above)
2. Vectorize free-tier storage cap at 3,255 records — **already exceeded today**. Need to verify whether the live index is on paid (it likely is, costing ~$0.03/mo, but worth confirming via the Cloudflare dashboard before assuming).

**Action for F1:** Verify current Vectorize storage cost (should be <$1/mo). Document in CLAUDE.md.

---

## G. Recommended phase structure

### What "foundation phase" looks like

**Phase F (Foundation) — scope:** "Make the pipeline scale-safe to 200k records and entity-type-polymorphic. Zero user-visible behavior change. Plan-check the result against the 3.0.x silent-failure lens." Estimate: **5–8 days total** of focused work, splittable into 3 sub-phases that can partially overlap.

**Sub-phase F1 — Streaming foundation (2–3 days, must be first).** Touches the I/O layer.

| Task | Detail |
|------|--------|
| F1.T1 | Create `scripts/lib/ndjson.js` with `readNdjsonRecords()` and `writeNdjsonStreaming()`. Cherry-pick implementations from archive commits `cf76247` and `6d74f64`. |
| F1.T2 | Replace all NDJSON read/write sites with the helpers (embed-skills.js × 4 sites, compute-similar.js × 2, compute-clusters.js × 1, upload-vectors.js × 1, future enrich.js). |
| F1.T3 | Migrate `data/skills-raw.json` format JSON-array → NDJSON. Update scrape.js write site (3 places), scrape-discover-repos.js (2 places), filter.js read site (1 place). |
| F1.T4 | Regenerate the `skills-raw-bootstrap` release asset in NDJSON form. Update `bootstrap-skills-raw.yml` workflow. Keep old release asset as `skills-raw-bootstrap-legacy` for rollback. |
| F1.T5 | Migrate `data/skills.json` format JSON-array → NDJSON. Touch every reader (scripts/* × 6, src/lib/skills.js × 1). For src/lib/skills.js, replace `import skillsData` with `readNdjsonRecords()` call at module init. |
| F1.T6 | **Decide and implement the daily-bot-commit strategy**: Option 1 (move skills.json to release asset) is recommended. Alternative is keep committing NDJSON skills.json and accept the bloat for the next ~6 months. **Open decision — see Open Questions.** |
| F1.T7 | Add stream-json dep + chunked-read for etag-cache.json. (Or defer if size is still well below threshold — instrument first.) |
| F1.T8 | Add CI lint step that fails on `readFileSync(*, 'utf-8')` over `data/*.json` and `JSON.stringify(*, null, 2)` over `data/*.json`. Greppable and easy. |
| F1.T9 | Add `CLAUDE.md` "Pipeline footguns" section listing the banned patterns + the helpers to use. |
| F1.T10 | Plan-check this F1 against the 3.0.x lens: would the proposed change have caught each of the 9 historical bugs? Specifically: does it create new "silent-green-CI" landmines? |

**Sub-phase F2 — Entity envelope (2 days, can run partially in parallel with F1).**

| Task | Detail |
|------|--------|
| F2.T1 | Add `EntityRecord` TypeScript interface (or JSDoc) in `src/lib/types.js`. Document `entity_type` discriminator. |
| F2.T2 | Migrate existing `SkillRecord` to `EntityRecord<SkillExtra>` shape. Add `entity_type: 'skill'` to every existing record via a one-time `scripts/migrate-to-entities.js` script. This rewrites every record in skills.json/skills-raw.json — done after F1's NDJSON migration so the write is safe. |
| F2.T3 | Refactor `scripts/score.js`, `categorize.js` to dispatch by `entity_type`. Today there's only one type so behavior is identical; the dispatch table just makes adding plugin/MCP scorers a follow-on. |
| F2.T4 | Refactor `scripts/scrape.js` and `scrape-plugins.js` shapes toward the `DiscoveryRecipe` interface. Don't fully extract the engine yet — that's a heavier refactor than F is sized for. Just align the function signatures so a future engine extraction is mechanical. |
| F2.T5 | Update `src/lib/skills.js` to expose `getAllEntities()` (returns all types) and `getSkills()` (filters to `entity_type==='skill'`). Existing helpers stay skill-scoped for backward compat. |
| F2.T6 | Plan-check: would these changes have caught any of the 3.0.x bugs? Are there new silent-failure paths? |

**Sub-phase F3 — ANN replacement (2–3 days, MUST follow F1+F2).**

| Task | Detail |
|------|--------|
| F3.T1 | **Smoke task — gates everything else.** Add a temporary workflow that runs `npm install hnswlib-node` + builds + queries a small index on `ubuntu-latest`. Confirm native build works. If it fails, fall back to `hnswlib-wasm`. |
| F3.T2 | Implement `scripts/lib/ann-index.js` interface. Wrap `hnswlib-node`. |
| F3.T3 | Implement `scripts/enrich.js` (the script that crashed on archive). Use `lib/ann-index.js` for nearest-neighbor lookup. Brute-force code path stays under `--ann=brute` flag for emergency rollback. |
| F3.T4 | Persist HNSW index to disk between runs via `lib/ann-index.js.save()` + `lib/ann-index.js.load()`. Cache in GHA between runs. |
| F3.T5 | Performance verification: enrich must complete in <5 min at current 1,885 corpus; <20 min at projected 50k corpus; <90 min at projected 200k corpus. |
| F3.T6 | Plan-check: did we just add a different silent-failure shape (recall@1 < 100% on the ANN — does that matter for the dedup threshold)? |

### Then resume 3.1's product intent on the new foundation

**Phase 3.1-new — Filter overhaul, redux (~3 days).** Now backed by F-foundation:

- Drop `MAX_PER_REPO` + `MIN_STARS` gates (same as archived 3.1).
- Add embedding-based dedup at 0.92 (using F3's ANN — fast at any catalog size).
- Compute novelty (percentile-based — top 5%).
- Fix 13 slug collisions (cherry-pick from `phase-3.1-archive` — `92a6417`, `f4dfb56`, `ec31b3a`, `18111a4`).
- Spec corrections (cherry-pick `3b0c94f`).
- Site-side dedup filter (cherry-pick `bf7dcec`).
- Recalibration audit.

**Cherry-pick disposition from `phase-3.1-archive` (15 commits):**

| Commit | Disposition | Why |
|--------|-------------|-----|
| `92a6417` `feat(3.1): add assignSlugs() helper` | **Cherry-pick as-is** | Pure helper, no dependency on the failed pipeline shape. |
| `f4dfb56` `refactor(3.1): drop MAX_PER_REPO + MIN_STARS, lower body=200, slug fix, placeholders` | **Rewrite** | The placeholder-field part needs the F2 EntityRecord shape; the gate-drop and body-length change cherry-pick cleanly. Split into two commits. |
| `18111a4` `feat(3.1): seed data/slug-redirects.json (empty skeleton)` | **Cherry-pick as-is** | Empty skeleton. Trivial. |
| `6c966be` `feat(3.1): add scripts/enrich.js` | **Rewrite** | Original calls brute-force loop. New version calls `lib/ann-index.js` (built in F3). Logic identical otherwise. |
| `ec31b3a` `feat(3.1): 301 redirect for pre-fix colliding slug URLs` | **Cherry-pick as-is** | Worker change, independent of pipeline shape. |
| `93855a8` `ci(3.1): insert Enrich step` | **Cherry-pick with minor edit** | Same step, but timing budget changes (ANN is faster). |
| `3b0c94f` `docs(3.1): correct novelty + active-fork specs in PHASE-3.0-SPEC` | **Cherry-pick as-is** | Spec correction, independent of pipeline. |
| `bf7dcec` `feat(3.1): filter is_duplicate=true from default browse helpers` | **Cherry-pick as-is** | src/lib/skills.js change, independent. After F1's NDJSON migration of skills.json, this is still valid. |
| `dc8e4c2` `docs(3.1): update SkillRecord interface and add enrich.js known issue` | **Rewrite** | The interface update is now `EntityRecord<SkillExtra>` from F2. |
| `77824c7` `docs(3.1): local recalibration audit` | **Re-run** | Audit was for the failed run; re-run with the new foundation. |
| `85c3f1c` `chore(state): mark Phase 03.1 executing at Task 10 checkpoint` | **Discard** | State chore, no value. |
| `cf76247` `fix(3.1): embed-skills.js streaming I/O` | **Cherry-pick in F1.T1/T2** | This becomes the canonical streaming helper. Repurposed. |
| `5b04b87` `ci(3.1): cache skill-vectors NDJSON + bump timeout` | **Cherry-pick the cache step; discard the timeout bump** | Cache is good; timeout bump (300 min) is the wrong band-aid — F3's ANN means we don't need it. |
| `6d74f64` `fix(3.1): enrich.js streaming NDJSON read — V8 redux` | **Cherry-pick in F1.T1/T2** | Same canonical streaming helper. Already merged with cf76247's helper. |
| `57691a7` `chore(planning): rename 3.x phase dirs to padded form` | **Cherry-pick if still needed** | Pure planning artifact. Disposition: confirm whether gsd-tools still requires padding; if yes, take it. |

### Then 3.2 plugins (~2 days on top of foundation)

- Write `scripts/recipes/plugin.recipe.js` (mostly cherry-picked from existing `scrape-plugins.js`).
- Write `scripts/scorers/plugin.scorer.js` (per the v3.0 spec's rubric — calibrate against `data/plugins-raw.json`).
- Write `scripts/filter-rules/plugin.rules.js`.
- Tie into the pipeline by setting `entity_type: 'plugin'` on plugin discovery output.
- Add `/plugins/` + `/plugins/[slug]/` routes (separate Astro pages, but `entities.ndjson` is the data source).

### Then 3.3+ as originally specified, with adjustments

The v3.0 spec's 9-sub-phase structure (3.1 filter overhaul, 3.2 plugin scoring, 3.3 plugin pages, 3.4 new&noteworthy, 3.5 homepage, 3.6 tier rename, 3.7 pipeline integration, 3.8 cross-entity, 3.9 trends) is mostly still valid. Adjustments after foundation:

- **3.7 (Pipeline integration)** becomes trivial — foundation already unified pipeline. Can be folded into 3.2.
- **3.8 (Cross-entity enrichment)** becomes trivial — foundation made everything cross-entity by default. Can be folded into 3.5.
- **3.4 "New & Noteworthy"** uses the same per-type or cross-type novelty depending on what 3.5 needs.
- **3.6 (Tier rename)** is no-op against the new schema if F2 already names tiers `top/solid/indexed`. Recommend baking that into F2.

### Recommendation summary (TL;DR for the prompt)

| Phase | Scope | Effort | Prereqs |
|-------|-------|--------|---------|
| **F1** | Streaming foundation + NDJSON migration | 2–3 days | None — go first |
| **F2** | Polymorphic entity envelope | 2 days | F1 partially (can overlap after F1.T2) |
| **F3** | ANN-backed enrich | 2–3 days | F1 + F2 complete |
| **3.1-new** | Filter overhaul + dedup + novelty + slug fix | 3 days | F1+F2+F3 done |
| **3.2** | Plugin entity wired in | 2 days | F2 done; 3.1-new for tier names |
| **3.3** | Plugin pages | 2 days | 3.2 done |
| **3.4** | New & Noteworthy | 2 days | 3.1-new (novelty exists) |
| **3.5** | Homepage redesign | 3 days | 3.3 (plugins exist to feature) |
| **3.6** | Tier rename (mostly no-op after F2) | 1 day | F2 done |
| **3.7** | (folded into 3.2) | — | — |
| **3.8** | (folded into 3.5) | — | — |
| **3.9** | /trends page | 2 days | After ~30 days of compounding daily snapshots |
| **future** | MCP entity, framework entity | 3–4 days each | Foundation done |

**Total to "v3.0 mostly done": ~22 days of focused work** spread across however many sessions. **Foundation alone is ~6–8 days and unblocks everything else.** Confidence MEDIUM on effort estimates (these always overrun); HIGH on the *ordering* (foundation must precede feature work, full stop).

---

## Open questions for the user

### Q1. `data/skills.json` distribution model — commit or release-asset?

**Tradeoff:**
- **Commit (current pattern):** Reproducible from git SHA. Bot commits visible in history. Site can be rebuilt from any commit.
- **Release asset (recommended at scale):** Git stays light. Bot publishes a daily-tagged asset. Site build pulls asset by tag. **Build is no longer reproducible from git alone** — needs git SHA + release tag.

At current 1,885 records this is moot. At 50k+ records it's binding. **Decision needed by F1.T5 / F1.T6.** Defer if catalog growth from 3.1-new looks like it'll stay under 15k → option to revisit when it crosses.

### Q2. How aggressive to be on the polymorphic envelope in foundation?

**Spectrum:**
- **Minimal:** F2 adds the `entity_type` discriminator and TypeScript types. Existing fields stay where they are. Per-type extras live in a flat namespace. Mechanical migration only.
- **Full:** F2 reshapes to `EntityRecord` + `extra` discriminated union. Existing readers need to learn the new shape. More upfront cost; less downstream churn when adding plugins/MCPs.

Recommendation: **minimal first** (just add `entity_type` field + type registry). Reshape opportunistically as 3.2 plugin work touches the schema. **Decision needed by F2 plan.**

### Q3. Frameworks (Hermes, GSD, Org OS, BMAD) — distinct entity type or "skill collection"?

The user explicitly called these out as needing first-class support. But they're qualitatively different from skills/plugins/MCPs:

- **Skills/plugins/MCPs are *artifacts***. You install them, they do a thing.
- **Frameworks are *methodologies***. You don't install GSD, you *adopt* it. Its discovery signal is "a project uses this approach" not "this repo IS the thing."

Options:
- **Treat as entity_type='framework'** with `extra.manual_curation_status` gating display. First batch is human-curated from a short seed list (~20 frameworks). Discovery automation comes later as a phase-4+ project.
- **Treat as a tag** on existing entities — a SKILL.md can be tagged `framework:gsd`, a plugin can be tagged `framework:bmad`. The framework page is `/tags/framework-gsd/` showing every artifact that adopts it. No distinct entity type.

Recommendation: **the latter (tag-based) for v3.0.** Framework-as-entity-type is a 6+ month effort and the user can experiment with the tag-based version in weeks. Revisit framework-as-entity-type if real users start asking for it. **Decision needed before F2.**

### Q4. Plugin scraper local diff — disposition?

The uncommitted `scripts/scrape-plugins.js` defensive-null-safety diff (`.planning/MORNING-SCRAPE-PLUGINS-MEMO.md`) is strictly safer than the original. Foundation work will touch this file anyway. **Recommend: commit before starting F2, so plugin recipe extraction starts from the safe baseline.** Trivial decision but worth flagging.

### Q5. Should the foundation phase plan-check be run by a different agent / fresh context?

The 3.0.x lesson was that plan-check caught silent failures the planner missed. The 3.1 plan-check caught two BLOCKERs before execution. For a foundation phase that ~6 months of work depends on, an extra round of "find the silent failure" review — by a fresh-context Claude agent or by the user — is cheap insurance. **Recommend: yes, mandatory plan-check before F1 starts execution, separately for F1/F2/F3.**

### Q6. v3.0 spec doc — archive, restructure, or rewrite?

`docs/PHASE-3.0-SPEC.md` is the BEFORE picture. After foundation, much of it is wrong or rearranged:
- "Plugin entity type" assumption stands but the way it's wired changes.
- "Tier rename" becomes a no-op if F2 bakes new names in.
- "Pipeline integration" becomes a no-op.
- Several "data/plugins.json" file paths become "data/entities.ndjson with entity_type filter."

Recommend: **rewrite as `docs/v3-MILESTONE.md` after F2 lands**, archive the old spec to `docs/archive/PHASE-3.0-SPEC-original.md` for history. Confidence HIGH on the recommendation; LOW on timing.

---

## Sources

### Cloudflare docs (verified 2026-05-17)

- [Cloudflare Workers Static Assets — billing & limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [Cloudflare Workers — platform limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare changelog — Sept 2025 static asset limits increase](https://developers.cloudflare.com/changelog/post/2025-09-02-increased-static-asset-limits/)
- [Cloudflare Vectorize — pricing](https://developers.cloudflare.com/vectorize/platform/pricing/)
- [Cloudflare Vectorize — limits](https://developers.cloudflare.com/vectorize/platform/limits/)
- [Cloudflare KV — limits](https://developers.cloudflare.com/kv/platform/limits/)
- [Cloudflare D1 — pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cloudflare D1 — limits](https://developers.cloudflare.com/d1/platform/limits/)

### Libraries

- [stream-json on npm](https://www.npmjs.com/package/stream-json) — latest 2.1.0, active, canonical
- [stream-json on GitHub](https://github.com/uhop/stream-json)
- [@streamparser/json on npm](https://www.npmjs.com/package/@streamparser/json) — modern alternative
- [hnswlib-node on npm](https://www.npmjs.com/package/hnswlib-node) — v3.0.0, native addon, no prebuilds
- [hnswlib-node on GitHub](https://github.com/yoshoku/hnswlib-node)
- [hnswlib-node Issue #176 — install problems](https://github.com/yoshoku/hnswlib-node/issues/176)
- [hnswlib-node Issue #82 — install with npm](https://github.com/yoshoku/hnswlib-node/issues/82)
- [hnswlib-node Windows install note (Issue #439 ext)](https://github.com/proffesor-for-testing/agentic-qe/issues/439) confirms no prebuilds
- [hnswlib-wasm on npm](https://www.npmjs.com/package/hnswlib-wasm) — WASM fallback

### Anthropic / Claude plugin / MCP

- [Claude Code Plugin Marketplace docs](https://code.claude.com/docs/en/plugin-marketplaces)
- [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- [anthropics/claude-code](https://github.com/anthropics/claude-code)
- [Official MCP Registry](https://registry.modelcontextprotocol.io/)
- [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)
- [MCP SEP-2127 — well-known discovery](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127)
- [wong2/awesome-mcp-servers](https://github.com/wong2/awesome-mcp-servers)

### Astro

- [Scaling Astro to 10000+ pages](https://astro.build/blog/experimental-static-build/)
- [Astro docs — getStaticPaths reference](https://docs.astro.build/en/reference/errors/get-static-paths-required/)
- [Astro docs — content collections](https://docs.astro.build/en/guides/content-collections/)

### Project internal (this repo)

- `CLAUDE.md` — project overview, current known issues, GitHub API facts section
- `.planning/SESSION-MEMO-2026-04-to-05.md` — five-week infrastructure trilogy retro; "pattern-of-patterns" section is the lens this research applied
- `.planning/STATE.md` — current state as of 2026-05-17
- `.planning/ROADMAP.md` — milestone tree
- `docs/PHASE-3.0-SPEC.md` — v3.0 milestone spec (the BEFORE picture)
- `.planning/phases/3.1-filter-overhaul/3.1-PLAN.md` — abandoned 3.1 plan (Rev 2 PASS)
- `.planning/phases/3.1-filter-overhaul/3.1-PLAN-CHECK.md` — plan-check that caught 2 blockers + 4 flags
- `.planning/phases/3.1-filter-overhaul/RESEARCH.md` — empirical findings (0.92 cosine threshold validated, etc.)
- Git history: archive commits `92a6417`, `f4dfb56`, `18111a4`, `6c966be`, `ec31b3a`, `93855a8`, `3b0c94f`, `bf7dcec`, `dc8e4c2`, `77824c7`, `85c3f1c`, `cf76247`, `5b04b87`, `6d74f64`, `57691a7` on branch `phase-3.1-archive` — each disposition noted in §G
- Git history: commit `82cc7ab` on main — etag-cache chunked-write pattern, reusable

### Confidence summary

| Section | Confidence | Why |
|---------|------------|-----|
| §A inventory | HIGH | Read directly from current `main` HEAD via Grep; commit messages corroborate |
| §B NDJSON migration | MEDIUM | Architecture HIGH; Astro/Vite consequence MEDIUM (untested); release-asset-as-build-input MEDIUM (new pattern) |
| §C streaming JSON | HIGH | stream-json is canonical |
| §D ANN | MEDIUM | hnswlib-node likely works on ubuntu-latest but UNVERIFIED in this CI environment; recommend smoke task first |
| §E entity envelope | MEDIUM | Architecture HIGH; specific schema choices may need iteration once plugin/MCP work surfaces real-world shape mismatches |
| §F Cloudflare scale | HIGH | All numbers from official 2026 docs; quoted |
| §G phase structure | MEDIUM | Ordering HIGH; effort estimates always overrun |

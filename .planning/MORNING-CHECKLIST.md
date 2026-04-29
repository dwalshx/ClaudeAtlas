# Morning Checklist — 2026-04-30

Phase 3.0.1 implementation shipped overnight. **Daily pipeline rewrite is on `main`; release asset uploaded; awaiting your verification.**

**TL;DR:** ~3 commands to run, ~30-40 min of watching CI, then 3.0.1 is done and 3.1 unblocks.

---

## What landed overnight

**8 commits on `main` (`82cc7ab` → `2687277`):**
1. `82cc7ab` saveETagCache uses chunked sync writes (V8 string limit fix from earlier session)
2. `551f6f0` incremental skips already-known IDs (earlier patch)
3. `7ae2756` ci(3.0.0): disable Track 2 + filter pending Phase 3.0.1 (stopgap)
4. `c5addca` refactor(3.0.1): deprecate `--mode=incremental` (replaced by repo-search)
5. `65cc23c` feat(3.0.1): filter.js graceful fallback for missing skills-raw.json
6. `366c47e` feat(3.0.1): scrape-discover-repos.js (Track 2 via repo search) — the architecturally correct discovery
7. `a1eeb87` ci(3.0.1): bootstrap-skills-raw.yml workflow
8. `5e6dbd8` feat(3.0.1): smoke harness + 10-repo seed
9. `bc7ed77` ci(3.0.1): re-enable Track 2 + Filter + skills-raw cache in daily
10. `b641ae1` ci(3.0.1): re-enable weekly Sunday cron + docs updates (CLAUDE.md + ARCHITECTURE.md)
11. `2c…` chore(planning): commit phase artifacts + 2026-04-25 history snapshot
12. `2687277` data: persist Saturday's local Track 1 + filter run output

**Release asset created:** `skills-raw-bootstrap` at https://github.com/dwalshx/ClaudeAtlas/releases/tag/skills-raw-bootstrap. 295 MB of `data/skills-raw.json` uploaded. This seeds the new GHA cache for skills-raw — same pattern as `etag-cache-bootstrap` from earlier this week.

**Doc updates:** `CLAUDE.md` corrected (GHA 10 GB cap removed Nov 2025; 304s don't count against rate limit; code search supported qualifier list; `'discover'` added to source union; smoke seed annual review note). `ARCHITECTURE.md` extended with skills-raw cache architecture section.

**Audit finding:** zero downstream consumers actually filter on the `.source` field across `embed-skills.js`, `compute-similar.js`, `categorize.js`, `score.js`, `filter.js`. Adding `'discover'` is fully safe — no follow-up gaps.

---

## 🔴 Step 1 — Bootstrap the GHA cache (one-time, ~2 min)

This seeds GitHub Actions cache with the 295 MB `skills-raw.json` from the release asset. Without this, the first daily/weekly run has no skills-raw to skip-against and would re-discover the entire corpus.

```powershell
gh workflow run bootstrap-skills-raw.yml
```

Wait ~5 sec, then:

```powershell
gh run watch
```

(Pick the `bootstrap-skills-raw` run when prompted.)

**Expect** all steps green in <2 min. Final step echoes the cache key (`skills-raw-bootstrap-N`) which the daily/weekly workflows' restore-keys (`skills-raw-`) will pick up.

---

## 🟡 Step 2 — Trigger the new daily-scrape (~20-30 min)

This is the actual production validation. The new pipeline: Track 1 (Star Pulse) → Track 2 via repo search → Save caches → Filter → Embed → Upload → Build → Deploy → Health → Commit.

```powershell
gh workflow run daily-scrape.yml
gh run watch
```

**Expect:**

| Step | Expected timing |
|---|---|
| Restore ETag cache | hit `etag-cache-bootstrap-1` (or newer); ~10 sec |
| Restore skills-raw cache | hit `skills-raw-bootstrap-N` from Step 1; ~10 sec |
| Run Track 1 (Star Pulse) | ~3-5 min |
| Run Track 2 (Discovery via repo search) | ~5-15 min — should log topic search results, candidate count, parse count |
| Save skills-raw cache | green (✓) |
| Save ETag cache | green (✓) |
| Filter | output: `R3 merge: applied Track 1 freshness + re-scored N skills` |
| Embed / Upload / Build / Deploy | ~3-5 min total |
| Health check | HTTP 200 |
| Commit skills data | new bot commit on main with `data/history/2026-04-30.json` |

**Total target: <30 min.**

If it goes green: Phase 3.0.1 is done. Reply "approved" and I'll mark it complete in STATE.md and ROADMAP.md.

---

## 🟢 Step 3 — Cleanup (after Step 2 succeeds)

```powershell
git pull
ls data/history/ | Measure-Object | Select-Object -ExpandProperty Count
```

**Expect ≥3** snapshot files (April 11, April 25, April 30 at minimum) — proves the commit-back chain works end-to-end.

---

## What to do if something fails

### If bootstrap workflow (Step 1) fails

- Check the run logs via `gh run view --log-failed`
- Common cause: release asset missing (verify at https://github.com/dwalshx/ClaudeAtlas/releases/tag/skills-raw-bootstrap)
- If asset is missing, re-upload locally:
  ```powershell
  gh release upload skills-raw-bootstrap "data/skills-raw.json" --clobber
  ```

### If daily-scrape (Step 2) fails

The stopgap from `7ae2756` is essentially what the prior runs were doing. If 3.0.1's new architecture breaks, you can revert to the Track-1-only stopgap:

```powershell
git revert HEAD~9..HEAD --no-commit  # adjust range to cover the 3.0.1 commits
git commit -m "revert: roll back Phase 3.0.1, return to 3.0.0 stopgap"
git push
```

But please don't do that without telling me — I'd rather diagnose the new issue and ship a 3.0.2 fix than discard the work.

### If Track 2 hits unexpected behavior

Most likely culprits given research findings:
- Topic search returns 0 results → topic name typo (check `scripts/scrape-discover-repos.js` topic list)
- Tree fetch errors on archived repos → check the archived/fork skip logic
- Atomic-merge fails on Windows path → CI is Ubuntu, shouldn't happen; if it does, fall back to non-atomic write

Paste any error and I'll route through `/gsd:debug` or `/gsd:plan-phase --gaps`.

---

## Carryover from prior session (still pending — no time tonight)

These were on the prior morning checklist and didn't get touched:

- [ ] **KV namespace activation** — `wrangler kv:namespace create QUERY_CACHE`, paste id into wrangler.toml, deploy. ~5 min. See [`MORNING-CHECKLIST-KV-MEMO.md`](./MORNING-CHECKLIST-KV-MEMO.md) (or just look at the placeholder at `wrangler.toml:46`).
- [ ] **Sign off `scripts/scrape-plugins.js` uncommitted diff** — see [`MORNING-SCRAPE-PLUGINS-MEMO.md`](./MORNING-SCRAPE-PLUGINS-MEMO.md)
- [ ] **Sign off plugins-raw.json gitignore** — see [`MORNING-PLUGINS-RAW-MEMO.md`](./MORNING-PLUGINS-RAW-MEMO.md) (already gitignored; just confirming)

These can wait until after 3.0.1 verifies green.

---

## What's next after 3.0.1 verifies

`/gsd:execute-phase 3.1` — filter overhaul. Drops MAX_PER_REPO and MIN_STARS gates, adds embedding-based dedup, adds novelty scoring, recalibrates against fresh skills-raw.json. Estimated 4-6 hours.

The 1.5.2 slug collision fix rolls into 3.1 naturally per the audit YELLOW disposition.

Sleep well. The autonomous portion shipped without burning your network or CI. See you in the morning.

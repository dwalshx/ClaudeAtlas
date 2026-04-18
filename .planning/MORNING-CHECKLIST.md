# Morning Checklist — 2026-04-18

Overnight housekeeping ran while you slept. Here's everything you need to touch before invoking `/gsd:new-milestone` for Phase 3.0.

**TL;DR:** Cron still hasn't recovered after f7d293d (no new history snapshots). That's the one thing that might need real investigation. Everything else is 5-minute sign-offs.

---

## 🔴 Critical: cron recovery has NOT happened

**Evidence:**
- Today is 2026-04-18. Fix `f7d293d` pushed 2026-04-14.
- Expected: snapshots for 4/15, 4/16, 4/17 at least (4/18 run not yet fired at 06:30 UTC).
- Actual: `data/history/` still contains only `2026-04-11.json`. No new data commits on origin/main since `f7d293d`.

**What this means:** Either
1. The scheduled trigger isn't firing at all (possible if GitHub auto-disabled the workflow despite recent push activity — unlikely but possible)
2. The fix didn't work — scrape is still timing out AND the `if: always()` save step isn't persisting the cache
3. Runs ARE succeeding but the commit/push step is failing silently (push masked by `|| true`)

### To investigate

```bash
# If gh is authed locally:
gh run list --workflow=daily-scrape.yml --limit 10
gh run list --workflow=daily-scrape.yml --event=schedule --limit 5
gh run view <most-recent-scheduled-run-id> --log-failed

# Otherwise check in the browser:
# https://github.com/dwalshx/ClaudeAtlas/actions/workflows/daily-scrape.yml
```

### If runs are not firing

Hit "Run workflow" in the UI to trigger a manual dispatch and watch the logs. If the UI shows the workflow is disabled, re-enable it.

### If runs are timing out again

The fix at `f7d293d` split `actions/cache@v4` into restore + save-with-`if: always()`. Verify:
- Does the "Save ETag cache" step appear in the run log?
- Does it show as completed (not skipped)?
- If skipped: the `if: always()` condition isn't matching as expected — probably a YAML syntax issue.
- If completed but cache is still empty on next run: cache key mismatch or namespace issue.

### If runs succeed but don't commit

Check the "Commit skills data" step logs. Common causes: SCRAPE_PAT lacks `contents:write`, branch protection blocking bot pushes.

### Resume debug session if needed

```
/gsd:debug
```
→ select the existing `daily-cron-stalled` session and resume with the new evidence.

---

## 🟡 Quick sign-offs (5 minutes each)

### 1. Sign off on `scripts/scrape-plugins.js` disposition

Read: [`.planning/MORNING-SCRAPE-PLUGINS-MEMO.md`](./MORNING-SCRAPE-PLUGINS-MEMO.md)

**Recommendation:** commit it (defensive null-safety fix).

**Action:**
```bash
git add scripts/scrape-plugins.js
git commit -m "fix(scrape-plugins): null-safe marketplace_manifest unpacking"
git push
```

---

### 2. Sign off on `data/plugins-raw.json` gitignore

Read: [`.planning/MORNING-PLUGINS-RAW-MEMO.md`](./MORNING-PLUGINS-RAW-MEMO.md)

**Recommendation:** keep as gitignored (mirrors skills-raw.json treatment).

**Action:** None if you agree — .gitignore change was included in the overnight commit. If you want it committed instead, see memo for rollback.

---

### 3. Activate Cloudflare KV namespace for query cache (Phase 2.2 closure)

This fixes a roadmap-vs-reality discrepancy: Phase 2.2 is marked `[x]` but the binding is placeholder-only. Activating it gives ~500ms of search latency back on repeat queries.

**Pre-requisite:** wrangler CLI authenticated on this machine. If not:
```bash
wrangler login
```

**Steps:**

1. Create the namespace:
   ```bash
   wrangler kv:namespace create QUERY_CACHE
   ```
   Expected output:
   ```
   🌀  Creating namespace with title "claudeatlas-QUERY_CACHE"
   ✨  Success!
   Add the following to your configuration file:
   kv_namespaces = [
     { binding = "QUERY_CACHE", id = "a1b2c3d4e5f6..." }
   ]
   ```

2. Copy the `id` value.

3. Open `wrangler.toml` — the binding is already uncommented at lines 43-46 with a `REPLACE_WITH_NAMESPACE_ID` placeholder. Paste the real id:
   ```toml
   [[kv_namespaces]]
   binding = "QUERY_CACHE"
   id = "a1b2c3d4e5f6..."  # ← paste here
   ```

4. Deploy:
   ```bash
   npx wrangler deploy
   ```

5. Verify — do a couple of searches on https://claudeatlas.com. The first should be ~1.5s, subsequent identical queries should drop to ~500ms. (Or check CF Workers analytics for KV hit rate.)

6. Commit the wrangler.toml change:
   ```bash
   git add wrangler.toml
   git commit -m "feat(kv): activate QUERY_CACHE namespace for search embeddings"
   git push
   ```

---

## ✅ Done overnight (for your awareness)

1. **Codebase map written** — `.planning/codebase/` with 7 docs (STACK, INTEGRATIONS, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, CONCERNS). 1,428 lines.
2. **1.5 + v2.0 integration audit** — `.planning/VERIFICATION-1.5-v2.0.md`. Verdict: YELLOW. 136 lines.
3. **STATE.md reconciled** — now reflects 14 completed phases; pre-3.0 housekeeping noted; 3.0 readiness notes added.
4. **`.gitignore` updated** — plugins-raw.json + scrape-plugins-resume.log now ignored.
5. **wrangler.toml edited** — KV binding uncommented with placeholder (committed for visibility; safe because Cloudflare will reject deploy with a placeholder ID before it breaks anything).
6. **Three memos written** — this one + scrape-plugins + plugins-raw.
7. **Debug session preserved** — `.planning/debug/daily-cron-stalled.md` still open, awaiting `confirmed fixed` marker.

---

## Once all the above are green, kick off Phase 3.0

```
/gsd:new-milestone
```

Milestone input: see `docs/PHASE-3.0-SPEC.md`. Target: 9 sub-phases (3.1–3.9), ~20-30 hours across 3-5 sessions. Start with 3.1 (filter overhaul).

Key calibration reminders for 3.0:
- Novelty thresholds (0.45, 0.15 in spec) are placeholders — plot distribution, pick percentile cutoffs
- Use Vectorize ANN queries for similarity, not brute-force O(n²)
- Slug collision fix (1.5.2, 6 live dupes) rolls into 3.1/3.2 filter overhaul
- compute-clusters.js orphan decision at kickoff (wire to prebuild or delete)

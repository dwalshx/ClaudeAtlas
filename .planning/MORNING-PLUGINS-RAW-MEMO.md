# Morning memo — `data/plugins-raw.json` tracking policy

**Authored:** 2026-04-18 overnight
**Decision needed by:** You, in the morning
**Recommendation:** **gitignore it** (already done — sign off or revert)

---

## Facts

- **File size:** 34 MB (plus 20 MB `.partial` checkpoint)
- **Source:** produced by `scripts/scrape-plugins.js` (one-off research scrape, 2026-04-13)
- **Consumers in `src/`:** **zero.** `grep -rn "plugins-raw" src/` returns nothing.
- **Producers/writers:** only `scripts/scrape-plugins.js`
- **Currently in git:** untracked (confirmed via `git status`)
- **Mirror treatment for skills:** `data/skills-raw.json` (~8 MB) IS gitignored — the committed artifact is the filtered `data/skills.json` (~4 MB).

## Decision

Follow the skills pattern: gitignore the raw output, commit only the filtered/scored artifact. For plugins, that means:

- `data/plugins-raw.json` → **gitignored** (rebuilt on each scrape)
- `data/plugins.json` → **committed** (once Phase 3.0 3.2 `filter-plugins.js` ships)
- `data/plugins-raw.json.partial` → already gitignored (checkpoint)
- `scripts/scrape-plugins-resume.log` → adding to gitignore too (large log file, was untracked)

## What I did overnight

Updated `.gitignore` to add:

```gitignore
# Plugin scraper intermediate + raw output files
# Raw output is ~34 MB and gets rebuilt on each scrape. Filtered/scored
# data/plugins.json will be committed once Phase 3.0 filter-plugins.js ships.
data/plugins-raw.json
data/plugins-raw.json.partial
scripts/scrape-plugins.log
scripts/scrape-plugins-resume.log
```

(First two lines were already there — removed duplicates and consolidated.)

## Rationale

1. **Consistency** — skills pipeline treats raw the same way.
2. **Repo hygiene** — 34 MB JSON in git is a burden on every clone.
3. **Reproducibility** — the scraper is idempotent. The raw data is not canonical; the filtered output is.
4. **Phase 3.0 readiness** — 3.2 will produce `data/plugins.json` as the committed artifact. Tracking the raw in parallel serves no purpose.

## Rollback if you disagree

If you want `plugins-raw.json` committed for research/debugging convenience:

```bash
git checkout .gitignore  # revert the gitignore change
git add data/plugins-raw.json
git commit -m "data: commit raw plugin scrape output"
```

But I'd argue against — if you want to preserve the current snapshot, a GitHub Release asset or an S3/R2 upload is a better home than the git repo.

## Sign-off

If you agree, no action needed — the gitignore change is already staged for commit. If you want the file committed anyway, follow the rollback steps.

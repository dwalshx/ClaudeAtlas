---
phase: quick-260804-dy2
plan: 01
subsystem: pipeline / daily-scrape reliability
tags: [embed, drift-guard, ci, notifications, github-actions]
requires:
  - scripts/embed-skills.js (existing embedder + invokedAsScript import guard)
  - .github/workflows/daily-scrape.yml (scrape-build-deploy job)
provides:
  - shouldBailOnDrift() prior-overlap drift decision (exported, unit-tested)
  - notify-on-failure job (deduped cron-failure Issue + optional webhook)
affects:
  - daily-scrape embed step (no longer false-positive-aborts on growth/cold-seed)
  - daily-scrape failure visibility (was silent)
tech-stack:
  added: []
  patterns:
    - "pure exported helper + node:test unit coverage (mirrors filter.test.js)"
    - "optional-secret gated in-script (never in a step-level if:) to keep the workflow valid"
key-files:
  created:
    - scripts/embed-skills.test.js
  modified:
    - scripts/embed-skills.js
    - .github/workflows/daily-scrape.yml
decisions:
  - "Drift signal = prior-overlap (matchedFromPrior/priorCount), not overall hit rate (kept/records)"
  - "PRIOR_MATCH_BAIL_THRESHOLD=0.5 (majority-miss = drift); MIN_PRIOR_FOR_DRIFT_CHECK=50 (below = meaningless, proceed)"
  - "Webhook gated via in-script empty-check + continue-on-error, NOT a step-level if: (secrets context is illegal there and would invalidate the whole file)"
metrics:
  duration: ~15m
  tasks: 2
  files: 3
  completed: 2026-08-04
---

# Phase quick-260804-dy2 Plan 01: Harden daily-scrape (embed drift-guard + notify-on-failure) Summary

Two independent, purely-additive daily-scrape reliability fixes: re-based the
embed drift guard on prior-overlap so healthy catalog-growth and cold-seed runs
stop spuriously aborting, and added a `notify-on-failure` job so a failed cron
run raises a deduped GitHub Issue (plus an optional webhook) instead of going
silent.

## What shipped

### FIX A — embed drift guard on prior-overlap (T1)

The old guard bailed on overall cache hit rate (`kept.length / records.length`),
which false-positives every time the catalog grows or the GHA vector cache is
cold-seeded (e.g. a 1,078-vector seed against ~50k current records → ~2% hit →
spurious "DRIFT DETECTED" abort). The correct signal is: did the PRIOR vectors
stop matching current records? Growth (lots of NEW records with nothing prior
to match) is not drift.

New exported drift-guard decision code (`scripts/embed-skills.js`):

```js
export const MIN_PRIOR_FOR_DRIFT_CHECK = 50;
export const PRIOR_MATCH_BAIL_THRESHOLD = 0.5;
export function shouldBailOnDrift({ priorCount, matchedFromPrior, forced }) {
  if (forced) return false;
  if (!priorCount || priorCount < MIN_PRIOR_FOR_DRIFT_CHECK) return false;
  const priorMatchRate = matchedFromPrior / priorCount;
  return priorMatchRate < PRIOR_MATCH_BAIL_THRESHOLD;
}
```

Replacement guard block in `main()` (kept.length === matchedFromPrior, since
`prior` is keyed by unique skill_id and each rec.id is unique):

```js
const FORCE_REEMBED = process.env.EMBED_FORCE_REEMBED === '1';
if (prior.size > 0 && records.length > 0) {
  // kept.length === matchedFromPrior: `prior` is keyed by unique skill_id and
  // each current rec.id is unique, so at most one prior vector is consumed per
  // kept record → the count of reused priors equals kept.length.
  const matchedFromPrior = kept.length;
  const priorMatchRate = matchedFromPrior / prior.size;
  log(`prior-overlap: ${(priorMatchRate * 100).toFixed(2)}% of prior vectors still match (${matchedFromPrior}/${prior.size} prior; ${kept.length}/${records.length} current kept)`);
  if (shouldBailOnDrift({ priorCount: prior.size, matchedFromPrior, forced: FORCE_REEMBED })) {
    console.error(
      `[embed-skills] DRIFT DETECTED: only ${(priorMatchRate * 100).toFixed(2)}% of the ` +
      `${prior.size} PRIOR vectors in ${outputPath} still match a current record by content_sha.\n` +
      `A majority-miss means buildEmbeddingInput()/content_sha diverged from the logic that\n` +
      `produced those vectors — proceeding would silently re-embed the whole catalog.\n` +
      `(NOTE: catalog GROWTH and cold-seed caches do NOT trip this guard anymore — only true drift does.)\n` +
      `Cost of proceeding: a full re-embed of ${records.length} records.\n` +
      `Bailing out. Re-run with EMBED_FORCE_REEMBED=1 to override.`,
    );
    process.exit(1);
  }
}
```

`EMBED_FORCE_REEMBED=1` override preserved; all cost/log lines preserved; the
kept/todo partition, `loadPriorVectors`, `computeContentSha`, the embed loop,
and NDJSON read/write are untouched (F1 streaming discipline intact).

### FIX B — notify-on-failure job (T2)

Two additions to `.github/workflows/daily-scrape.yml`: `issues: write` on the
existing `scrape-build-deploy` permissions block (`contents: write` kept), and a
new sibling job. The success path is byte-for-byte unchanged — the diff is 63
insertions, 0 deletions.

New job YAML:

```yaml
  notify-on-failure:
    needs: scrape-build-deploy
    if: failure()
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
    steps:
      - name: Push webhook alert (optional)
        continue-on-error: true
        env:
          ALERT_WEBHOOK_URL: ${{ secrets.ALERT_WEBHOOK_URL }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: |
          [ -n "$ALERT_WEBHOOK_URL" ] || { echo "no webhook configured; skipping"; exit 0; }
          curl -sS -X POST -H 'Content-Type: application/json' \
            -d "{\"content\": \"ClaudeAtlas daily-scrape FAILED — $RUN_URL\"}" \
            "$ALERT_WEBHOOK_URL" || true

      - name: Open or update cron-failure issue
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          REPO: ${{ github.repository }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: |
          set -euo pipefail
          gh label create cron-failure --color B60205 \
            --description "Automated daily-scrape failure" 2>/dev/null || true
          DATE=$(date -u +%Y-%m-%d)
          BODY="daily-scrape run failed on ${DATE} (UTC).\n\nFailed run: ${RUN_URL}"
          EXISTING=$(gh issue list --repo "$REPO" --label cron-failure \
            --state open --json number --jq '.[0].number // empty')
          if [ -n "$EXISTING" ]; then
            printf '%b' "New failure: ${DATE}\n\n${RUN_URL}" \
              | gh issue comment "$EXISTING" --repo "$REPO" --body-file -
            echo "Commented existing cron-failure issue #$EXISTING"
          else
            printf '%b' "$BODY" \
              | gh issue create --repo "$REPO" --label cron-failure \
                --title "daily-scrape failed (${DATE})" --body-file -
            echo "Created new cron-failure issue"
          fi
```

Critical detail: the webhook step has NO step-level `if:`. The `secrets` context
is illegal in a step `if:` and would invalidate the entire workflow file (no
jobs, including the success path, would run). Instead the secret arrives via
`env:`, the step is `continue-on-error: true`, and the `run:` script early-exits
when the secret is unset — so a broken/absent webhook can never mask the real
failure or block the issue step.

## Verification

**T1** — `node --test scripts/embed-skills.test.js`:

```
ok 1 - Test A: catalog growth / cold-seed with high prior-overlap PROCEEDS
ok 2 - Test B: real drift BAILS, but forced=true overrides
ok 3 - Test C: tiny / empty prior set PROCEEDS (no spurious bail)
ok 4 - exported thresholds match the documented choices
# tests 4
# pass 4
# fail 0
```

`npm run check:patterns`:

```
[check-banned-patterns] lint mode: clean (0 baselined, 0 new)
```

**T2** — js-yaml parse + guard assertions:

```
YAML OK: notify-on-failure gated on needs+failure(), issues:write present, no step if: references secrets.
```

`grep -nE '^\s*if:.*secrets\.' .github/workflows/daily-scrape.yml` → returns
nothing (no step-level `if:` references the secrets context). `git diff --stat`
of the workflow: 63 insertions, 0 deletions — the success path (every
scrape-build-deploy step) is byte-for-byte unchanged aside from the added
`issues: write` permission.

## Deviations from Plan

None — plan executed exactly as written. TDD RED→GREEN followed for T1 (failing
test committed first, then implementation); no REFACTOR needed.

## Known Stubs

None. Both fixes are complete and self-contained. `ALERT_WEBHOOK_URL` is an
optional GitHub Actions secret — when unset the webhook step self-skips and the
GitHub Issue path (zero-setup, uses the built-in `GITHUB_TOKEN`) is the operative
notifier.

## Commits

- `de4b651` test(quick-260804-dy2): add failing tests for shouldBailOnDrift drift guard
- `5a218a2` feat(quick-260804-dy2): re-base embed drift guard on prior-overlap
- `589b9b7` feat(quick-260804-dy2): notify-on-failure job for daily-scrape

## Self-Check: PASSED

- FOUND: scripts/embed-skills.test.js
- FOUND: scripts/embed-skills.js (shouldBailOnDrift + thresholds exported)
- FOUND: .github/workflows/daily-scrape.yml (notify-on-failure job)
- FOUND commit: de4b651 (test)
- FOUND commit: 5a218a2 (FIX A)
- FOUND commit: 589b9b7 (FIX B)

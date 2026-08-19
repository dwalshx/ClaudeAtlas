---
phase: quick-260818-ohb
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/snapshot-traffic.js
  - scripts/check-banned-patterns.js
  - .github/workflows/daily-scrape.yml
  - .gitignore
autonomous: true
requirements: [OHB-01, OHB-02, OHB-03]
must_haves:
  truths:
    - "Running `node --env-file=.env scripts/snapshot-traffic.js` writes data/traffic-snapshot.json with one row per UTC calendar day (2026-08-07 → 2026-08-18)"
    - "Any failure (missing env, fetch error, non-success D1 response) leaves the existing file untouched and exits 0 (never breaks the cron)"
    - "The daily-scrape cron runs the snapshot after enrich and commits data/traffic-snapshot.json back to main"
    - "`npm run check:patterns` is clean and `npm test` count is unchanged"
  artifacts:
    - path: "scripts/snapshot-traffic.js"
      provides: "D1 request_log → per-day time-series aggregator"
      min_lines: 120
    - path: "data/traffic-snapshot.json"
      provides: "committed 11-12 day traffic time series"
      contains: "days"
  key_links:
    - from: "scripts/snapshot-traffic.js"
      to: "Cloudflare D1 /query REST endpoint"
      via: "global fetch, Bearer CF_API_TOKEN"
      pattern: "d1/database/.*?/query"
    - from: ".github/workflows/daily-scrape.yml"
      to: "scripts/snapshot-traffic.js"
      via: "cron step + git add"
      pattern: "snapshot-traffic"
---

<objective>
Build a daily traffic-analytics snapshot pipeline: a read-only aggregator that
rolls up the D1 `request_log` table into a small committed per-day time-series
file `data/traffic-snapshot.json`, wired into the daily cron with a first-run
backfill of existing history (2026-08-07 → 2026-08-18).

Purpose: accumulate a 14-day traffic trend for an upcoming report and seed the
future public fingerprint feed. This mirrors the existing `snapshot-catalog.js`
sidecar pattern (quick-260804-d5p) but reads D1 instead of the catalog NDJSON.

Output: `scripts/snapshot-traffic.js`, cron integration in `daily-scrape.yml`,
lint allowlist entry, and the first committed `data/traffic-snapshot.json`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@CLAUDE.md

<interfaces>
<!-- Executor: use these directly. No codebase exploration needed. -->

# D1 REST pattern — copied from scripts/apply-d1-schema.js (reuse verbatim):
DATABASE_ID = 'd4e341fa-17d6-4069-8a00-3b6a8d698ab9'   // claudeatlas-search-log
QUERY_URL   = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`

async function d1Query(sql) {
  const res = await fetch(QUERY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${CF_API_TOKEN}` },
    body: JSON.stringify({ sql }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.success === false) {
    const detail = json && json.errors ? JSON.stringify(json.errors) : `HTTP ${res.status}`;
    throw new Error(`D1 query failed: ${detail}`);
  }
  return json;
}
# ROW EXTRACTION: a SELECT returns rows at `json.result[0].results` (array of
# plain objects keyed by the SELECT's output column names/aliases).

# request_log columns in play (worker/schema.sql):
#   timestamp INTEGER   -- MILLISECONDS (Date.now()); day = strftime('%Y-%m-%d', timestamp/1000, 'unixepoch')
#   path TEXT           -- pathname only (no query string)
#   status INTEGER
#   class TEXT          -- human | agent | crawler | automated_unknown | impersonation_suspected | unknown
#   operator TEXT       -- e.g. 'bytedance','openai','anthropic','ahrefs' (nullable)
#   classifier_method TEXT  -- token_echo|mcp|ua_list|ua_asn_mismatch|no_ua|coherent_datacenter|coherence|default
#   wba_status TEXT     -- verified | failed | present_unverified | absent
#   wba_signer TEXT     -- signer domain (e.g. 'ahrefs.com') when parsed
# NEVER select ip_hash or any raw identifier — aggregate COUNT(*) only.

# The six class{} keys to always fill (0 for absent):
#   crawler, automated_unknown, human, unknown, impersonation_suspected, agent

# Precedent for lint allowlist whole-file exemption: LINT_ALLOWLIST entry for
# 'scripts/snapshot-catalog.js' in scripts/check-banned-patterns.js (~line 168).

# Precedent for cron step + commit: 'Snapshot catalog composition' step
# (daily-scrape.yml ~line 405, `if: github.event_name != 'push'`) and the
# 'Commit skills data' step's `git add ... data/snapshots/ ...` (~line 644,
# main-only: `if: github.event_name != 'push' && github.ref == 'refs/heads/main'`).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write scripts/snapshot-traffic.js (D1 → per-day time series)</name>
  <files>scripts/snapshot-traffic.js</files>
  <action>
Create `scripts/snapshot-traffic.js` — Node 22 ESM (package.json is
`"type":"module"`), global `fetch`, NO wrangler import (win32-arm64 can't run
it; this is a plain node script). Reuse the D1 REST `d1Query` helper and
DATABASE_ID from the &lt;interfaces&gt; block verbatim.

Read creds from `process.env.CF_ACCOUNT_ID` and `process.env.CF_API_TOKEN`.
Document at top: run locally as `node --env-file=.env scripts/snapshot-traffic.js`;
in the cron the vars are already in `env:`.

READ-ONLY: only SELECT ... GROUP BY queries. NEVER select ip_hash or raw
identifiers — aggregate COUNT(*) only. Add a code comment: "future optimization:
add a rolling-window WHERE timestamp &gt; cutoff once request_log exceeds ~1M rows;
recomputing all days is fine at current &lt;1M scale."

Run these ~5 aggregate queries (all use `strftime('%Y-%m-%d', timestamp/1000,
'unixepoch') AS d` for the day; timestamp is milliseconds):
  Q1 class-by-day:   `SELECT strftime('%Y-%m-%d', timestamp/1000, 'unixepoch') d, class, COUNT(*) n FROM request_log GROUP BY 1, 2`
  Q2 datacenter:     `SELECT strftime('%Y-%m-%d', timestamp/1000, 'unixepoch') d, COUNT(*) n FROM request_log WHERE classifier_method='coherent_datacenter' GROUP BY 1`
  Q3 impersonation:  `SELECT strftime('%Y-%m-%d', timestamp/1000, 'unixepoch') d, operator, COUNT(*) n FROM request_log WHERE class='impersonation_suspected' GROUP BY 1, 2`
  Q4 verified signers: `SELECT strftime('%Y-%m-%d', timestamp/1000, 'unixepoch') d, wba_signer, COUNT(*) n FROM request_log WHERE wba_status='verified' GROUP BY 1, 2`
  Q5 scanner probes:  `SELECT strftime('%Y-%m-%d', timestamp/1000, 'unixepoch') d, COUNT(*) n FROM request_log WHERE status=404 AND (path LIKE '%.env%' OR path LIKE '%.php%' OR path LIKE '%wp-%' OR path LIKE '%.git%' OR path LIKE '%credential%' OR path LIKE '%aws%' OR path LIKE '%service%account%' OR path LIKE '%.ssh%' OR path LIKE '%.sql%' OR path LIKE '%backup%' OR path LIKE '%phpmyadmin%') GROUP BY 1`

Assemble per-day rows in JS. Collect the union of all days seen across queries.
For each day build a row:
  {
    date,
    classifier_version,   // 'v0' if date &lt; '2026-08-12'; 'v1' if date &gt; '2026-08-12'; 'mixed' if === '2026-08-12'
    total,                // sum of class{} values for the day
    class: { crawler, automated_unknown, human, unknown, impersonation_suspected, agent },  // all six keys, 0 for absent
    coherent_datacenter,  // Q2 count for the day (0 if absent)
    human_corrected: {
      v1_human: class.human,
      would_be_human_v0: class.human + coherent_datacenter,
    },
    agents: {
      genuine: class.agent,
      impersonation: class.impersonation_suspected,
      ratio: class.agent > 0 ? Math.round((class.impersonation_suspected / class.agent) * 10) / 10 : null,
    },
    impersonation_by_operator: { ... },  // from Q3: operator→count; null/empty operator → key 'unknown'
    verified_signers: { ... },           // from Q4: wba_signer→count; null/empty → key 'unknown'
    probes,               // Q5 count for the day (0 if absent)
  }

Sort `days` ascending by date. Final object:
  { generated_at: new Date().toISOString(), cutover: '2026-08-12', days: [ ... ] }
(Real timestamps are fine — this is a normal node script, NOT a workflow sandbox.)

WRITE `data/traffic-snapshot.json` via `JSON.stringify(obj, null, 2)` using
tmp-file + atomic rename (write `data/traffic-snapshot.json.tmp` then
`renameSync` over the target). This is a small bounded sidecar (~11-12 days ×
a few hundred bytes) — the JSON.stringify(x, null, 2) is allowlisted in Task 2.

ROBUSTNESS (critical — must never break the cron): wrap the ENTIRE run
(env check + all fetches + assembly + write) so that ANY failure — missing
CF_ACCOUNT_ID/CF_API_TOKEN, fetch/network error, non-success D1 response —
results in `console.warn('[snapshot-traffic] &lt;clear message&gt;')` and
`process.exit(0)` WITHOUT touching the existing `data/traffic-snapshot.json`.
Never throw, never exit non-zero. Do the env check FIRST and exit(0) with a
warning if creds are absent (so the tmp file is never even created). Never
print CF_API_TOKEN or any secret to logs.

Guard the entry point with an invoked-as-script check (mirror the repo pattern:
run main() only when invoked directly), and export the pure row-assembly
function (e.g. `buildDayRows(queryResults)`) so it is unit-testable without D1.
  </action>
  <verify>
    <automated>node -e "import('./scripts/snapshot-traffic.js').then(()=>console.log('import-ok')).catch(e=>{console.error(e);process.exit(1)})"</automated>
  </verify>
  <done>
Script imports without side effects (no D1 call on import), exports a pure
row-assembly function, and — with no env set — exits 0 with a clear warning and
does not create/modify data/traffic-snapshot.json.
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire lint allowlist, .gitignore committability, and cron integration</name>
  <files>scripts/check-banned-patterns.js, .gitignore, .github/workflows/daily-scrape.yml</files>
  <action>
1) LINT ALLOWLIST — in `scripts/check-banned-patterns.js`, add a whole-file
   `LINT_ALLOWLIST` entry for `scripts/snapshot-traffic.js` mirroring the
   existing `scripts/snapshot-catalog.js` entry (~line 168). Reason string:
   "traffic snapshot writer — bounded per-day D1 aggregate summary (~11-12 days
   × a few hundred bytes; JSON.stringify(x,null,2) Banned B on a bounded
   sidecar). No unbounded data/ reads (D1 REST, not readFileSync)." This lets
   the tmp-file JSON.stringify(x, null, 2) pass strict lint.

2) .GITIGNORE — confirm `data/traffic-snapshot.json` is committable. There is
   NO broad `data/` ignore in .gitignore (only specific file paths are ignored),
   so the new sidecar is committable WITHOUT a negation — same as
   pipeline-stats.json / data/snapshots/ (neither is un-ignored because nothing
   ignores them). Verify with `git check-ignore data/traffic-snapshot.json`
   (must print nothing / exit non-zero). Only if it IS matched, add an
   `!data/traffic-snapshot.json` negation near the data-sidecar comments.

3) CRON — in `.github/workflows/daily-scrape.yml`:
   a) Add a step `Snapshot traffic analytics` running
      `node scripts/snapshot-traffic.js` with `continue-on-error: true` and the
      same non-push gate as the neighboring `Snapshot catalog composition` step:
      `if: github.event_name != 'push'`. Place it right after the
      `Snapshot catalog composition` step (~line 405-407). It needs the D1
      creds in `env:` — add:
        env:
          CF_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
          CF_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
   b) In the `Commit skills data` step (~line 644), add
      `data/traffic-snapshot.json` to the existing `git add` list (append it
      before the trailing `|| true`). Match the existing style exactly.
  </action>
  <verify>
    <automated>npm run check:patterns</automated>
  </verify>
  <done>
`npm run check:patterns` is clean (0 new violations). daily-scrape.yml has a
non-push-gated `node scripts/snapshot-traffic.js` step (with CF_ACCOUNT_ID /
CF_API_TOKEN env + continue-on-error) after the catalog snapshot, and the commit
step's `git add` includes data/traffic-snapshot.json. `git check-ignore
data/traffic-snapshot.json` prints nothing.
  </done>
</task>

<task type="auto">
  <name>Task 3: Live D1 run + full verification against real history</name>
  <files>data/traffic-snapshot.json</files>
  <action>
Run the aggregator against the real D1 database using local .env creds:
  `node --env-file=.env scripts/snapshot-traffic.js`

Then verify the output and repo health:
  - `data/traffic-snapshot.json` exists and `days` has ~11-12 rows spanning
    2026-08-07 → 2026-08-18 (inclusive), sorted ascending by date.
  - Early days 2026-08-07..2026-08-11 carry classifier_version 'v0';
    2026-08-12 is 'mixed'; days after are 'v1'.
  - Spot-check a recent v1 day (e.g. 2026-08-17 or 2026-08-18):
    `impersonation_by_operator` has bytedance leading, and `verified_signers`
    includes `ahrefs.com`.
  - Each day row has all six class{} keys, and human_corrected / agents / probes
    populated.
  - `npm run check:patterns` clean.
  - `npm test` — total pass/fail count unchanged from baseline (the 2 known
    embed-skills failures are expected/OK; no NEW failures).

If the live run reports a D1 permission or shape issue, capture the exact
warning (it must have exited 0 without corrupting any existing file) and adjust
the query/parse — do NOT let the script throw.

Do NOT push — the orchestrator reviews and pushes. Make atomic conventional
commits (e.g. `feat(quick-260818-ohb): D1 traffic snapshot aggregator + cron`
and a separate commit for the generated data file if preferred). Never print
.env secrets to logs.
  </action>
  <verify>
    <automated>node --env-file=.env scripts/snapshot-traffic.js && node -e "const s=require('fs').readFileSync('data/traffic-snapshot.json','utf-8');const j=JSON.parse(s);const d=j.days;if(!Array.isArray(d)||d.length<10){console.error('FAIL day count',d&&d.length);process.exit(1)}const first=d[0].date,last=d[d.length-1].date;console.log('days',d.length,first,'->',last);if(d[0].classifier_version!=='v0'){console.error('FAIL early not v0');process.exit(1)}const recent=d[d.length-1];if(!recent.class||typeof recent.class.human!=='number'){console.error('FAIL class keys');process.exit(1)}console.log('OK', JSON.stringify(recent.impersonation_by_operator), JSON.stringify(recent.verified_signers))"</automated>
  </verify>
  <done>
data/traffic-snapshot.json contains ~11-12 ascending day rows (2026-08-07 →
2026-08-18); early days are 'v0'; a recent v1 day shows bytedance-led
impersonation_by_operator and ahrefs.com in verified_signers; check:patterns
clean; npm test count unchanged. Committed locally (not pushed).
  </done>
</task>

</tasks>

<verification>
- `node --env-file=.env scripts/snapshot-traffic.js` writes a valid 11-12-day
  data/traffic-snapshot.json; a missing-cred / D1-error run exits 0 and leaves
  the file untouched.
- `npm run check:patterns` clean; `npm test` count unchanged (2 known
  embed-skills fails OK).
- daily-scrape.yml runs the snapshot (non-push-gated, continue-on-error) after
  the catalog snapshot and commits data/traffic-snapshot.json (main-only step).
- No secrets printed; no ip_hash/raw identifiers selected.
</verification>

<success_criteria>
- scripts/snapshot-traffic.js: read-only D1 aggregator, robust exit-0-on-any-
  failure, atomic tmp+rename write, exports a pure testable row-assembler.
- data/traffic-snapshot.json committed with the backfilled 2026-08-07 → 08-18
  time series in the exact documented row shape.
- Lint allowlist + cron step + commit git-add + gitignore committability all in
  place. check:patterns clean, test count unchanged. Not pushed.
</success_criteria>

<output>
After completion, create
`.planning/quick/260818-ohb-daily-traffic-analytics-snapshot-scripts/260818-ohb-SUMMARY.md`
</output>

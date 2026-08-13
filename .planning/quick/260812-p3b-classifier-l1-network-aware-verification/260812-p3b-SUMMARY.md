---
phase: quick-260812-p3b
plan: 01
subsystem: worker/traffic-classifier
tags: [classifier, agent-analytics, network-detection, d1, web-bot-auth]
requires: [worker/classify.js, worker/request-log.js, worker/web-bot-auth.js]
provides: [worker/asn-class.js, impersonation_suspected, coherent_datacenter, request_log.asn_class]
affects: [worker/classify.js, worker/request-log.js, worker/schema.sql]
tech-stack:
  added: []
  patterns: [pure-heuristic-module, lazy-column-migration, ctx-waitUntil-only]
key-files:
  created:
    - worker/asn-class.js
    - worker/asn-class.test.js
    - docs/classifier-v1-notes.md
  modified:
    - worker/classify.js
    - worker/classify.test.js
    - worker/request-log.js
    - worker/request-log.test.js
    - worker/schema.sql
    - docs/agent-attribution-convention.md
decisions:
  - "asOrganization keyword lists use case-insensitive SUBSTRING match (no word boundaries) so run-together orgs (CLOUDFLARENET, AMAZON-02, GOOGLE-CLOUD-PLATFORM) key correctly"
  - "DATACENTER_ASNS kept exported from classify.js as a back-compat seed; asn-class HOSTING_ASNS is the authoritative (superset) hosting definition — no duplicate divergent logic"
  - "wbaStatus='verified' overrides ASN heuristics (cryptographic identity dominates); present_unverified does NOT override"
  - "CIDR IP-range verification against vendor range JSONs is a documented follow-up, NOT built in v1 (keeps classifier I/O-free inside ctx.waitUntil)"
metrics:
  tasks: 3
  files: 9
  tests_added: 34
  completed: 2026-08-12
---

# Phase quick-260812-p3b: Classifier L1 Network-Aware Verification Summary

L1 network-aware upgrade of the traffic classifier: a pure `worker/asn-class.js`
ASN module lets `classify.js` flag known-agent/crawler UAs arriving from a
mismatched hosting network as `impersonation_suspected`, downgrade coherent
datacenter "browsers" to `automated_unknown` (`coherent_datacenter`), honor a
Web-Bot-Auth-verified override, and log an `asn_class` analytics column — all
inside the existing non-blocking `ctx.waitUntil` path with zero new network I/O.

## What shipped

- **Task 1 — `worker/asn-class.js` (pure module).** `classifyAsn(asn, asOrg)` →
  `hosting | isp_residential | unknown` (HOSTING_ASNS seed + substring keyword
  regexes; bare GOOGLE stays non-hosting, Kingsoft Cloud → hosting).
  `matchesOperatorNetwork(operator, asn, asOrg)` → `true | false | null` (only
  AI operators carry a network hint; SEO/unknown ops return `null` = no opinion,
  never flagged). Zero imports, zero I/O. 17 test cases.
- **Task 2 — L1 network-aware `classify.js`.** New class
  `impersonation_suspected` + methods `ua_asn_mismatch` / `coherent_datacenter`.
  New `checkOperatorNetwork()` helper: hosting ASN + `matchesOperatorNetwork ===
  false` → impersonation (0.8); `wbaStatus==='verified'` overrides. Rule 5
  browser path routes through `classifyAsn===hosting` → automated_unknown.
  Removed dead `isDatacenter` / `DATACENTER_ORG_RE` / `GOOGLE_CLOUD_ORG_RE`;
  kept `DATACENTER_ASNS` as a back-compat seed export. +14 test cases; 2
  datacenter assertions renamed `asn_heuristic` → `coherent_datacenter`.
- **Task 3 — request-log wiring + docs.** `verifyWebBotAuth` now resolves
  BEFORE `classifyRequest`, feeding `wbaStatus` into signals. New `asn_class`
  (21st) column computed by `classifyAsn`, bound in `buildLogRow`, added to
  `REQUEST_LOG_DDL` + `schema.sql`, and appended to the `COLUMN_MIGRATIONS`
  lazy-ALTER loop (the `MISSING_COLUMN_RE` dual-phrasing incident guard is
  untouched). `docs/classifier-v1-notes.md` records the 2026-08-12 evidence;
  the E1 status row in `docs/agent-attribution-convention.md` was updated.
  `index.js` untouched.

## New enum values

| Kind   | Value(s) added |
|--------|----------------|
| class  | `impersonation_suspected` |
| method | `ua_asn_mismatch`, `coherent_datacenter` (the latter renames the old `asn_heuristic`) |

## New D1 column

`request_log.asn_class TEXT` — `hosting | isp_residential | unknown`, populated
via the established lazy `COLUMN_MIGRATIONS` path (3 pending ALTERs now:
agent_token + mcp_client + asn_class). Analytics-only.

## Test counts

- `worker/asn-class.test.js`: 17 (new)
- `worker/classify.test.js`: 53 (was 39; +14, 2 method assertions updated)
- `worker/request-log.test.js`: 24 (was 21; +3 asn_class cases, migration-count
  assertions bumped 2→3, two mechanics fixtures repointed to coherent networks)
- Worker subtotal (these three files): **94 pass / 0 fail**
- Full `npm test`: **368 tests, 360 pass, 2 fail** — the 2 fails are the
  pre-existing embed-skills `Task 9 B-2 cache-hit` / drift assertions (known,
  unrelated, count did NOT grow). `npm run check:patterns` clean.

## Deviations from Plan

Applied the two orchestrator-supplied plan corrections as legitimate updates
(not regressions):

1. **[Correction 1 — migration/column count]** Updated existing
   `request-log.test.js` assertions the schema change legitimately breaks:
   20→21 columns (`buildLogRow covers all N` + `bind.length`), and
   COLUMN_MIGRATIONS count 2→3 (`altersAfterFirst/Second`, `both column
   migrations attempted`, and the reset test's 2→3 / 4→6).
2. **[Correction 2 — keep DATACENTER_ASNS]** Left `DATACENTER_ASNS` exported
   from `classify.js` (classify.test.js imports it and asserts `.has(16509)` /
   `.has(24940)`); `asn-class.js HOSTING_ASNS` is an independent superset.
3. **[Correction 3 — schema comment hygiene]** Updated the `class` enum and
   `classifier_method` comments in `schema.sql` to include the new
   `impersonation_suspected` / `ua_asn_mismatch` / `coherent_datacenter` values
   (comment-only; there is no DB CHECK constraint).

**[Rule 1 — test fidelity]** Two `request-log.test.js` mechanics tests
(`logRequest executes exactly one INSERT`, `response without markers → ...`)
used the shared `makeRequest` default (GPTBot from AMAZON-02/AS16509), which now
*correctly* classifies as `impersonation_suspected` under L1 (OpenAI's published
network is Azure, not AWS). Repointed those two fixtures to coherent networks
(Azure AS8075 for the crawler-from-hosting case; residential COMCAST for the
no-markers case) so each test keeps its original mechanics/intent without being
entangled with the new network layer. This is a test-fixture adjustment, not a
behavior change — the impersonation path itself is covered directly in
`classify.test.js`.

## Known Stubs

None. All wired paths are exercised by tests; no placeholder/empty-data flows
introduced.

## Follow-up left for a future task

**CIDR IP-range verification** against the operators' published range JSONs
(openai.com/chatgpt-user.json, claude.com/crawling/bots.json,
perplexity.com/perplexity-user.json,
developers.google.com/…/user-triggered-agents.json) — would positively verify a
connecting IP against a vendor's CIDR set instead of heuristically rejecting an
asOrganization mismatch. Deliberately out of scope for v1 to keep the classifier
I/O-free inside `ctx.waitUntil`. Documented in `docs/classifier-v1-notes.md` and
`docs/agent-analytics-research/03-identification-standards.md` §3.

## Commits

- `2b3f9d0` — feat(quick-260812-p3b): pure ASN network module (asn-class.js) + tests
- `8d37cbe` — feat(quick-260812-p3b): L1 network-aware classify.js (impersonation + datacenter-human + WBA override)
- `345603c` — feat(quick-260812-p3b): wire wbaStatus + asn_class column into request-log; classifier-v1 notes

## Self-Check: PASSED

- Created files present: `worker/asn-class.js`, `worker/asn-class.test.js`,
  `docs/classifier-v1-notes.md`, SUMMARY + PLAN (copied into worktree).
- Commits present: `2b3f9d0`, `8d37cbe`, `345603c`.
- Worker tests (3 files) 94/94 pass; full `npm test` 360/368 (2 known
  pre-existing embed-skills fails, count unchanged); `check:patterns` clean.

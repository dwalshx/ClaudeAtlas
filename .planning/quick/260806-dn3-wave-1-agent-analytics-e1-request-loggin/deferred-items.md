# Deferred items — quick-260806-dn3

Out-of-scope discoveries logged during execution (NOT fixed, per scope boundary).

1. **Pre-existing test failures in `scripts/__tests__/embed-skills.test.js`** (2 of 4):
   - "Task 9: B-2 cache-hit pre-check — 100% hit on unchanged re-run"
   - "Task 9: B-2 drift assertion fires below 99% without EMBED_FORCE_REEMBED"
   - Verified failing identically on the pristine main checkout at commit 6235531
     (before any quick-260806-dn3 changes). Likely fixture/environment drift after
     the 260804-dy2 drift-guard rework (prior-overlap decision). Unrelated to this
     task's files.

2. **`idx_agent_pings_timestamp` was never applied to the REMOTE D1 database.**
   Discovered while probing the D1 REST API: `sqlite_master type='index'` on the
   remote lists only the two search_events indexes. The agent_pings table exists
   (created via dashboard console per the schema.sql operator note) but its index
   was skipped. The next successful `scripts/apply-d1-schema.js` run will create
   it (the schema file is re-apply-safe).

3. **`.env` CF_API_TOKEN lacks D1 write/edit permission** (the Task 1 auth gate).
   Read queries + no-op DDL succeed; any real DDL returns error 7500. Needs a
   token with Account → D1 → Edit, or a one-time dashboard-console paste.

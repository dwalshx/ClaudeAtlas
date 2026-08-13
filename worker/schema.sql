-- ClaudeAtlas Cloudflare D1 schema. Defines TWO tables, both applied via the
-- same command: `search_events` (search query log) and `agent_pings`
-- (Phase quick-260603 agent self-identification experiment).
--
-- Apply with:
--   wrangler d1 execute claudeatlas-search-log --file=worker/schema.sql
--
-- Privacy note: ip_hash is SHA-256 of (SALT_SECRET + YYYY-MM-DD + ip).
-- The daily salt rotation means cross-day tracking is impossible, but
-- same-day deduplication is still possible for analytics.

CREATE TABLE IF NOT EXISTS search_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  query TEXT NOT NULL,
  ip_hash TEXT,
  country TEXT
);

CREATE INDEX IF NOT EXISTS idx_search_events_timestamp ON search_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_search_events_query ON search_events(query);

-- Phase quick-260603: agent-ping affordance (POST /api/v1/agent-ping).
-- Low-volume experiment: tool-using agents self-identify so we can separate
-- "agents using us" from "bots crawling us". D1 now; planned migration to a
-- Cloudflare Analytics Engine binding for durable high-volume telemetry later.
--
-- OPERATOR STEP (wrangler CANNOT run on this Windows ARM64 machine — workerd
-- has no win32-arm64 build): paste this CREATE TABLE + CREATE INDEX into the
-- Cloudflare dashboard → D1 → claudeatlas-search-log → Console, OR run from a
-- non-ARM64 host:
--   wrangler d1 execute claudeatlas-search-log --file=worker/schema.sql
-- IF NOT EXISTS makes re-applying the whole file safe (search_events untouched).

CREATE TABLE IF NOT EXISTS agent_pings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  agent TEXT,
  purpose TEXT,
  user_agent TEXT,
  bot_category TEXT,
  country TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_pings_timestamp ON agent_pings(timestamp);

-- quick-260806-dn3 (E1): per-request log + classifier v0 verdicts.
-- 1 row/request via ctx.waitUntil (~98k/day; within D1 paid row-write limits).
-- Retention purge deliberately deferred to a follow-up task.
-- ip_hash = daily-salted SHA-256, same convention as search_events.
--
-- OPERATOR STEP: applied to the REMOTE database via the CF D1 REST API
-- (wrangler cannot run on this win32-arm64 machine):
--   node --env-file=.env scripts/apply-d1-schema.js
-- IF NOT EXISTS makes re-applying the whole file safe (other tables untouched).
CREATE TABLE IF NOT EXISTS request_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  path TEXT,
  method TEXT,
  status INTEGER,
  user_agent TEXT,
  asn INTEGER,
  as_org TEXT,
  country TEXT,
  accept_header TEXT,
  sec_fetch_coherent INTEGER,        -- 1 coherent / 0 contradiction / NULL n-a
  class TEXT NOT NULL,               -- human|agent|crawler|automated_unknown|
                                     -- impersonation_suspected|unknown (no DB
                                     -- CHECK constraint; enum is app-enforced)
  operator TEXT,
  confidence REAL,
  classifier_method TEXT,            -- token_echo|mcp|ua_list|ua_asn_mismatch|
                                     -- no_ua|coherent_datacenter|coherence|default
                                     -- (ua_asn_mismatch + coherent_datacenter added
                                     -- quick-260812-p3b; no DB CHECK constraint)
  signature_agent TEXT,              -- raw Signature-Agent value (domain), if any
  wba_status TEXT,                   -- verified|failed|present_unverified|absent
  wba_signer TEXT,                   -- signer domain when parsed
  ip_hash TEXT,
  agent_token TEXT,                  -- E3 (quick-260806-ejd): echoed X-ClaudeAtlas-Agent
                                     -- value (random per-request token from
                                     -- /agent/index.json + optional '; tool=<name>').
                                     -- Live DB gains this via the lazy
                                     -- ALTER TABLE in worker/request-log.js.
  mcp_client TEXT,                   -- E4 (quick-260806-f00): MCP initialize clientInfo
                                     -- ('<name>/<version>', from the x-ca-mcp-client
                                     -- response marker set by worker/mcp.js). Live DB
                                     -- gains this via the same lazy COLUMN_MIGRATIONS
                                     -- loop in worker/request-log.js.
  asn_class TEXT                     -- quick-260812-p3b (L1): network bucket
                                     -- (hosting|isp_residential|unknown) from
                                     -- worker/asn-class.js classifyAsn(asn, asOrg).
                                     -- Analytics column; live DB gains it via the
                                     -- same lazy COLUMN_MIGRATIONS loop.
);

CREATE INDEX IF NOT EXISTS idx_request_log_timestamp ON request_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_request_log_class ON request_log(class);

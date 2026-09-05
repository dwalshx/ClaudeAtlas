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

-- quick-260905-fib (L4): behavioral beacon aggregates. One row per non-EU
-- pageview that produced interaction. The client (src/layouts/BaseLayout.astro)
-- computes ~10 STRUCTURAL aggregates + scores an automation band IN THE BROWSER
-- (src/lib/beh-score.js) and POSTs only those numbers + score + band. This
-- catches agentic browsers (ChatGPT Atlas, Claude-in-Chrome, Perplexity Comet)
-- that run real Chrome from residential IPs but execute JS — their input-event
-- STRUCTURE betrays automation where logs cannot. Complements request_log.
--
-- PRIVACY (hard invariants, PRIV-01..04):
--   * NO ip_hash, NO cookie, NO nonce, NO device identifier of ANY kind. The
--     beacon is stateless per pageview — there is deliberately no identifier
--     column here (PRIV-03).
--   * Only aggregate NUMBERS + score + band + path are stored; no coordinate
--     stream, no key identities, no per-key timing (PRIV-01, PRIV-04).
--   * EU/EEA/UK is never instrumented (client activate-gate + worker re-drop);
--     rows only ever land for non-EU visitors (PRIV-02).
--
-- OPERATOR STEP (wrangler CANNOT run on this win32-arm64 machine — workerd has
-- no win32-arm64 build): the LIVE table is created LAZILY on the first insert
-- via the Worker's own DB binding (BEHAVIOR_LOG_DDL in worker/beh.js). This
-- block is the source of truth; IF NOT EXISTS makes re-applying safe.
--   node --env-file=.env scripts/apply-d1-schema.js   (once a D1-Edit token exists)
CREATE TABLE IF NOT EXISTS behavior_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  path TEXT,
  country TEXT,
  mouse_event_rate REAL,             -- mousemove events / second over the session
  has_wheel INTEGER,                 -- 0/1; wheel absence is a strong automation tell
  wheel_count INTEGER,
  teleport_click_ratio REAL,         -- 0..1; clicks with no approach movement ÷ clicks
  click_count INTEGER,
  pointer_move_count INTEGER,
  keydown_count INTEGER,             -- COUNT ONLY — never key identities/timing (PRIV-04)
  session_ms INTEGER,
  click_duration_spread REAL,        -- std of mousedown->mouseup ms (aggregate only)
  interaction_total INTEGER,
  score REAL,                        -- 0..1 automation-likelihood (scored client-side)
  band TEXT                          -- human-shaped|uncertain|automation-signature
  -- NO ip_hash / cookie / nonce / identifier column, BY DESIGN (PRIV-03).
);

CREATE INDEX IF NOT EXISTS idx_behavior_log_timestamp ON behavior_log(timestamp);

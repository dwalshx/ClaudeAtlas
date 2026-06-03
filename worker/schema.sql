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

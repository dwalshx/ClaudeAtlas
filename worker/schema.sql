-- ClaudeAtlas search query log schema (Cloudflare D1)
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

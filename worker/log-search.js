/**
 * ClaudeAtlas — /api/log-search Worker endpoint
 *
 * Receives search queries from the homepage search input (debounced ~500ms
 * client-side) and writes one row per query to a Cloudflare D1 database.
 *
 * Privacy:
 *   - No raw IP stored
 *   - IP is hashed with SHA-256 + a daily-rotating salt so cross-day tracking
 *     is impossible, but same-day deduplication is still possible
 *   - Query text capped at 200 chars
 *   - No cookies, no identifiers
 *
 * Schema (see worker/schema.sql):
 *   CREATE TABLE search_events (
 *     id INTEGER PRIMARY KEY AUTOINCREMENT,
 *     timestamp INTEGER NOT NULL,
 *     query TEXT NOT NULL,
 *     ip_hash TEXT,
 *     country TEXT
 *   );
 *
 * Deployment:
 *   1. `wrangler d1 create claudeatlas-search-log`
 *   2. `wrangler d1 execute claudeatlas-search-log --file=worker/schema.sql`
 *   3. Uncomment the [[d1_databases]] block in wrangler.toml with the ID from step 1
 *   4. `wrangler deploy`
 *
 * This handler is wired into the existing Static Assets worker.
 * The top-level worker (wrangler.toml main entry) should route POST /api/log-search
 * through logSearch() and fall through to assets otherwise.
 */

const MAX_QUERY_LEN = 200;

async function sha256Hex(input) {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function logSearch(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const query = typeof body?.query === 'string' ? body.query.trim().slice(0, MAX_QUERY_LEN) : '';
  if (!query) {
    return new Response('Query required', { status: 400 });
  }

  // Privacy: hash IP with daily-rotating salt
  const salt = (env && env.SALT_SECRET) || '';
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const ipHash = await sha256Hex(`${salt}:${todayISO()}:${ip}`);
  const country = (request.cf && request.cf.country) || null;

  // If the D1 binding isn't configured yet (pre-Phase-1.5 deploy), return 202
  // so the client doesn't retry endlessly. Once the binding is wired up,
  // this branch is unreachable.
  if (!env || !env.DB) {
    return new Response(JSON.stringify({ queued: false, reason: 'D1 binding not configured' }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    await env.DB.prepare(
      'INSERT INTO search_events (timestamp, query, ip_hash, country) VALUES (?, ?, ?, ?)'
    )
      .bind(Date.now(), query, ipHash, country)
      .run();
  } catch (err) {
    // Log to Worker console but don't error the client — this is fire-and-forget
    console.error('D1 insert error:', err && err.message);
    return new Response(JSON.stringify({ queued: false, reason: 'db error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ queued: true }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
}

// Default export — this is the Worker entry point when wrangler.toml sets
// `main = "worker/log-search.js"`. It handles the /api/log-search route and
// falls through to the Static Assets binding (env.ASSETS) for everything else,
// which is how Workers Static Assets expects custom handlers to coexist with
// the static asset server.
//
// https://developers.cloudflare.com/workers/static-assets/binding/
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API routes handled by this worker
    if (url.pathname === '/api/log-search') {
      return logSearch(request, env);
    }

    // Everything else → serve static assets from dist/
    // (env.ASSETS is bound automatically by the [assets] block in wrangler.toml)
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    // Fallback: if the binding is missing (shouldn't happen in production)
    return new Response('Not Found', { status: 404 });
  },
};

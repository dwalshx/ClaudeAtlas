/**
 * ClaudeAtlas Worker entry point
 *
 * Handles multiple /api/* routes and falls through to Workers Static Assets
 * for everything else. This is the only Worker code in the project; the
 * wrangler.toml `main` field points here.
 *
 * Routes:
 *   POST /api/log-search      — debounced search query logger → Cloudflare D1
 *   POST /api/v1/search       — semantic search over skill embeddings (Vectorize)
 *   GET  /api/v1/search       — same, via query-string `?q=...` (for easy curl/links)
 *   *                         — static assets from env.ASSETS.fetch (dist/)
 *
 * Bindings required (in wrangler.toml):
 *   ASSETS      — automatic static assets binding (from [assets] block)
 *   DB          — D1 database for search query log
 *   VECTORIZE   — Vectorize index for skill embeddings
 *
 * Secrets required (set via `wrangler secret put` or the CF dashboard):
 *   SALT_SECRET      — daily-rotating IP hash salt for /api/log-search
 *   OPENAI_API_KEY   — for embedding query strings at the edge for /api/v1/search
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

function corsPreflightResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    },
  });
}

// ---------------------------------------------------------------------------
// POST /api/log-search — privacy-respecting search query telemetry
// ---------------------------------------------------------------------------

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

  const salt = (env && env.SALT_SECRET) || '';
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const ipHash = await sha256Hex(`${salt}:${todayISO()}:${ip}`);
  const country = (request.cf && request.cf.country) || null;

  if (!env || !env.DB) {
    return jsonResponse({ queued: false, reason: 'D1 binding not configured' }, 202);
  }

  try {
    await env.DB.prepare(
      'INSERT INTO search_events (timestamp, query, ip_hash, country) VALUES (?, ?, ?, ?)'
    )
      .bind(Date.now(), query, ipHash, country)
      .run();
  } catch (err) {
    console.error('D1 insert error:', err && err.message);
    return jsonResponse({ queued: false, reason: 'db error' }, 500);
  }

  return jsonResponse({ queued: true }, 201);
}

// ---------------------------------------------------------------------------
// GET/POST /api/v1/search — semantic search over skill embeddings
// ---------------------------------------------------------------------------

const SEARCH_DEFAULT_K = 20;
const SEARCH_MAX_K = 50;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

async function embedQuery(query, env) {
  if (!env || !env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY secret not configured on worker');
  }
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: query,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI embed failed: HTTP ${res.status} ${errText.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json.data || !json.data[0] || !Array.isArray(json.data[0].embedding)) {
    throw new Error('OpenAI embed response missing data[0].embedding');
  }
  return json.data[0].embedding;
}

export async function semanticSearch(request, env) {
  if (request.method === 'OPTIONS') return corsPreflightResponse();

  // Accept both GET (?q=) and POST ({query: "..."})
  let query = '';
  let topK = SEARCH_DEFAULT_K;
  let filterTier = null;
  let filterCategory = null;

  if (request.method === 'GET') {
    const url = new URL(request.url);
    query = (url.searchParams.get('q') || '').trim();
    const k = parseInt(url.searchParams.get('k') || '', 10);
    if (!isNaN(k) && k > 0) topK = Math.min(k, SEARCH_MAX_K);
    filterTier = url.searchParams.get('tier') || null;
    filterCategory = url.searchParams.get('category') || null;
  } else if (request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }
    query = typeof body?.query === 'string' ? body.query.trim() : '';
    if (typeof body?.k === 'number' && body.k > 0) topK = Math.min(body.k, SEARCH_MAX_K);
    if (typeof body?.tier === 'string') filterTier = body.tier;
    if (typeof body?.category === 'string') filterCategory = body.category;
  } else {
    return new Response('Method Not Allowed', { status: 405 });
  }

  if (!query) {
    return jsonResponse({ error: 'query required' }, 400);
  }
  if (query.length > MAX_QUERY_LEN) {
    return jsonResponse({ error: `query too long (max ${MAX_QUERY_LEN} chars)` }, 400);
  }

  if (!env || !env.VECTORIZE) {
    return jsonResponse({ error: 'VECTORIZE binding not configured on worker' }, 503);
  }

  // Embed the query
  let queryVector;
  const embedStart = Date.now();
  try {
    queryVector = await embedQuery(query, env);
  } catch (err) {
    console.error('Query embed failed:', err && err.message);
    return jsonResponse({ error: 'embed_failed', detail: String(err && err.message).slice(0, 200) }, 502);
  }
  const embedMs = Date.now() - embedStart;

  // Query Vectorize
  const vecStart = Date.now();
  let vectorResults;
  try {
    const opts = {
      topK,
      returnMetadata: 'all',
    };
    // Optional metadata filters
    if (filterTier || filterCategory) {
      const filter = {};
      if (filterTier) filter.quality_tier = { $eq: filterTier };
      if (filterCategory) filter.category = { $eq: filterCategory };
      opts.filter = filter;
    }
    vectorResults = await env.VECTORIZE.query(queryVector, opts);
  } catch (err) {
    console.error('Vectorize query failed:', err && err.message);
    return jsonResponse({ error: 'vectorize_failed', detail: String(err && err.message).slice(0, 200) }, 502);
  }
  const vecMs = Date.now() - vecStart;

  const matches = (vectorResults && vectorResults.matches) || [];
  const results = matches.map(m => ({
    slug: m.id,
    score: Math.round(m.score * 10000) / 10000, // 4 decimals
    name: m.metadata?.name || '',
    category: m.metadata?.category || null,
    quality_tier: m.metadata?.quality_tier || null,
    quality_score: m.metadata?.quality_score || null,
    repo_stars: m.metadata?.repo_stars || null,
    repo_full_name: m.metadata?.repo_full_name || null,
    description: m.metadata?.description || null,
    detail_url: `/skills/${m.id}/`,
  }));

  // Fire-and-forget log to D1 if available. Don't block the response.
  if (env && env.DB) {
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
    const salt = env.SALT_SECRET || '';
    sha256Hex(`${salt}:${todayISO()}:${ip}`).then(ipHash => {
      const country = (request.cf && request.cf.country) || null;
      return env.DB.prepare(
        'INSERT INTO search_events (timestamp, query, ip_hash, country) VALUES (?, ?, ?, ?)'
      )
        .bind(Date.now(), query.slice(0, MAX_QUERY_LEN), ipHash, country)
        .run();
    }).catch(err => {
      console.error('D1 log error (semantic):', err && err.message);
    });
  }

  return jsonResponse({
    query,
    count: results.length,
    timings_ms: { embed: embedMs, vector: vecMs, total: embedMs + vecMs },
    results,
  });
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight for any /api/* route
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return corsPreflightResponse();
    }

    // API routes
    if (url.pathname === '/api/log-search') {
      return logSearch(request, env);
    }
    if (url.pathname === '/api/v1/search') {
      return semanticSearch(request, env);
    }

    // Fallthrough to static assets
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};

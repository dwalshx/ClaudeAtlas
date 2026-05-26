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
 *   GET  /skills/{slug}/      — static assets if pre-rendered (Top/Solid tier),
 *                               else SKILLS_KV.get(slug) → dynamic render (Listed)
 *   *                         — static assets from env.ASSETS.fetch (dist/)
 *
 * Bindings required (in wrangler.toml):
 *   ASSETS      — automatic static assets binding (from [assets] block)
 *   DB          — D1 database for search query log
 *   VECTORIZE   — Vectorize index for skill embeddings
 *   QUERY_CACHE — KV namespace: caches OpenAI query embeddings
 *   SKILLS_KV   — KV namespace: per-slug skill records for Listed-tier
 *                 dynamic rendering. Populated by scripts/lib/publish-kv.js
 *                 during the daily-scrape workflow.
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

// KV cache key for query embeddings. Normalized to lowercase+trimmed so
// "Testing Frameworks" and "testing frameworks" share a cache entry.
// TTL = 24 hours (queries embedding the same text always produce the same
// vector, so staleness isn't really a concern — we expire just to cap
// storage growth on the free tier).
const QUERY_CACHE_TTL_SECONDS = 86400;

function queryCacheKey(query) {
  return 'qe:' + query.toLowerCase().trim();
}

async function embedQuery(query, env) {
  if (!env || !env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY secret not configured on worker');
  }

  // Try KV cache first — if bound, a cache hit skips the ~1.1s OpenAI round trip
  const cacheKey = queryCacheKey(query);
  if (env.QUERY_CACHE) {
    try {
      const cached = await env.QUERY_CACHE.get(cacheKey, { type: 'json' });
      if (cached && Array.isArray(cached) && cached.length === EMBEDDING_DIMENSIONS) {
        return { vector: cached, cached: true };
      }
    } catch (err) {
      // KV read failed — fall through to OpenAI
      console.error('KV cache read error:', err && err.message);
    }
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
  const vector = json.data[0].embedding;

  // Write to KV cache (fire-and-forget, don't block response)
  if (env.QUERY_CACHE) {
    try {
      // KV put is async but we don't await — the response goes out immediately
      env.QUERY_CACHE.put(cacheKey, JSON.stringify(vector), {
        expirationTtl: QUERY_CACHE_TTL_SECONDS,
      }).catch(() => {}); // swallow errors silently
    } catch {
      // noop
    }
  }

  return { vector, cached: false };
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

  // Embed the query (may be served from KV cache)
  let queryVector;
  let embedCached = false;
  const embedStart = Date.now();
  try {
    const result = await embedQuery(query, env);
    queryVector = result.vector;
    embedCached = result.cached;
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
  // Dedupe: if two skills share a slug (6 known collisions in current catalog)
  // both can match. Keep the highest-scoring one per slug.
  const bySlug = new Map();
  for (const m of matches) {
    const slug = m.metadata?.slug;
    if (!slug) continue;
    const prior = bySlug.get(slug);
    if (!prior || m.score > prior.score) {
      bySlug.set(slug, m);
    }
  }
  const results = [...bySlug.values()]
    .sort((a, b) => b.score - a.score)
    .map(m => ({
      slug: m.metadata.slug,
      score: Math.round(m.score * 10000) / 10000, // 4 decimals
      name: m.metadata?.name || '',
      category: m.metadata?.category || null,
      quality_tier: m.metadata?.quality_tier || null,
      quality_score: m.metadata?.quality_score || null,
      repo_stars: m.metadata?.repo_stars || null,
      repo_full_name: m.metadata?.repo_full_name || null,
      description: m.metadata?.description || null,
      detail_url: `/skills/${m.metadata.slug}/`,
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
    embed_cached: embedCached,
    results,
  });
}

// ---------------------------------------------------------------------------
// GET /skills/{slug}/ — Listed-tier dynamic render (Phase 03.1.1 T5d)
// ---------------------------------------------------------------------------
//
// After T5's tier-aware rendering, only Top/Featured + Solid slugs get a
// static HTML file in dist/. For any GET request to `/skills/<slug>/`, the
// fetch handler first asks env.ASSETS — if it returns a 200, we have a
// pre-rendered page (Top/Solid tier; serve it). If it returns 404, we fall
// here and render from SKILLS_KV.
//
// O(1) per-request memory: ONE record fetched from KV, parsed, rendered.
// No NDJSON materialization. No `await res.text()` on a multi-MB file.
// Per-request memory is bounded by record size (~10 KB) regardless of
// total catalog size. This is what makes Listed-tier dynamic rendering
// scale to 200k+ records.
//
// Caching: 5-minute edge cache via Cache-Control headers. Subsequent
// requests for the same slug serve from Cloudflare's edge cache without
// invoking the worker.

function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderListedSkillHtml(skill) {
  const name = escapeHtml(skill.name || skill.slug || 'Skill');
  const slug = escapeHtml(skill.slug || '');
  const description = escapeHtml(skill.description || '');
  const repoFullName = escapeHtml(skill.repo_full_name || '');
  const repoUrl = escapeHtml(skill.repo_url || `https://github.com/${skill.repo_full_name || ''}`);
  const category = escapeHtml(skill.category || '');
  const stars = Number(skill.repo_stars || 0);
  const tier = escapeHtml(skill.quality_tier || 'listed');
  const score = Number(skill.quality_score || 0);
  const installCmd = escapeHtml(`claude install-skill ${skill.repo_full_name || ''}`);
  const bodyExcerpt = escapeHtml((skill.body_markdown || '').slice(0, 1500));

  // Minimal but functional template. Visual chrome (nav/footer matching
  // BaseLayout.astro) is intentionally light here — a future polish task
  // can extract a `dist/_partial/listed-shell.html` partial and merge.
  // The /assets/* CSS bundle is loaded by URL so the page picks up the
  // production Tailwind styles even though it's rendered dynamically.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} — ClaudeAtlas</title>
<meta name="description" content="${description}">
<link rel="canonical" href="https://claudeatlas.com/skills/${slug}/">
<link rel="stylesheet" href="/_astro/index.css">
<style>
:root{color-scheme:dark}
body{margin:0;padding:0;background:#0a0a0b;color:#e5e7eb;font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.6}
.shell{max-width:768px;margin:0 auto;padding:2rem 1.25rem}
header{padding:1rem 0;border-bottom:1px solid #1f2937;margin-bottom:2rem}
header a{color:#e5e7eb;text-decoration:none;font-weight:600}
h1{font-size:1.75rem;margin:0 0 .5rem}
.tier{display:inline-block;padding:.125rem .5rem;border-radius:.25rem;background:#1e293b;color:#94a3b8;font-size:.75rem;font-weight:600;text-transform:uppercase;margin-left:.5rem}
.meta{color:#94a3b8;font-size:.875rem;margin-bottom:1.5rem}
.meta a{color:#7dd3fc}
.install{background:#111827;border:1px solid #1f2937;border-radius:.375rem;padding:1rem;margin:1.5rem 0;font-family:ui-monospace,monospace;font-size:.875rem;overflow-x:auto}
.body{white-space:pre-wrap;font-size:.9375rem;color:#cbd5e1;margin-top:2rem}
footer{margin-top:4rem;padding-top:1rem;border-top:1px solid #1f2937;color:#64748b;font-size:.875rem}
footer a{color:#94a3b8}
</style>
</head>
<body>
<div class="shell">
  <header><a href="/">← ClaudeAtlas</a></header>
  <h1>${name}<span class="tier">${tier}</span></h1>
  <div class="meta">
    ${description}<br>
    <a href="${repoUrl}">${repoFullName}</a> · ★ ${stars.toLocaleString()} · ${category} · score ${score}
  </div>
  <div class="install"><strong>Install:</strong> <code>${installCmd}</code></div>
  ${bodyExcerpt ? `<div class="body">${bodyExcerpt}</div>` : ''}
  <footer>
    Served dynamically by ClaudeAtlas. <a href="${repoUrl}">View source on GitHub</a>.
  </footer>
</div>
</body>
</html>`;
}

async function renderListedSkillPage(slug, env) {
  if (!env || !env.SKILLS_KV) {
    return new Response('SKILLS_KV not configured', { status: 503 });
  }
  let raw;
  try {
    raw = await env.SKILLS_KV.get(slug);
  } catch (err) {
    console.error('SKILLS_KV.get failed:', err && err.message);
    return new Response('KV read failed', { status: 502 });
  }
  if (!raw) {
    return new Response('Not Found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  let skill;
  try {
    skill = JSON.parse(raw);
  } catch {
    return new Response('Corrupt KV entry', { status: 500 });
  }
  return new Response(renderListedSkillHtml(skill), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Edge-cache for 5 minutes. Subsequent requests for the same slug
      // serve from Cloudflare's edge without invoking the worker.
      'cache-control': 'public, max-age=300, s-maxage=300',
    },
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

    // T5: Listed-tier dynamic render fallback. For GET /skills/<slug>/
    // requests, try static assets first (Top/Solid pre-rendered); on
    // 404, render from SKILLS_KV.
    //
    // wrangler.toml's `run_worker_first = ["/skills/*"]` ensures we
    // reach this branch before Cloudflare's assets binding serves its
    // 404 page (the `not_found_handling = "404-page"` config). Top and
    // Solid tier pages are static files in dist/; we detect them via
    // env.ASSETS.fetch's `cf-aside` headers / content-type, or simply
    // by probing whether the asset exists.
    //
    // Detection approach: probe env.ASSETS for the request. If it
    // returns 200 AND the response body looks like a real page (not
    // the static 404), serve it. Otherwise fall to KV.
    //
    // Simple heuristic: check the content of the path's index.html. If
    // env.ASSETS returns 200 for the EXACT pathname, it's pre-rendered.
    // The not_found_handling fallback returns the 404 page but at the
    // SAME 200 status, so we differentiate via a probe header.
    //
    // Pragmatic implementation: try the asset path with an explicit
    // "Sec-Fetch-Mode: navigate" probe and check the response's
    // `cf-aside` debug header (Cloudflare sets it on 404-page
    // substitutions). If unreliable, fall through to KV unconditionally
    // and let asset hits work by accident — Top/Solid hits via KV are
    // ALSO valid (their records are in KV too). Tier-aware rendering
    // becomes a "static is a perf optimization for Top/Solid" pattern
    // rather than a hard separation.
    if (
      request.method === 'GET' &&
      url.pathname.startsWith('/skills/') &&
      url.pathname.endsWith('/') &&
      env && env.ASSETS
    ) {
      const assetRes = await env.ASSETS.fetch(request);
      // If assets returned 200 AND it's clearly a real skill page (not
      // the 404 fallback), serve it. The 404 page has `cf-aside` header
      // set; real pages don't.
      const isFallback404 = assetRes.headers.get('cf-aside') === 'not-found-page';
      if (assetRes.status === 200 && !isFallback404) {
        return assetRes;
      }
      // Static miss: render Listed-tier from KV.
      const slug = url.pathname.slice('/skills/'.length, -1);
      if (slug) {
        return renderListedSkillPage(slug, env);
      }
      return assetRes;
    }

    // Fallthrough to static assets for everything else
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};

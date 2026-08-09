/**
 * worker/mcp.js — E4 MCP front door (quick-260806-f00).
 *
 * Minimal, dependency-free remote MCP server exposing the ClaudeAtlas
 * catalog over Streamable HTTP in STATELESS mode: every POST /mcp is a
 * self-contained JSON-RPC 2.0 exchange answered with application/json.
 * No sessions, no SSE (GET returns 405), no MCP SDK — the protocol subset
 * is hand-rolled per spec revision 2025-06-18.
 *
 * Why MCP: it is the purest agent-identification channel — every MCP
 * client is by definition an agent, with named clientInfo and zero
 * contamination from SEO crawlers (docs/agent-traffic-analytics-research.md
 * report 6 §6). A structurally valid JSON-RPC POST here classifies as
 * class=agent method='mcp' in request_log.
 *
 * Marker headers (the in-band classification channel):
 *   x-ca-mcp: 1            — set on EVERY response produced for a
 *                            structurally valid JSON-RPC envelope
 *                            (including notifications' 202 and -32601 /
 *                            -32602 error responses). The -32700 parse
 *                            error and -32600 invalid-request paths do
 *                            NOT set it — "valid JSON-RPC body" is the
 *                            classifier gate.
 *   x-ca-mcp-client: n/v   — initialize's params.clientInfo, sanitized.
 * These are intentionally client-visible (harmless — the client sent that
 * data); they exist because worker/request-log.js's waitUntil logger only
 * has request+response to work from.
 *
 * Tools (3): search_skills reuses the injected deps.semanticSearch — the
 * existing embed + Vectorize + KV-cache + 30/min rate-limit path, NOT a
 * duplicate. get_skill reads one trimmed SKILLS_KV record. get_categories
 * returns the 8 static categories.
 *
 * Pure ESM module: zero I/O at import time; worker/index.js imports FROM
 * here, never the reverse (Wave 1/2 pattern). deps.semanticSearch is
 * injected by index.js to preserve that import direction. The only import
 * is pure→pure (CATEGORIES from worker/agent-index.js).
 */

import { CATEGORIES } from './agent-index.js';

export const MCP_PROTOCOL_VERSION = '2025-06-18';

const SERVER_VERSION = '1.0.0';

// Mirrors SOURCE_CITATION in worker/index.js (small duplicate object literal
// — keeping the import direction index.js → pure modules, per the
// agent-index.js precedent).
const SOURCE_CITATION = {
  source: 'ClaudeAtlas',
  source_url: 'https://claudeatlas.com',
  license: 'MIT (catalog metadata); skills retain upstream licenses',
  data_recency: 'Updated daily ~06:30 UTC',
  methodology_url: 'https://claudeatlas.com/methodology/',
  citation_url: 'https://claudeatlas.com/credits/',
  recommended_citation: 'Source: ClaudeAtlas — https://claudeatlas.com',
};

// Reuses the buildAgentIndex description text (duplicated literal — same
// import-direction rationale as SOURCE_CITATION above).
const SITE_DESCRIPTION =
  'Curated discovery index of Claude ecosystem skills, plugins, and MCP servers. Scored on 7 transparent signals; updated daily ~06:30 UTC.';

export const MCP_TOOLS = [
  {
    name: 'search_skills',
    description:
      'Semantic search over the ClaudeAtlas catalog of Claude skills, plugins, and MCP servers.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural-language search query.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          default: 10,
          description: 'Maximum number of results (1-20, default 10).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_skill',
    description: 'Fetch one catalog record by slug.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'Catalog slug, e.g. "author/skill-name".',
        },
      },
      required: ['slug'],
    },
  },
  {
    name: 'get_categories',
    description: 'List the 8 catalog categories.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * buildServerCard() → plain object for GET /.well-known/mcp/server-card.json.
 */
export function buildServerCard() {
  return {
    name: 'ClaudeAtlas',
    description: SITE_DESCRIPTION,
    url: 'https://claudeatlas.com/mcp',
    transport: 'streamable-http',
    protocol_version: MCP_PROTOCOL_VERSION,
    tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
    website: 'https://claudeatlas.com',
    documentation: 'https://claudeatlas.com/llms.txt',
  };
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

const BASE_HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'cache-control': 'no-store',
};

// marker=false only on the -32700 / -32600 paths (body was not a valid
// JSON-RPC envelope, so it must not classify as MCP traffic).
function rpcHttpResponse(payload, { status = 200, marker = true, clientHeader = null } = {}) {
  const headers = { ...BASE_HEADERS };
  if (marker) headers['x-ca-mcp'] = '1';
  if (clientHeader) headers['x-ca-mcp-client'] = clientHeader;
  return new Response(JSON.stringify(payload), { status, headers });
}

function rpcResult(id, result, opts = {}) {
  return rpcHttpResponse({ jsonrpc: '2.0', id, result }, opts);
}

function rpcError(id, code, message, opts = {}) {
  return rpcHttpResponse({ jsonrpc: '2.0', id, error: { code, message } }, opts);
}

// Tool-execution failure → JSON-RPC RESULT with isError (per MCP spec,
// tool errors are results the model can see — NOT protocol errors).
function toolErrorResult(id, text) {
  return rpcResult(id, { content: [{ type: 'text', text }], isError: true });
}

function toolTextResult(id, obj) {
  return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(obj) }] });
}

// Sanitize the clientInfo-derived header value: printable ASCII only,
// truncated to 128 chars.
function sanitizeClientHeader(value) {
  return String(value).replace(/[^\x21-\x7e]/g, '').slice(0, 128);
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function callSearchSkills(id, args, request, env, ctx, deps) {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) {
    return rpcError(id, -32602, 'search_skills requires a non-empty string "query"');
  }
  let limit = 10;
  if (typeof args.limit === 'number' && Number.isFinite(args.limit)) {
    limit = Math.max(1, Math.min(20, Math.trunc(args.limit)));
  }
  if (typeof deps.semanticSearch !== 'function') {
    return toolErrorResult(id, 'search unavailable');
  }

  try {
    // Internal request against the EXISTING search route. Carrying the
    // ORIGINAL request headers preserves cf-connecting-ip continuity, so
    // MCP searches share the same 30/min/IP rate-limit bucket as direct
    // /api/v1/search calls — zero duplicated embed/rate-limit logic.
    const u = new URL(request.url);
    u.pathname = '/api/v1/search';
    u.search = '?q=' + encodeURIComponent(query) + '&k=' + limit;
    const internalReq = new Request(u.toString(), {
      method: 'GET',
      headers: request.headers,
    });
    const res = await deps.semanticSearch(internalReq, env, ctx);

    if (res.status === 429) {
      return toolErrorResult(id, 'rate_limited: retry after 60 seconds');
    }
    if (res.status !== 200) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
        // noop — detail stays empty
      }
      return toolErrorResult(id, `search failed: HTTP ${res.status} ${detail}`.trim());
    }
    const body = await res.json();
    return toolTextResult(id, {
      query: body.query,
      count: body.count,
      results: body.results,
      source: body.source,
    });
  } catch (err) {
    console.error('mcp search_skills error:', err && err.message);
    return toolErrorResult(id, 'search failed: internal error');
  }
}

async function callGetSkill(id, args, env) {
  const slug = typeof args.slug === 'string' ? args.slug.trim() : '';
  if (!slug) {
    return rpcError(id, -32602, 'get_skill requires a non-empty string "slug"');
  }
  if (!env || !env.SKILLS_KV) {
    return toolErrorResult(id, 'catalog unavailable');
  }
  try {
    const raw = await env.SKILLS_KV.get(slug);
    if (!raw) {
      return toolErrorResult(id, `not found: ${slug}`);
    }
    const record = JSON.parse(raw);
    // Trim to the agent-useful subset. body_markdown: prefer the v2
    // EntityRecord extra.* nesting, fall back to the legacy top-level
    // field (same fallback renderListedSkillHtml uses).
    const body =
      (record.extra && record.extra.body_markdown) || record.body_markdown || '';
    const trimmed = {
      slug: record.slug,
      name: record.name,
      description: record.description,
      entity_type: record.entity_type || 'skill',
      quality_score: record.quality_score,
      quality_tier: record.quality_tier,
      category: record.category ?? null,
      tags: record.tags || [],
      repo_full_name: record.repo_full_name,
      repo_url: record.repo_url || `https://github.com/${record.repo_full_name || ''}`,
      repo_stars: record.repo_stars,
      repo_license: record.repo_license ?? null,
      install: `claude install-skill ${record.repo_full_name || ''}`,
      detail_url: `https://claudeatlas.com/skills/${record.slug}/`,
      body_markdown: String(body).slice(0, 1500),
    };
    return toolTextResult(id, trimmed);
  } catch (err) {
    console.error('mcp get_skill error:', err && err.message);
    return toolErrorResult(id, `catalog read failed: ${slug}`);
  }
}

function callGetCategories(id) {
  return toolTextResult(id, { categories: CATEGORIES, source: SOURCE_CITATION });
}

// ---------------------------------------------------------------------------
// handleMcpRequest(request, env, ctx, deps) → Response
// ---------------------------------------------------------------------------

export async function handleMcpRequest(request, env, ctx, deps = {}) {
  // Stateless Streamable HTTP: POST only. No SSE stream (GET), no session
  // termination (DELETE). OPTIONS preflight is handled in index.js.
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({
        error: 'method_not_allowed',
        message:
          'This MCP server is stateless Streamable HTTP: send JSON-RPC 2.0 messages via POST. SSE is not supported.',
      }),
      {
        status: 405,
        headers: { ...BASE_HEADERS, Allow: 'POST, OPTIONS' },
      },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, 'parse error', { status: 400, marker: false });
  }

  // 2025-06-18 removed JSON-RPC batching — reject arrays outright.
  if (Array.isArray(body)) {
    return rpcError(null, -32600, 'invalid request: batching is not supported', {
      marker: false,
    });
  }
  if (!body || typeof body !== 'object' || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    const id =
      body && (typeof body.id === 'string' || typeof body.id === 'number') ? body.id : null;
    return rpcError(id, -32600, 'invalid request', { marker: false });
  }

  const { method, params, id } = body;

  try {
    // Notifications carry NO id (id CAN legitimately be 0 on requests —
    // only `undefined` marks a notification). Acknowledge with 202, no
    // JSON-RPC body.
    if (id === undefined) {
      return new Response(null, {
        status: 202,
        headers: {
          'access-control-allow-origin': '*',
          'cache-control': 'no-store',
          'x-ca-mcp': '1',
        },
      });
    }

    if (method === 'initialize') {
      let clientHeader = null;
      const clientInfo = params && params.clientInfo;
      if (clientInfo && typeof clientInfo === 'object') {
        const name = typeof clientInfo.name === 'string' ? clientInfo.name : '';
        const version = typeof clientInfo.version === 'string' ? clientInfo.version : '';
        const sanitized = sanitizeClientHeader(`${name}/${version}`);
        if (sanitized && sanitized !== '/') clientHeader = sanitized;
      }
      return rpcResult(
        id,
        {
          // Spec-permitted counter-offer: always answer with OUR version
          // regardless of what the client proposed.
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: 'claudeatlas',
            title: 'ClaudeAtlas',
            version: SERVER_VERSION,
          },
          instructions:
            'Search the ClaudeAtlas catalog with search_skills, fetch one record with get_skill, and list the 8 catalog categories with get_categories.',
        },
        { clientHeader },
      );
    }

    if (method === 'ping') {
      return rpcResult(id, {});
    }

    if (method === 'tools/list') {
      return rpcResult(id, { tools: MCP_TOOLS });
    }

    if (method === 'tools/call') {
      const name = params && typeof params.name === 'string' ? params.name : '';
      const args = (params && params.arguments) || {};
      if (name === 'search_skills') {
        return await callSearchSkills(id, args, request, env, ctx, deps);
      }
      if (name === 'get_skill') {
        return await callGetSkill(id, args, env);
      }
      if (name === 'get_categories') {
        return callGetCategories(id);
      }
      return rpcError(id, -32602, `unknown tool: ${name || '(missing name)'}`);
    }

    return rpcError(id, -32601, `method not found: ${method}`);
  } catch (err) {
    // handleMcpRequest itself never rejects — any unexpected throw inside
    // dispatch becomes a JSON-RPC internal error (id preserved).
    console.error('mcp dispatch error:', err && err.message);
    return rpcError(id ?? null, -32603, 'internal error');
  }
}

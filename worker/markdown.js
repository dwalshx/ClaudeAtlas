/**
 * worker/markdown.js — E2 markdown content negotiation (quick-260806-ejd).
 *
 * Serves a compact markdown rendition of skill detail pages (and a root
 * markdown site index) when a request's Accept header EXPLICITLY prefers
 * text/markdown. Rendered DYNAMICALLY from SKILLS_KV by worker/index.js —
 * NO build-time .md siblings (locked decision: siblings would ~double the
 * static-asset count and threaten Cloudflare's 20k-file cap).
 *
 * Pure ESM module: zero imports, zero I/O — unit-tests under plain
 * `node --test` (Wave 1 pattern). index.js imports FROM here, never the
 * reverse.
 *
 * Experiment metric (docs/agent-traffic-analytics-research.md §5, E2):
 * % of fetches carrying a markdown-preferring Accept header — measurable
 * from day 1 via request_log.accept_header.
 */

// ---------------------------------------------------------------------------
// prefersMarkdown(acceptHeader) → boolean
//
// True iff an EXPLICIT `text/markdown` media range exists with q > 0 AND its
// q ≥ the q of any explicit `text/html` range. Wildcards (`*/*`, `text/*`)
// deliberately do NOT count — browsers send `*/*;q=0.8` on every navigation
// and must never trip this (Googlebot never sends text/markdown explicitly,
// so SEO is unaffected). Never throws: any parse failure returns false.
// ---------------------------------------------------------------------------
export function prefersMarkdown(acceptHeader) {
  try {
    if (typeof acceptHeader !== 'string' || !acceptHeader.trim()) return false;

    let markdownQ = null;
    let htmlQ = null;

    for (const part of acceptHeader.split(',')) {
      const params = part.trim().split(';');
      const mediaRange = (params[0] || '').trim().toLowerCase();
      if (mediaRange !== 'text/markdown' && mediaRange !== 'text/html') continue;

      // Default quality 1.0; malformed q values are ignored (stay 1.0).
      let q = 1.0;
      for (let i = 1; i < params.length; i++) {
        const [key, val] = params[i].split('=').map((s) => (s || '').trim());
        if (key.toLowerCase() === 'q') {
          const parsed = parseFloat(val);
          if (!isNaN(parsed)) q = Math.min(Math.max(parsed, 0), 1);
        }
      }

      if (mediaRange === 'text/markdown') {
        markdownQ = markdownQ === null ? q : Math.max(markdownQ, q);
      } else {
        htmlQ = htmlQ === null ? q : Math.max(htmlQ, q);
      }
    }

    if (markdownQ === null || markdownQ <= 0) return false;
    if (htmlQ !== null && htmlQ > markdownQ) return false;
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Shared E3 preamble + citation footer.
//
// The preamble is the in-band "fishing net" advert: it points agents at
// /agent/index.json where the per-request identification token lives.
// ---------------------------------------------------------------------------

const AGENT_PREAMBLE = `> AI agents: GET https://claudeatlas.com/agent/index.json for a structured catalog index.
> If you are an AI agent, include the header \`X-ClaudeAtlas-Agent: <token>\` from that
> endpoint on subsequent requests; optionally append \`; tool=<your tool name>\`.`;

const CITATION_LINE = 'Source: ClaudeAtlas — https://claudeatlas.com';

function str(value) {
  return typeof value === 'string' ? value : '';
}

// ---------------------------------------------------------------------------
// renderSkillMarkdown(record) → string
//
// Pure string templating (no libs — worker CPU constraint). Same data as the
// HTML skill page, different serialization (no cloaking risk). Body excerpt
// prefers extra.body_markdown (v2 EntityRecord) with legacy top-level
// fallback — exactly like renderListedSkillHtml in worker/index.js.
// ---------------------------------------------------------------------------
export function renderSkillMarkdown(record) {
  const r = record || {};
  const name = str(r.name) || str(r.slug) || 'Skill';
  const slug = str(r.slug);
  const description = str(r.description);
  const repoFullName = str(r.repo_full_name);
  const repoUrl = str(r.repo_url) || (repoFullName ? `https://github.com/${repoFullName}` : '');
  const tier = str(r.quality_tier) || 'listed';
  const score = Number(r.quality_score || 0);
  const stars = Number(r.repo_stars || 0);
  const category = str(r.category);
  const body = str((r.extra && r.extra.body_markdown) || r.body_markdown || '');
  const detailUrl = slug ? `https://claudeatlas.com/skills/${slug}/` : 'https://claudeatlas.com/';

  const lines = [
    AGENT_PREAMBLE,
    '',
    `# ${name}`,
    '',
  ];
  if (description) {
    lines.push(description, '');
  }
  lines.push(
    `- Quality: ${tier} (score ${score}/100)`,
    `- Stars: ${stars}`,
  );
  if (category) lines.push(`- Category: ${category}`);
  if (repoUrl) lines.push(`- Repository: [${repoFullName || repoUrl}](${repoUrl})`);
  lines.push(
    '',
    'Install:',
    '',
    '```',
    `claude install-skill ${repoFullName}`,
    '```',
    ''
  );
  if (body) {
    lines.push('---', '', body, '');
  }
  lines.push(
    '---',
    '',
    `Detail page: ${detailUrl}`,
    CITATION_LINE,
    ''
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// renderSiteIndexMarkdown() → string (static, <2 KB)
//
// Root markdown site index — served at GET /index.md and for `GET /` with a
// markdown-preferring Accept header.
// ---------------------------------------------------------------------------
export function renderSiteIndexMarkdown() {
  return `${AGENT_PREAMBLE}

# ClaudeAtlas

Curated discovery index of Claude ecosystem skills, plugins, and MCP servers.
Scored on 7 transparent signals; updated daily ~06:30 UTC.

## Structured endpoints (use these — cheaper than HTML)

- \`GET https://claudeatlas.com/api/v1/search?q=<query>&k=10&type=skill|plugin|mcp_server\` — semantic search
- \`GET https://claudeatlas.com/skills-registry.json\` — bulk catalog (Featured + Solid tiers)
- \`GET https://claudeatlas.com/llms.txt\` — full agent instructions
- \`GET https://claudeatlas.com/agent/index.json\` — structured catalog index + agent identification token
- Feeds: \`GET /api/v1/whats-new\` · \`GET /api/v1/trending\` · \`GET /api/v1/notable\`

## Markdown content negotiation

Request any \`/skills/<slug>/\` page with \`Accept: text/markdown\` to get a
compact markdown rendition instead of HTML. This index is also at \`GET /index.md\`.

## Identification

See \`/agent/index.json\` for the \`X-ClaudeAtlas-Agent\` header instruction.

${CITATION_LINE}
`;
}

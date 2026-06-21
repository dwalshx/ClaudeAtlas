/**
 * ClaudeAtlas Worker badge route (quick-260621-cvm)
 *
 * Generates /badge/{slug}.svg (tier pill) and /badge/{slug}-history.svg
 * (star-history chart) per-request, replacing the ~18k static SVG files the
 * old prebuild generator (scripts/generate-badges.js, deleted) emitted into
 * public/badge/. Halving the deploy file count clears the
 * assets-upload-session -> 504 that was blocking ALL deploys.
 *
 * The SVG builders (buildTierBadgeSvg, buildStarHistoryChartSvg) and their
 * helpers (escapeXml, textWidth, validateSlug, TIER_COLORS, SITE_URL,
 * REF_PARAM) are ported VERBATIM from generate-badges.js:38-207. They are
 * pure string builders with zero Node deps, so they run unchanged in the
 * Workers runtime AND produce byte-identical output to the old static files.
 *
 * Data sources:
 *   - Tier: env.SKILLS_KV.get(slug) -> JSON record (quality_tier/name/slug).
 *           KV miss synthesizes a 'listed' record (NEVER 404 a hotlink).
 *   - Star history: the bundled `starHistory` map (data/badge-star-history.json),
 *           pre-downsampled to <=61 pts/repo by generate-badge-data.js.
 */

// ===========================================================================
// VERBATIM port from scripts/generate-badges.js:38-207 — DO NOT REFORMAT.
// Byte-identical SVG output is a HARD requirement.
// ===========================================================================

const SITE_URL = 'https://claudeatlas.com';
const REF_PARAM = '?ref=badge';

const TIER_COLORS = {
  featured: { bg: '#f59e0b', text: '#0f172a', label: 'Featured' },
  solid: { bg: '#10b981', text: '#0f172a', label: 'Solid' },
  listed: { bg: '#6b7280', text: '#ffffff', label: 'Listed' },
};

// --- Utilities ---

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Approximate text width in a 11px sans-serif font. shields.io uses 11px DejaVu
// Sans, roughly 7px per character, which is close enough for our purposes.
function textWidth(text, charWidth = 7) {
  return text.length * charWidth + 10;
}

function validateSlug(slug) {
  if (!slug || typeof slug !== 'string') return false;
  if (slug.includes('..')) return false;
  if (slug.startsWith('/')) return false;
  if (slug.includes('\\')) return false;
  return true;
}

// --- Tier badge (DIST-01) ---

function buildTierBadgeSvg(skill) {
  const tier = skill.quality_tier || 'listed';
  const cfg = TIER_COLORS[tier] || TIER_COLORS.listed;

  const leftLabel = 'claudeatlas';
  const rightLabel = cfg.label;
  const leftColor = '#1f2937';     // gray-800
  const leftTextColor = '#ffffff';
  const rightColor = cfg.bg;
  const rightTextColor = cfg.text;

  const padding = 6;
  const leftWidth = textWidth(leftLabel, 6.5) + padding;
  const rightWidth = textWidth(rightLabel, 6.5) + padding;
  const totalWidth = leftWidth + rightWidth;
  const height = 20;
  const radius = 3;

  const detailUrl = `${SITE_URL}/skills/${skill.slug}/${REF_PARAM}`;

  // Subtle gradient overlay is standard for shields.io look
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}" height="${height}" role="img" aria-label="claudeatlas: ${escapeXml(cfg.label)}">
  <title>ClaudeAtlas: ${escapeXml(cfg.label)} — ${escapeXml(skill.name || skill.slug)}</title>
  <linearGradient id="smooth" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="round">
    <rect width="${totalWidth}" height="${height}" rx="${radius}" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#round)">
    <rect width="${leftWidth}" height="${height}" fill="${leftColor}"/>
    <rect x="${leftWidth}" width="${rightWidth}" height="${height}" fill="${rightColor}"/>
    <rect width="${totalWidth}" height="${height}" fill="url(#smooth)"/>
  </g>
  <g fill="${leftTextColor}" text-anchor="middle" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11">
    <text x="${leftWidth / 2}" y="15">${escapeXml(leftLabel)}</text>
  </g>
  <g fill="${rightTextColor}" text-anchor="middle" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11">
    <text x="${leftWidth + rightWidth / 2}" y="15" font-weight="bold">${escapeXml(rightLabel)}</text>
  </g>
  <a xlink:href="${escapeXml(detailUrl)}" target="_blank">
    <rect width="${totalWidth}" height="${height}" fill="transparent"/>
  </a>
</svg>`;
}

// --- Star history chart (DIST-02) ---

function buildStarHistoryChartSvg(events, skill) {
  const width = 480;
  const height = 120;
  const padding = { top: 10, right: 12, bottom: 20, left: 40 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  // Fallback: not enough data
  if (!events || events.length < 5) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="Star history placeholder">
  <title>ClaudeAtlas — not enough star history for ${escapeXml(skill.name || skill.slug)} yet</title>
  <rect width="${width}" height="${height}" fill="#0f172a"/>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" fill="none" stroke="#1f2937" stroke-width="1"/>
  <text x="${width / 2}" y="${height / 2 + 4}" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="13" fill="#9ca3af">Not enough history yet</text>
  <text x="${width / 2}" y="${height / 2 + 22}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="9" fill="#6b7280">claudeatlas.com</text>
</svg>`;
  }

  // Normalize to {t, c} where t is ms, c is star count
  const pts = events
    .map(e => {
      const t = Date.parse(e.t || e.timestamp || e.starred_at);
      const c = typeof e.c === 'number' ? e.c : (typeof e.star_count === 'number' ? e.star_count : null);
      return { t, c };
    })
    .filter(p => !isNaN(p.t) && p.c !== null)
    .sort((a, b) => a.t - b.t);

  if (pts.length < 5) return buildStarHistoryChartSvg([], skill); // fallback

  // Downsample to ~60 points
  const TARGET = 60;
  let sampled = pts;
  if (pts.length > TARGET) {
    const step = pts.length / TARGET;
    sampled = [];
    for (let i = 0; i < TARGET; i++) {
      sampled.push(pts[Math.floor(i * step)]);
    }
    // Always include the last point
    if (sampled[sampled.length - 1] !== pts[pts.length - 1]) {
      sampled.push(pts[pts.length - 1]);
    }
  }

  const tMin = sampled[0].t;
  const tMax = sampled[sampled.length - 1].t;
  const cMax = Math.max(...sampled.map(p => p.c));
  const cMin = 0;

  const xScale = (t) => padding.left + ((t - tMin) / Math.max(1, tMax - tMin)) * plotW;
  const yScale = (c) => padding.top + plotH - ((c - cMin) / Math.max(1, cMax - cMin)) * plotH;

  // Build line path
  let pathD = '';
  sampled.forEach((p, i) => {
    pathD += (i === 0 ? 'M' : 'L') + xScale(p.t).toFixed(1) + ',' + yScale(p.c).toFixed(1) + ' ';
  });

  // Build fill path (line + base)
  let fillD = pathD + `L${xScale(tMax).toFixed(1)},${(padding.top + plotH).toFixed(1)} L${xScale(tMin).toFixed(1)},${(padding.top + plotH).toFixed(1)} Z`;

  const firstDate = new Date(tMin).toISOString().slice(0, 10);
  const lastDate = new Date(tMax).toISOString().slice(0, 10);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="Star history for ${escapeXml(skill.name || skill.slug)}">
  <title>ClaudeAtlas — star history for ${escapeXml(skill.name || skill.slug)} (${cMax} stars)</title>
  <rect width="${width}" height="${height}" fill="#0f172a"/>
  <line x1="${padding.left}" y1="${padding.top + plotH / 2}" x2="${width - padding.right}" y2="${padding.top + plotH / 2}" stroke="#1f2937" stroke-width="1" stroke-dasharray="2,3"/>
  <path d="${fillD}" fill="#f59e0b" fill-opacity="0.15"/>
  <path d="${pathD}" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  <text x="${padding.left}" y="${height - 6}" font-family="ui-monospace, monospace" font-size="9" fill="#6b7280">${firstDate}</text>
  <text x="${width - padding.right}" y="${height - 6}" text-anchor="end" font-family="ui-monospace, monospace" font-size="9" fill="#6b7280">${lastDate}</text>
  <text x="${padding.left - 4}" y="${padding.top + 8}" text-anchor="end" font-family="ui-monospace, monospace" font-size="9" fill="#9ca3af">${cMax}</text>
  <text x="${padding.left - 4}" y="${padding.top + plotH}" text-anchor="end" font-family="ui-monospace, monospace" font-size="9" fill="#6b7280">0</text>
</svg>`;
}

// ===========================================================================
// End verbatim port. Worker-only handler below.
// ===========================================================================

const SVG_HEADERS_BASE = {
  'content-type': 'image/svg+xml; charset=utf-8',
  'cache-control': 'public, max-age=86400, s-maxage=86400',
  'access-control-allow-origin': '*',
};

/**
 * Per-request badge handler. Dispatched from worker/index.js for any
 * /badge/*.svg path.
 *
 * @param {URL} url            the already-parsed request URL
 * @param {object} env         Worker env (needs env.SKILLS_KV)
 * @param {object} starHistory bundled { "<repo>": [[tsMs, count], ...] } map
 * @returns {Promise<Response>}
 */
export async function handleBadge(url, env, starHistory) {
  // Strip the `/badge/` prefix and the trailing `.svg`. Everything between
  // is the slug (possibly multi-segment, e.g. "microsoft/skills/azure").
  let rest = url.pathname.slice('/badge/'.length);
  if (rest.endsWith('.svg')) rest = rest.slice(0, -'.svg'.length);

  // Detect the `-history` suffix BEFORE decoding so a slug containing a
  // literal "-history" segment isn't mis-split. CRITICAL: do NOT split on
  // '/' — multi-segment slugs are common (815 slugs).
  let isHistory = false;
  let slug = rest;
  if (rest.endsWith('-history')) {
    isHistory = true;
    slug = rest.slice(0, -'-history'.length);
  }

  slug = decodeURIComponent(slug);

  if (!validateSlug(slug)) {
    return new Response('Bad Request', { status: 400 });
  }

  // Resolve the skill record from KV. On miss, synthesize a 'listed' record
  // so a hotlink to an unknown slug renders a badge rather than a 404.
  let skill = null;
  if (env && env.SKILLS_KV) {
    try {
      const raw = await env.SKILLS_KV.get(slug);
      if (raw) {
        try { skill = JSON.parse(raw); } catch { skill = null; }
      }
    } catch (err) {
      console.error('badge SKILLS_KV.get failed:', err && err.message);
      skill = null;
    }
  }
  if (!skill) {
    skill = { slug, name: slug, quality_tier: 'listed' };
  }

  let svg;
  if (isHistory) {
    // Look up the bundled star-history series for this skill's repo and
    // convert the compact [tsMs, count] pairs into the {t, c} shape the
    // ported builder expects. No repo (or unknown repo) -> [] -> placeholder.
    let events = [];
    const repo = skill.repo_full_name;
    if (repo && starHistory && Array.isArray(starHistory[repo])) {
      events = starHistory[repo].map(([t, c]) => ({ t, c }));
    }
    svg = buildStarHistoryChartSvg(events, skill);
  } else {
    svg = buildTierBadgeSvg(skill);
  }

  return new Response(svg, {
    headers: {
      ...SVG_HEADERS_BASE,
      // Weak ETag keyed on body length — cheap, good enough for conditional
      // requests against an immutable-per-day SVG.
      ETag: `W/"${svg.length}"`,
    },
  });
}

#!/usr/bin/env node

/**
 * ClaudeAtlas Badge Generator
 *
 * Build-time script (invoked via `prebuild` npm script) that writes a
 * static SVG badge and a star-history chart SVG for every indexed skill.
 *
 * Outputs:
 *   public/badge/[author]/[skill].svg           — shields.io-style tier pill
 *   public/badge/[author]/[skill]-history.svg   — star-history line chart
 *                                                 (falls back to "Not enough
 *                                                  history yet" placeholder)
 *
 * Reads:
 *   data/skills.json                   — the curated catalog (required)
 *   data/star-history.json             — star history backfill (optional)
 *   data/history/*.json                — daily snapshots (optional)
 *
 * Astro copies public/ to dist/ verbatim, so the SVGs end up at
 * https://claudeatlas.com/badge/[author]/[skill].svg after deploy.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadSkillsArray } from './lib/skills-stream.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const HISTORY_DIR = join(DATA_DIR, 'history');
// T5: NDJSON. Reads use loadSkillsArray() (handles legacy fallback).
const SKILLS_PATH = join(DATA_DIR, 'skills.ndjson');
const STAR_HISTORY_PATH = join(DATA_DIR, 'star-history.json');
const OUTPUT_DIR = join(ROOT, 'public', 'badge');

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

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function log(msg) {
  console.log(`[badges] ${msg}`);
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

// --- History snapshot loader ---

function loadHistorySnapshotsForRepo(repoFullName) {
  if (!existsSync(HISTORY_DIR)) return [];
  const out = [];
  for (const file of readdirSync(HISTORY_DIR).sort()) {
    if (!file.endsWith('.json')) continue;
    try {
      const snap = JSON.parse(readFileSync(join(HISTORY_DIR, file), 'utf-8'));
      const entry = snap.repos?.[repoFullName];
      if (entry && typeof entry.s === 'number') {
        out.push({ t: snap.timestamp || new Date(snap.date + 'T00:00:00Z').toISOString(), c: entry.s });
      }
    } catch {
      // skip malformed snapshots
    }
  }
  return out;
}

// --- Main ---

function main() {
  log('=== badge generator start ===');

  // T5: loadSkillsArray() handles NDJSON + legacy fallback.
  let skills;
  try {
    skills = loadSkillsArray();
  } catch (err) {
    console.error(`[badges] ERROR: ${err.message}`);
    process.exit(1);
  }
  log(`loaded ${skills.length} skills`);

  // Load star history if available
  let starHistory = null;
  if (existsSync(STAR_HISTORY_PATH)) {
    try {
      starHistory = JSON.parse(readFileSync(STAR_HISTORY_PATH, 'utf-8'));
      const repoCount = Object.keys(starHistory.repos || {}).length;
      log(`loaded star history for ${repoCount} repos`);
    } catch (err) {
      log(`WARN: could not parse ${STAR_HISTORY_PATH}: ${err.message}`);
      starHistory = null;
    }
  } else {
    log('no star-history.json found — star charts will render fallback placeholders');
  }

  // Clean output dir to prevent stale badges hanging around
  if (existsSync(OUTPUT_DIR)) {
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  ensureDir(OUTPUT_DIR);

  let tierWritten = 0;
  let historyWritten = 0;
  let skipped = 0;

  for (const skill of skills) {
    if (!validateSlug(skill.slug)) {
      skipped++;
      continue;
    }

    const [author, ...nameParts] = skill.slug.split('/');
    const skillName = nameParts.join('/');
    if (!author || !skillName) {
      skipped++;
      continue;
    }

    const authorDir = join(OUTPUT_DIR, author);
    ensureDir(authorDir);

    // Tier badge
    const tierSvg = buildTierBadgeSvg(skill);
    writeFileSync(join(authorDir, `${skillName}.svg`), tierSvg, 'utf-8');
    tierWritten++;

    // Star history chart
    let events = [];
    if (starHistory && starHistory.repos && starHistory.repos[skill.repo_full_name]) {
      const entry = starHistory.repos[skill.repo_full_name];
      if (entry.events && Array.isArray(entry.events)) {
        events = entry.events;
      }
    }
    // Merge in daily snapshots if available (these cover the time since the backfill)
    const snapshotEvents = loadHistorySnapshotsForRepo(skill.repo_full_name);
    if (snapshotEvents.length > 0) {
      // Snapshots are chronological and already have {t, c} shape
      events = [...events, ...snapshotEvents];
    }

    const historySvg = buildStarHistoryChartSvg(events, skill);
    writeFileSync(join(authorDir, `${skillName}-history.svg`), historySvg, 'utf-8');
    historyWritten++;
  }

  log(`wrote ${tierWritten} tier badges, ${historyWritten} history charts, skipped ${skipped}`);
  log('=== badge generator complete ===');
}

main();

#!/usr/bin/env node

/**
 * ClaudeAtlas Machine-Readable Registry
 *
 * Build-time script that emits public/skills-registry.json — a compact,
 * agent-facing catalog of every indexed skill. Gets served at
 * https://claudeatlas.com/skills-registry.json after deploy.
 *
 * This is Phase 1.5's answer to the Phase 2 query API: a simple static
 * bulk file that any tool can fetch once and parse locally. Costs nothing
 * at the edge, caches forever (content-addressed-ish via daily rebuilds).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadSkillsArray } from './lib/skills-stream.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
// T5: NDJSON. Reads use loadSkillsArray() (handles legacy fallback).
const SKILLS_PATH = join(DATA_DIR, 'skills.ndjson');
const STATS_PATH = join(DATA_DIR, 'pipeline-stats.json');
const PUBLIC_DIR = join(ROOT, 'public');
const OUTPUT_PATH = join(PUBLIC_DIR, 'skills-registry.json');

const API_GRAPH_PATH = join(DATA_DIR, 'api-graph.json');
const SITE_URL = 'https://claudeatlas.com';

function log(msg) {
  console.log(`[registry] ${msg}`);
}

function main() {
  log('=== registry generator start ===');

  // T5: loadSkillsArray() handles NDJSON + legacy fallback.
  let skills;
  try {
    skills = loadSkillsArray();
  } catch (err) {
    console.error(`[registry] ERROR: ${err.message}`);
    process.exit(1);
  }

  // Load API graph for integrations enrichment
  let apiGraph = { skill_integrations: {} };
  if (existsSync(API_GRAPH_PATH)) {
    try {
      apiGraph = JSON.parse(readFileSync(API_GRAPH_PATH, 'utf-8'));
    } catch {}
  }

  let stats = {};
  if (existsSync(STATS_PATH)) {
    try {
      stats = JSON.parse(readFileSync(STATS_PATH, 'utf-8'));
    } catch {
      stats = {};
    }
  }

  const totalFeatured = skills.filter(s => s.quality_tier === 'featured').length;
  const totalSolid = skills.filter(s => s.quality_tier === 'solid').length;
  const totalListed = skills.filter(s => s.quality_tier === 'listed').length;

  // Phase 3.1.x: registry is filtered to renderable tiers (Featured + Solid)
  // because the full ~35k+ catalog produces a ~35MB JSON file that exceeds
  // Cloudflare Workers Static Assets' 25 MB per-asset cap. Listed-tier records
  // are discoverable via /api/v1/search (semantic search), via /browse (flat
  // anchor list), or by downloading the full skills.ndjson from the
  // skills-latest GitHub release asset (`bulk_download_url` below). The
  // registry remains the canonical "agents fetch one file, parse, done"
  // surface for the curated subset; full-catalog consumers have a clear path.
  // Future: Phase 3.x sharding (/skills-registry/{a,b,c}.json) once catalog
  // grows past ~14k renderable.
  const renderableEntries = skills.filter(s => s.quality_tier === 'featured' || s.quality_tier === 'solid');

  const entries = renderableEntries.map(s => ({
    name: s.name,
    slug: s.slug,
    description: s.description || null,
    category: s.category,
    quality_tier: s.quality_tier,
    quality_score: s.quality_score,
    install_command: `claude install-skill ${s.repo_full_name}`,
    repo_full_name: s.repo_full_name,
    repo_url: s.repo_url,
    repo_stars: s.repo_stars || 0,
    repo_license: s.repo_license || null,
    repo_pushed_at: s.repo_pushed_at || null,
    skill_first_commit_at: s.skill_first_commit_at || null,
    integrations: apiGraph.skill_integrations?.[s.slug] || [],
    detail_url: `${SITE_URL}/skills/${s.slug}/`,
    badge_url: `${SITE_URL}/badge/${s.slug}.svg`,
    star_history_url: `${SITE_URL}/badge/${s.slug}-history.svg`,
    integrations_url: `${SITE_URL}/apis/`,
  }));

  const registry = {
    name: 'ClaudeAtlas',
    url: SITE_URL,
    methodology_url: `${SITE_URL}/methodology/`,
    generated_at: new Date().toISOString(),
    count: entries.length,
    // Phase 3.1.x: catalog totals reflect FULL catalog; `count` reflects
    // the renderable subset actually included in `skills` below.
    catalog_total: skills.length,
    subset: 'renderable',
    subset_note: 'This file contains only Featured + Solid tier skills (~14k records). The full catalog (~35k including Listed tier) is available via /api/v1/search (semantic) or the GitHub release at `bulk_download_url` (NDJSON, one record per line).',
    bulk_download_url: 'https://github.com/dwalshx/ClaudeAtlas/releases/download/skills-latest/skills.ndjson',
    search_api_url: `${SITE_URL}/api/v1/search`,
    browse_url: `${SITE_URL}/browse/`,
    total_discovered: stats.total_discovered || skills.length,
    total_featured: totalFeatured,
    total_solid: totalSolid,
    total_listed: totalListed,
    categories: [...new Set(entries.map(e => e.category))].sort(),
    schema_version: '2',
    schema_notes: 'Phase 3.1.x — filtered to renderable tiers due to 25MB asset cap. Full catalog via /api/v1/search or bulk_download_url.',
    skills: entries,
  };

  if (!existsSync(PUBLIC_DIR)) mkdirSync(PUBLIC_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(registry), 'utf-8');

  const size = JSON.stringify(registry).length;
  log(`wrote ${OUTPUT_PATH} (${entries.length} of ${skills.length} skills, ${(size / 1024).toFixed(1)} KB)`);
  // Defense in depth: hard-fail if we trip the 25MB Cloudflare cap. The
  // tier filter above SHOULD keep us under, but if catalog growth or a
  // tier-distribution shift pushes us over, fail fast at build time
  // rather than at wrangler deploy time (which produced two failed
  // production runs on 2026-05-27 before this guard was added).
  const CF_ASSET_CAP_BYTES = 25 * 1024 * 1024;
  if (size >= CF_ASSET_CAP_BYTES) {
    console.error(`[registry] FATAL: ${OUTPUT_PATH} is ${(size / 1024 / 1024).toFixed(1)} MB; Cloudflare Static Assets cap is 25 MB.`);
    console.error('[registry] Tighten the tier filter, shard the registry, or move to a Worker route.');
    process.exit(1);
  }
  log('=== registry generator complete ===');
}

main();

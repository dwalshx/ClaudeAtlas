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

  const entries = skills.map(s => ({
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
    total_discovered: stats.total_discovered || entries.length,
    total_featured: totalFeatured,
    total_solid: totalSolid,
    total_listed: totalListed,
    categories: [...new Set(entries.map(e => e.category))].sort(),
    schema_version: '1',
    schema_notes: 'Phase 1.5 bulk catalog. A query API lives at /api/v1/search in a future release.',
    skills: entries,
  };

  if (!existsSync(PUBLIC_DIR)) mkdirSync(PUBLIC_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(registry), 'utf-8');

  const size = JSON.stringify(registry).length;
  log(`wrote ${OUTPUT_PATH} (${entries.length} skills, ${(size / 1024).toFixed(1)} KB)`);
  log('=== registry generator complete ===');
}

main();

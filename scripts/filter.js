#!/usr/bin/env node

/**
 * Post-process the raw skills.json to produce a curated index.
 *
 * Filters:
 * 1. Mega-repo cap: max N skills per repo (prevents marketplace dump dominance)
 * 2. Minimum stars: must have at least N stars
 * 3. Minimum body length: SKILL.md must be substantive
 * 4. AI-slop detection: filter obvious generated garbage
 * 5. Tier recalibration: Featured 90+, Solid 70-89, Listed <70
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RAW_PATH = join(ROOT, 'data', 'skills-raw.json');  // Always read from raw
const OUTPUT_PATH = join(ROOT, 'data', 'skills.json');

// --- Config ---
const CONFIG = {
  MAX_PER_REPO: 2,       // Max skills per repo (tighter — more diversity)
  MIN_STARS: 10,         // Minimum repo stars
  MIN_BODY_LENGTH: 500,  // Minimum SKILL.md body length (chars)
  FEATURED_THRESHOLD: 90,
  SOLID_THRESHOLD: 70,
};

// Placeholder/template skill names and descriptions
const TEMPLATE_NAMES = new Set([
  'agent-name', 'skill-name', 'example', 'example-skill', 'template',
  'my-skill', 'sample', 'sample-skill', 'untitled', 'new-skill',
  'placeholder', 'test', 'test-skill', 'hello-world', 'default',
]);

const PLACEHOLDER_DESC_PATTERNS = [
  /^one paragraph describing/i,
  /^describe what this/i,
  /^your description here/i,
  /^\[.*\]/,  // Starts with a bracket placeholder
  /^brief description of/i,
  /^this is a (sample|test|placeholder|template)/i,
];

// Business-domain AI slop patterns (auto-generated templates)
const BIZ_SLOP_PATTERNS = [
  /^(carrier|customs|energy|inventory|logistics|production|quality|returns|warehouse|fleet|freight|procurement|supply-chain|vendor|contract|compliance|audit|risk|incident|outage|regulatory)-/,
  /-management$/,
  /-compliance$/,
  /-optimization$/,
];

function isSlop(skill) {
  const name = (skill.name || '').toLowerCase();
  const desc = (skill.description || '').toLowerCase();

  // Template/placeholder name
  if (TEMPLATE_NAMES.has(name)) return true;

  // Placeholder description
  for (const pattern of PLACEHOLDER_DESC_PATTERNS) {
    if (pattern.test(desc)) return true;
  }

  // Body too short (stricter now)
  if (skill.body_length < CONFIG.MIN_BODY_LENGTH) return true;

  // Missing both name and description in frontmatter
  if (!skill.has_name && !skill.has_description) return true;

  // Business slop: repos that dump generic business-domain templates
  // Filter aggressively — these are almost always AI-generated
  for (const pattern of BIZ_SLOP_PATTERNS) {
    if (pattern.test(name)) return true;
  }

  return false;
}

// Deduplicate by base name (remove language variants like -ar, -de, -es)
function deduplicateLanguageVariants(skills) {
  const seen = new Map();
  const LANG_SUFFIXES = /-(ar|de|es|fr|ja|ko|pt|ru|zh|zh-cn|zh-tw|zhs|zht|it|nl|pl|tr|hi|id|vi|th|sv|da|no|fi|cs|el|he|uk)$/i;

  for (const skill of skills) {
    const baseName = skill.name.replace(LANG_SUFFIXES, '');
    const key = `${skill.repo_full_name}/${baseName}`;
    const existing = seen.get(key);
    if (!existing || skill.name === baseName || skill.quality_score > existing.quality_score) {
      seen.set(key, skill);
    }
  }
  return [...seen.values()];
}

function main() {
  console.log('=== ClaudeAtlas Filter ===');
  console.log(`Loading raw skills...`);

  const raw = JSON.parse(readFileSync(RAW_PATH, 'utf-8'));
  console.log(`Raw skills: ${raw.length}`);

  // --- Step 1: Filter by repo stars and AI slop ---
  let filtered = raw.filter(s => {
    if (s.repo_stars < CONFIG.MIN_STARS) return false;
    if (isSlop(s)) return false;
    return true;
  });
  console.log(`After stars (>=${CONFIG.MIN_STARS}) + slop filters: ${filtered.length}`);

  // --- Step 1b: Deduplicate language variants ---
  filtered = deduplicateLanguageVariants(filtered);
  console.log(`After language variant dedup: ${filtered.length}`);

  // --- Step 2: Cap per repo ---
  const byRepo = {};
  for (const s of filtered) {
    if (!byRepo[s.repo_full_name]) byRepo[s.repo_full_name] = [];
    byRepo[s.repo_full_name].push(s);
  }

  const capped = [];
  for (const [repo, skills] of Object.entries(byRepo)) {
    skills.sort((a, b) => b.quality_score - a.quality_score);
    capped.push(...skills.slice(0, CONFIG.MAX_PER_REPO));
  }
  console.log(`After per-repo cap (max ${CONFIG.MAX_PER_REPO}): ${capped.length}`);

  // --- Step 3: Recalibrate tiers ---
  for (const s of capped) {
    if (s.quality_score >= CONFIG.FEATURED_THRESHOLD) s.quality_tier = 'featured';
    else if (s.quality_score >= CONFIG.SOLID_THRESHOLD) s.quality_tier = 'solid';
    else s.quality_tier = 'listed';
  }

  // --- Step 4: Sort by score, then stars, then recency ---
  capped.sort((a, b) => {
    if (b.quality_score !== a.quality_score) return b.quality_score - a.quality_score;
    if (b.repo_stars !== a.repo_stars) return b.repo_stars - a.repo_stars;
    return new Date(b.repo_pushed_at) - new Date(a.repo_pushed_at);
  });

  // --- Step 4b: Trim body_markdown for committed output (keep 1500 chars preview) ---
  for (const s of capped) {
    if (s.body_markdown && s.body_markdown.length > 1500) {
      s.body_markdown = s.body_markdown.substring(0, 1500) + '...';
    }
    // Drop ETag fields — not needed in output
    delete s.etag_repo;
    delete s.etag_content;
    delete s.consecutive_404s;
  }

  // --- Stats ---
  const tiers = {
    featured: capped.filter(s => s.quality_tier === 'featured').length,
    solid: capped.filter(s => s.quality_tier === 'solid').length,
    listed: capped.filter(s => s.quality_tier === 'listed').length,
  };

  const categories = {};
  for (const s of capped) {
    categories[s.category] = (categories[s.category] || 0) + 1;
  }

  const uniqueRepos = new Set(capped.map(s => s.repo_full_name)).size;

  console.log();
  console.log('=== Final Results ===');
  console.log(`Total skills: ${capped.length}`);
  console.log(`Unique repos: ${uniqueRepos}`);
  console.log(`Tiers: ${tiers.featured} Featured, ${tiers.solid} Solid, ${tiers.listed} Listed`);
  console.log(`Categories:`);
  for (const [cat, count] of Object.entries(categories).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }

  // Write filtered output
  writeFileSync(OUTPUT_PATH, JSON.stringify(capped, null, 2), 'utf-8');
  console.log(`\nWritten to ${OUTPUT_PATH}`);

  // Also update the stats file
  const STATS_PATH = join(ROOT, 'data', 'pipeline-stats.json');
  const stats = {
    timestamp: new Date().toISOString(),
    total_discovered: raw.length,
    total_skills: capped.length,
    unique_repos: uniqueRepos,
    tiers,
    categories,
    filter_config: CONFIG,
  };
  writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2), 'utf-8');
}

main();

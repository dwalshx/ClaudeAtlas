/**
 * src/lib/entities.js — F2 polymorphic loader (source of truth).
 *
 * Phase 3.1.2 (F2) — Polymorphic Entity Envelope.
 *
 * Replaces src/lib/skills.js as the canonical data-loader after F2 lands.
 * src/lib/skills.js becomes a 30-line re-export shim during the cutover
 * window (D+0 → D+7); the shim is deleted in the cutover commit.
 *
 * Critical: this loader USES F1 Rev 3's `loadAllSkillsMemo` (per X2 — do
 * NOT parallel-implement NDJSON reading). All records pass through the
 * upcaster so downstream code sees v2 EntityRecord<SkillExtra> regardless
 * of what's on disk.
 */

import { readFileSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAllSkillsMemo } from '../../scripts/lib/skills-stream.js';
import { resolveSkillsNdjsonPath } from '../../scripts/lib/build-input.js';
import { upcastRecord } from '../../scripts/lib/legacy-skill-reader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// F7: defensive sniff against pre-F1 JSON-array file. F1 already migrated
// skills.json → skills.ndjson; this is belt-and-braces against accidental
// regression.
function sniffNotJsonArray(path) {
  if (!existsSync(path)) return;
  // Cheap 1-byte sniff (avoid materializing the whole file).
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(1);
    readSync(fd, buf, 0, 1, 0);
    const firstByte = buf.toString('utf-8');
    if (firstByte === '[') {
      throw new Error(
        'pre-F1 JSON-array data/skills.json detected — re-run npm run filter ' +
          'or fetch the latest release asset (skills-latest). F2 assumes NDJSON input.',
      );
    }
  } finally {
    closeSync(fd);
  }
}

const SKILLS_PATH = resolveSkillsNdjsonPath();
sniffNotJsonArray(SKILLS_PATH);

// F1 Rev 3 — loadAllSkillsMemo handles header-line skipping internally
// (via readNdjsonRecords's _header filter). The result is plain v1 or v2
// records; we upcast all to v2 in memory.
const rawRecords = loadAllSkillsMemo(SKILLS_PATH);
const allEntities = rawRecords.map(upcastRecord);

// Sidecars (similar-skills + api-graph). Bounded JSON reads — allowlisted
// in scripts/check-banned-patterns.js (same as src/lib/skills.js:21,30).
let similarSkillsData = { similar: {} };
const __similar_path = join(__dirname, '../../data/similar-skills.json');
if (existsSync(__similar_path)) {
  try {
    similarSkillsData = JSON.parse(readFileSync(__similar_path, 'utf-8'));
  } catch {
    // Degrade gracefully
  }
}

let apiGraphData = { services: {}, skill_integrations: {} };
const __api_graph_path = join(__dirname, '../../data/api-graph.json');
if (existsSync(__api_graph_path)) {
  try {
    apiGraphData = JSON.parse(readFileSync(__api_graph_path, 'utf-8'));
  } catch {
    // Degrade gracefully
  }
}

// ---------------------------------------------------------------------------
// Polymorphic loader API
// ---------------------------------------------------------------------------

/**
 * Return every EntityRecord (all entity_types, post-upcast).
 *
 * @returns {any[]}
 */
export function loadEntities() {
  return allEntities;
}

/**
 * Return entities filtered by entity_type.
 *
 * @param {string} entity_type
 * @returns {any[]}
 */
export function getEntitiesByType(entity_type) {
  return allEntities.filter((e) => e && e.entity_type === entity_type);
}

/**
 * Return a single entity by id, or null.
 *
 * @param {string} id
 * @returns {any | null}
 */
export function getEntityById(id) {
  return allEntities.find((e) => e && e.id === id) || null;
}

/**
 * Top-N entities by quality_score (any entity_type).
 *
 * @param {number} [limit=10]
 * @returns {any[]}
 */
export function getTopEntities(limit = 10) {
  return [...allEntities]
    .filter(notDuplicate)
    .sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0))
    .slice(0, limit);
}

/**
 * Return every entity carrying a specific tag (e.g. 'category:ai-and-automation').
 *
 * @param {string} tag
 * @returns {any[]}
 */
export function getEntitiesByTag(tag) {
  if (!tag) return [];
  return allEntities.filter((e) => Array.isArray(e?.tags) && e.tags.includes(tag));
}

/**
 * Return the union of every tag observed across all entities, with counts.
 *
 * @returns {{ tag: string, count: number }[]}
 */
export function getAllTags() {
  const counts = new Map();
  for (const e of allEntities) {
    if (!Array.isArray(e?.tags)) continue;
    for (const t of e.tags) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return [...counts.entries()].map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Skill-scoped back-compat helpers (delegate to entity_type==='skill')
//
// During the cutover window (D+0 → D+7), the upcaster preserves legacy flat
// fields so existing consumers reading `skill.body_markdown` etc. keep
// working. Consumers should migrate to `entity.extra.*` per T7/T7.5/T8.
// ---------------------------------------------------------------------------

/**
 * Phase 3.1 duplicate filter (preserved from src/lib/skills.js).
 *
 * Three states for is_duplicate:
 *   - true:  hide from default browse
 *   - false: assessed and clean → show
 *   - null/undefined: not yet assessed → show (default-permissive)
 */
function notDuplicate(e) {
  return e?.is_duplicate !== true;
}

/** @returns {any[]} */
export function getSkills() {
  return getEntitiesByType('skill');
}

/** @param {string} slug @returns {any|null} */
export function getSkillBySlug(slug) {
  // No notDuplicate filter — direct-URL access must resolve to a duplicate's
  // page (preserves Phase 3.1 behaviour).
  return getSkills().find((s) => s.slug === slug) || null;
}

export const allSkills = getSkills();

/**
 * Per-repo diversity cap (SELECTION/RENDER-ONLY).
 *
 * Given entities already in PRIORITY ORDER (highest-priority first — e.g.
 * sorted by quality_score desc), return a NEW array in which no more than
 * `maxPerRepo` entries share the same `repo_full_name`. Order is preserved;
 * overflow entries past the cap are dropped. Entities lacking a
 * `repo_full_name` are never grouped and always kept.
 *
 * This is a display concern only — it never mutates scores, tiers, or the
 * underlying records. It exists so a single mega-repo can't monopolise the
 * homepage's small, curated card grids (Featured strip + Top-N grid) while
 * lower-ranked-but-distinct authors get squeezed out.
 *
 * @param {any[]} entities  pre-sorted entities (highest priority first)
 * @param {number} [maxPerRepo=2]  max entries allowed per repo_full_name
 * @returns {any[]} filtered copy, order preserved
 */
export function capPerRepo(entities, maxPerRepo = 2) {
  if (!Array.isArray(entities)) return [];
  // A non-positive / non-finite cap disables the filter (pass-through copy).
  if (!Number.isFinite(maxPerRepo) || maxPerRepo <= 0) return [...entities];

  const counts = new Map();
  const out = [];
  for (const e of entities) {
    const repo = e?.repo_full_name || '';
    if (!repo) {
      // No repo identity to group on — always keep.
      out.push(e);
      continue;
    }
    const seen = counts.get(repo) || 0;
    if (seen < maxPerRepo) {
      counts.set(repo, seen + 1);
      out.push(e);
    }
  }
  return out;
}

/**
 * Deterministic priority comparator for homepage card selection: quality_score
 * desc, ties broken by repo_stars desc, then id asc (mirrors the filter.js
 * tier-ranking tiebreak so selection is stable across builds).
 */
function byQualityDesc(a, b) {
  return (
    (b.quality_score || 0) - (a.quality_score || 0) ||
    (b.repo_stars || 0) - (a.repo_stars || 0) ||
    String(a.id || '').localeCompare(String(b.id || ''))
  );
}

/**
 * Featured-tier skills for the homepage hero strip.
 *
 * Sorts featured skills by quality (deterministic tiebreak), applies a
 * per-repo diversity cap so the small strip showcases distinct authors, then
 * takes the top `limit`. Selection-only: no score/tier is modified.
 *
 * @param {number} [limit=6]
 * @param {number} [maxPerRepo=1]  one featured card per repo by default
 * @returns {any[]}
 */
export function getFeaturedSkills(limit = 6, maxPerRepo = 1) {
  const featured = allSkills
    .filter(notDuplicate)
    .filter((s) => s.quality_tier === 'featured')
    .sort(byQualityDesc);
  return capPerRepo(featured, maxPerRepo).slice(0, limit);
}

export function getSkillsByCategory(category) {
  return allSkills
    .filter(notDuplicate)
    .filter((s) => s.category === category)
    .sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
}

export function getAllCategories() {
  const cats = {};
  for (const skill of allSkills) {
    if (!notDuplicate(skill)) continue;
    if (skill.category) cats[skill.category] = (cats[skill.category] || 0) + 1;
  }
  return Object.entries(cats)
    .map(([name, count]) => ({ name, count, slug: getCategorySlug(name) }))
    .sort((a, b) => b.count - a.count);
}

export function getCategorySlug(category) {
  if (!category) return '';
  return category
    .toLowerCase()
    .replace(/[&]/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function getCategoryFromSlug(slug) {
  const cats = getAllCategories();
  return cats.find((c) => c.slug === slug)?.name || null;
}

export function getStats() {
  return {
    total: allSkills.length,
    featured: allSkills.filter((s) => s.quality_tier === 'featured').length,
    solid: allSkills.filter((s) => s.quality_tier === 'solid').length,
    listed: allSkills.filter((s) => s.quality_tier === 'listed').length,
    categories: getAllCategories().length,
  };
}

// pipeline-stats (bounded sidecar) — same shape as src/lib/skills.js
let pipelineStats = {};
const __pipeline_stats_path = join(__dirname, '../../data/pipeline-stats.json');
if (existsSync(__pipeline_stats_path)) {
  try {
    pipelineStats = JSON.parse(readFileSync(__pipeline_stats_path, 'utf-8'));
  } catch {
    // Degrade gracefully
  }
}

export function getPipelineStats() {
  return {
    total_discovered: pipelineStats.total_discovered || allSkills.length,
    total_indexed: allSkills.length,
    total_featured: allSkills.filter((s) => s.quality_tier === 'featured').length,
    updated_at: pipelineStats.timestamp || null,
  };
}

// --- Creator aggregation helpers (preserved from src/lib/skills.js) ---

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function getCreators() {
  const map = new Map();

  for (const skill of allSkills) {
    const username = (skill.repo_full_name || '').split('/')[0];
    if (!username) continue;

    let rec = map.get(username);
    if (!rec) {
      rec = {
        username,
        avatar_url: skill.repo_owner_avatar || null,
        type: skill.repo_owner_type || 'User',
        bio_fallback: null,
        skills: [],
        total_skills: 0,
        total_stars: 0,
        _counted_repos: new Set(),
        avg_quality_score: 0,
        avg_quality_score_precise: 0,
        tier_counts: { featured: 0, solid: 0, listed: 0 },
        categories: new Set(),
        first_commit_at: null,
        rising_since: null,
        isProlific: false,
        isQuality: false,
        isRising: false,
      };
      map.set(username, rec);
    }

    rec.skills.push(skill);
    if (skill.repo_full_name && !rec._counted_repos.has(skill.repo_full_name)) {
      rec._counted_repos.add(skill.repo_full_name);
      rec.total_stars += skill.repo_stars || 0;
    }
    rec.tier_counts[skill.quality_tier] = (rec.tier_counts[skill.quality_tier] || 0) + 1;
    if (skill.category) rec.categories.add(skill.category);

    // F2: read from extra.skill_first_commit_at; legacy flat field preserved
    // by the upcaster's dual-shape envelope through the cutover window.
    const commitAt = skill.extra?.skill_first_commit_at || skill.skill_first_commit_at || skill.repo_created_at || null;
    if (commitAt) {
      if (!rec.first_commit_at || new Date(commitAt) < new Date(rec.first_commit_at)) {
        rec.first_commit_at = commitAt;
      }
      if (skill.quality_tier === 'featured') {
        if (!rec.rising_since || new Date(commitAt) > new Date(rec.rising_since)) {
          rec.rising_since = commitAt;
        }
      }
    }
  }

  const now = Date.now();

  for (const rec of map.values()) {
    rec.skills.sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
    rec.total_skills = rec.skills.length;
    const sumScores = rec.skills.reduce((a, b) => a + (b.quality_score || 0), 0);
    rec.total_quality_score = sumScores;
    rec.avg_quality_score_precise = rec.total_skills > 0 ? sumScores / rec.total_skills : 0;
    rec.avg_quality_score = Math.round(rec.avg_quality_score_precise);

    delete rec._counted_repos;

    const top = rec.skills[0];
    rec.bio_fallback = top?.repo_description || null;

    rec.categories = [...rec.categories].sort();

    rec.isProlific = rec.total_skills >= 5;
    rec.isQuality = rec.total_skills >= 2 && rec.tier_counts.featured === rec.total_skills;
    if (rec.rising_since) {
      const age = (now - Date.parse(rec.rising_since)) / MS_PER_DAY;
      rec.isRising = age >= 0 && age <= 30;
    }
  }

  return map;
}

export function getCreatorByUsername(username) {
  if (!username) return null;
  const creators = getCreators();
  return creators.get(username) || null;
}

export function getCreatorLeaderboards(topN = 10) {
  const creators = [...getCreators().values()];

  const byFeatured = [...creators]
    .filter((c) => c.tier_counts.featured > 0)
    .sort((a, b) => (b.tier_counts.featured - a.tier_counts.featured) || (b.avg_quality_score - a.avg_quality_score))
    .slice(0, topN);

  const prolific = [...creators]
    .sort((a, b) => (b.total_skills - a.total_skills) || (b.avg_quality_score - a.avg_quality_score))
    .slice(0, topN);

  const quality = [...creators]
    .filter((c) => c.total_skills >= 2)
    .sort((a, b) =>
      (b.total_quality_score - a.total_quality_score)
      || (b.total_skills - a.total_skills)
      || (b.total_stars - a.total_stars),
    )
    .slice(0, topN);

  const rising = [...creators]
    .filter((c) => c.rising_since)
    .sort((a, b) => new Date(b.rising_since).getTime() - new Date(a.rising_since).getTime())
    .slice(0, topN);

  return { byFeatured, prolific, quality, rising };
}

export function getCreatorsForBrowse() {
  const creators = [...getCreators().values()];
  return creators
    .map((c) => ({
      username: c.username,
      avatar_url: c.avatar_url,
      type: c.type,
      total_skills: c.total_skills,
      featured_count: c.tier_counts?.featured || 0,
      total_stars: c.total_stars,
      total_quality_score: c.total_quality_score,
      avg_quality_score_precise: c.avg_quality_score_precise,
      first_commit_at: c.first_commit_at,
      categories: Array.isArray(c.categories) ? c.categories : [...(c.categories || [])],
    }))
    .sort((a, b) => (b.total_quality_score - a.total_quality_score) || (b.total_skills - a.total_skills));
}

export function getRelatedSkills(skill, limit = 4) {
  return allSkills
    .filter(notDuplicate)
    .filter((s) => s.category === skill.category && s.id !== skill.id)
    .sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0))
    .slice(0, limit);
}

export function getApiGraph() {
  return apiGraphData;
}

export function getAllServices() {
  const services = Object.values(apiGraphData.services || {});
  return services.sort((a, b) => (b.skill_count || 0) - (a.skill_count || 0));
}

export function getServiceById(serviceId) {
  return apiGraphData.services?.[serviceId] || null;
}

export function getSkillIntegrations(skill) {
  if (!skill || !skill.slug) return [];
  const integrationIds = apiGraphData?.skill_integrations?.[skill.slug] || [];
  return integrationIds.map((id) => {
    const svc = apiGraphData.services?.[id];
    return svc ? { id, name: svc.name, category: svc.category, url: svc.url } : null;
  }).filter(Boolean);
}

export function getSimilarSkills(skill, limit = 5) {
  if (!skill || !skill.slug) return [];
  const map = similarSkillsData?.similar || {};
  const entries = map[skill.slug];
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, limit).map((entry) => {
    const fullSkill = allSkills.find((s) => s.slug === entry.slug);
    return fullSkill ? { ...fullSkill, similarity_score: entry.score } : null;
  }).filter(Boolean);
}

export function timeAgo(dateStr) {
  if (!dateStr) return 'unknown';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

export function tierColor(tier) {
  switch (tier) {
    case 'featured': return { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300', dot: 'bg-amber-500' };
    case 'solid': return { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300', dot: 'bg-emerald-500' };
    default: return { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-300', dot: 'bg-gray-400' };
  }
}

export function categoryColor(category) {
  const colors = {
    'Code & Development': 'bg-blue-100 text-blue-800',
    'Web & Frontend': 'bg-purple-100 text-purple-800',
    'Testing & QA': 'bg-green-100 text-green-800',
    'Data & Documents': 'bg-orange-100 text-orange-800',
    'DevOps & Infrastructure': 'bg-red-100 text-red-800',
    'API & Backend': 'bg-indigo-100 text-indigo-800',
    'AI & Automation': 'bg-pink-100 text-pink-800',
    'Productivity & Other': 'bg-gray-100 text-gray-700',
  };
  return colors[category] || 'bg-gray-100 text-gray-700';
}

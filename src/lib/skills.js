/**
 * Skills data loader and helpers
 */

import skillsData from '../../data/skills.json';
import pipelineStats from '../../data/pipeline-stats.json';

/** @type {import('./types').Skill[]} */
export const allSkills = skillsData;

export function getFeaturedSkills(limit = 6) {
  return allSkills
    .filter(s => s.quality_tier === 'featured')
    .slice(0, limit);
}

export function getSkillsByCategory(category) {
  return allSkills
    .filter(s => s.category === category)
    .sort((a, b) => b.quality_score - a.quality_score);
}

export function getSkillBySlug(slug) {
  return allSkills.find(s => s.slug === slug) || null;
}

export function getAllCategories() {
  const cats = {};
  for (const skill of allSkills) {
    cats[skill.category] = (cats[skill.category] || 0) + 1;
  }
  return Object.entries(cats)
    .map(([name, count]) => ({ name, count, slug: getCategorySlug(name) }))
    .sort((a, b) => b.count - a.count);
}

export function getCategorySlug(category) {
  return category
    .toLowerCase()
    .replace(/[&]/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function getCategoryFromSlug(slug) {
  const cats = getAllCategories();
  return cats.find(c => c.slug === slug)?.name || null;
}

export function getStats() {
  return {
    total: allSkills.length,
    featured: allSkills.filter(s => s.quality_tier === 'featured').length,
    solid: allSkills.filter(s => s.quality_tier === 'solid').length,
    listed: allSkills.filter(s => s.quality_tier === 'listed').length,
    categories: getAllCategories().length,
  };
}

/**
 * Pipeline-wide stats. Always prefers pipeline-stats.json for `total_discovered`
 * (the true scraped count, not just what survived filtering) and uses the
 * current catalog for indexed/featured counts so numbers stay consistent with
 * what's actually rendered.
 */
export function getPipelineStats() {
  return {
    total_discovered: pipelineStats.total_discovered || allSkills.length,
    total_indexed: allSkills.length,
    total_featured: allSkills.filter(s => s.quality_tier === 'featured').length,
    updated_at: pipelineStats.timestamp || null,
  };
}

// --- Creator aggregation helpers (Phase 4) ---

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Build a Map of creator records from `allSkills`. A creator = the `owner`
 * segment of `repo_full_name`. Each record has aggregate stats, badge flags,
 * and their sorted skill list.
 *
 * Bios use the top-scored skill's `repo_description` as a fallback — real
 * GitHub user bios require a user API fetch which is deferred to Phase 2.5.
 */
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
        avg_quality_score: 0,
        tier_counts: { featured: 0, solid: 0, listed: 0 },
        categories: new Set(),
        first_commit_at: null,
        rising_since: null, // earliest first_commit_at among Featured skills
        isProlific: false,
        isQuality: false,
        isRising: false,
      };
      map.set(username, rec);
    }

    rec.skills.push(skill);
    rec.total_stars += skill.repo_stars || 0;
    rec.tier_counts[skill.quality_tier] = (rec.tier_counts[skill.quality_tier] || 0) + 1;
    if (skill.category) rec.categories.add(skill.category);

    const commitAt = skill.skill_first_commit_at || skill.repo_created_at || null;
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
    rec.avg_quality_score = rec.total_skills > 0 ? Math.round(sumScores / rec.total_skills) : 0;

    // Fallback bio from the top-scored skill's repo_description
    const top = rec.skills[0];
    rec.bio_fallback = top?.repo_description || null;

    // Convert categories Set → sorted array for template iteration
    rec.categories = [...rec.categories].sort();

    // Badges
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

/**
 * Leaderboards for /creators index. Returns an object with four top-10
 * arrays. Each element is a creator record from getCreators().
 */
export function getCreatorLeaderboards(topN = 10) {
  const creators = [...getCreators().values()];

  const byFeatured = [...creators]
    .filter(c => c.tier_counts.featured > 0)
    .sort((a, b) => (b.tier_counts.featured - a.tier_counts.featured) || (b.avg_quality_score - a.avg_quality_score))
    .slice(0, topN);

  const prolific = [...creators]
    .sort((a, b) => (b.total_skills - a.total_skills) || (b.avg_quality_score - a.avg_quality_score))
    .slice(0, topN);

  const quality = [...creators]
    .filter(c => c.total_skills >= 2)
    .sort((a, b) => (b.avg_quality_score - a.avg_quality_score) || (b.total_skills - a.total_skills))
    .slice(0, topN);

  const rising = [...creators]
    .filter(c => c.rising_since)
    .sort((a, b) => new Date(b.rising_since).getTime() - new Date(a.rising_since).getTime())
    .slice(0, topN);

  return { byFeatured, prolific, quality, rising };
}

export function getRelatedSkills(skill, limit = 4) {
  return allSkills
    .filter(s => s.category === skill.category && s.id !== skill.id)
    .sort((a, b) => b.quality_score - a.quality_score)
    .slice(0, limit);
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

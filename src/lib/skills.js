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

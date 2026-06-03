/**
 * scripts/lib/scorers/plugin.scorer.js — Phase 3.2 scorer for
 * entity_type='plugin' (D-03).
 *
 * 7-signal, 0-100 composite. Identical to the skill scorer EXCEPT the
 * 20% Frontmatter signal is swapped for a Manifest-Completeness signal
 * (D-03's "1-signal swap" promise). Every other sub-signal reuses the
 * primitives exported from scripts/score.js — no behavioural drift.
 *
 * SIDE-EFFECT: writes `record.extra.manifest_completeness` (0-1 float)
 * for downstream display.
 */

import {
  scoreStars,
  scoreRecency,
  scoreIssues,
  scoreLicense,
  scoreDescription,
} from '../../score.js';

const WEIGHTS = {
  stars: 0.20,
  recency: 0.20,
  manifest: 0.20, // swap target (was frontmatter for skills)
  docs: 0.15,
  issues: 0.10,
  license: 0.10,
  description: 0.05,
};

/**
 * Plugin manifest completeness, 0-1. Five equally-weighted checks:
 *   description >= 50 chars, version, author, license, >= 1 keyword.
 *
 * @param {Record<string, any>} manifest
 * @returns {number} 0-1
 */
export function pluginManifestCompleteness(manifest) {
  const m = manifest || {};
  let hits = 0;
  if ((m.description || '').trim().length >= 50) hits += 1;
  if (m.version) hits += 1;
  if (m.author) hits += 1;
  if (m.license) hits += 1;
  if (Array.isArray(m.keywords) && m.keywords.length >= 1) hits += 1;
  return hits / 5;
}

/**
 * Documentation sub-signal for entities whose primary doc is a README
 * (plugins/MCPs), mirroring scoreDocs's shape but reading readme_markdown.
 *
 * @param {any} record
 * @returns {number} 0-100
 */
export function scoreReadmeDocs(record) {
  let score = 0;
  const readmeLen = (record?.extra?.readme_markdown || '').length;
  if (readmeLen > 2000) score += 50;
  else if (readmeLen > 500) score += 35;
  else if (readmeLen > 100) score += 20;
  else score += 5;

  if (record?.repo_description && record.repo_description.length > 20) score += 30;
  else if (record?.repo_description) score += 15;

  if (record?.description && record.description.length > 50) score += 20;
  else if (record?.description) score += 10;

  return Math.min(100, score);
}

/**
 * Score a plugin EntityRecord. Mutates extra.manifest_completeness.
 *
 * @param {any} record  v2 EntityRecord<PluginExtra>.
 * @returns {number} 0-100 integer.
 */
export function scorePlugin(record) {
  const completeness = pluginManifestCompleteness(record?.extra?.manifest);
  if (record?.extra) record.extra.manifest_completeness = completeness;

  const scores = {
    stars: scoreStars(record.repo_stars),
    recency: scoreRecency(record.repo_pushed_at),
    manifest: completeness * 100,
    docs: scoreReadmeDocs(record),
    issues: scoreIssues(record),
    license: scoreLicense(record.repo_license),
    description: scoreDescription(record.repo_description),
  };

  let total = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    total += scores[key] * weight;
  }
  return Math.round(Math.min(100, Math.max(0, total)));
}

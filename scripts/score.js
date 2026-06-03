/**
 * Quality Scoring — 7-Signal, 100-Point Composite
 *
 * Signals:
 *   Stars (20%)         — log-scale GitHub stars
 *   Recency (20%)       — days since last push
 *   Frontmatter (20%)   — SKILL.md completeness
 *   README/Docs (15%)   — repo description + body length
 *   Issues (10%)        — open issues ratio (penalizes abandoned)
 *   License (10%)       — has an open-source license
 *   Description (5%)    — repo has a description
 *
 * Tiers:
 *   Featured: 80+
 *   Solid:    50-79
 *   Listed:   <50
 */

export function scoreSkill(skill) {
  const scores = {
    stars: scoreStars(skill.repo_stars),
    recency: scoreRecency(skill.repo_pushed_at),
    frontmatter: scoreFrontmatter(skill),
    docs: scoreDocs(skill),
    issues: scoreIssues(skill),
    license: scoreLicense(skill.repo_license),
    description: scoreDescription(skill.repo_description),
  };

  const weights = {
    stars: 0.20,
    recency: 0.20,
    frontmatter: 0.20,
    docs: 0.15,
    issues: 0.10,
    license: 0.10,
    description: 0.05,
  };

  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    total += scores[key] * weight;
  }

  return Math.round(Math.min(100, Math.max(0, total)));
}

// --- Individual signal scorers (each returns 0-100) ---
//
// Phase 3.2 Task 3: these are now `export`ed (behaviour unchanged) so the
// plugin + mcp_server scorers can reuse the Stars/Recency/Issues/License/
// Description/Docs sub-signals and swap ONLY the Frontmatter signal for a
// Manifest-Completeness signal (D-03's "1-signal swap" promise).

export function scoreStars(stars) {
  if (!stars || stars <= 0) return 0;
  // Log scale: 1 star = ~0, 10 = ~33, 100 = ~66, 1000 = ~100
  return Math.min(100, Math.round(Math.log10(stars + 1) * 33.3));
}

export function scoreRecency(pushedAt) {
  if (!pushedAt) return 0;
  const daysSincePush = (Date.now() - new Date(pushedAt).getTime()) / (1000 * 60 * 60 * 24);

  if (daysSincePush <= 7) return 100;
  if (daysSincePush <= 30) return 90;
  if (daysSincePush <= 90) return 75;
  if (daysSincePush <= 180) return 50;
  if (daysSincePush <= 365) return 25;
  return 5;
}

export function scoreFrontmatter(skill) {
  let score = 0;
  const fm = skill.frontmatter || {};

  // Has name in frontmatter
  if (fm.name) score += 30;

  // Has description in frontmatter
  if (fm.description && fm.description.length > 10) score += 40;
  else if (fm.description) score += 20;

  // Has any additional fields (allowed-tools, tags, etc.)
  const extraFields = Object.keys(fm).filter(k => !['name', 'description'].includes(k));
  if (extraFields.length >= 3) score += 30;
  else if (extraFields.length >= 1) score += 15;

  return Math.min(100, score);
}

export function scoreDocs(skill) {
  let score = 0;

  // Body length (longer = more documentation)
  if (skill.body_length > 2000) score += 50;
  else if (skill.body_length > 500) score += 35;
  else if (skill.body_length > 100) score += 20;
  else score += 5;

  // Has repo description
  if (skill.repo_description && skill.repo_description.length > 20) score += 30;
  else if (skill.repo_description) score += 15;

  // Has skill description
  if (skill.description && skill.description.length > 50) score += 20;
  else if (skill.description) score += 10;

  return Math.min(100, score);
}

export function scoreIssues(skill) {
  // No open issues is fine
  if (!skill.repo_open_issues || skill.repo_open_issues === 0) return 80;

  // For repos with stars, calculate ratio
  if (skill.repo_stars > 0) {
    const ratio = skill.repo_open_issues / skill.repo_stars;
    if (ratio < 0.05) return 90;   // Very healthy
    if (ratio < 0.1) return 75;
    if (ratio < 0.3) return 50;
    if (ratio < 0.5) return 30;
    return 10; // Too many open issues relative to popularity
  }

  // No stars but has issues — probably abandoned
  if (skill.repo_open_issues > 10) return 20;
  if (skill.repo_open_issues > 5) return 40;
  return 60;
}

export function scoreLicense(license) {
  if (!license || license === 'NOASSERTION') return 0;
  // Common permissive licenses get full marks
  const permissive = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Unlicense', '0BSD'];
  if (permissive.includes(license)) return 100;
  // Other licenses still get credit
  return 70;
}

export function scoreDescription(desc) {
  if (!desc) return 0;
  if (desc.length > 50) return 100;
  if (desc.length > 20) return 60;
  return 30;
}

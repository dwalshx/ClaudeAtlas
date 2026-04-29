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

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { scoreSkill } from './score.js';
import { TRACK1_FRESHNESS_FIELDS } from './lib/skill-fields.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RAW_PATH = join(ROOT, 'data', 'skills-raw.json');  // Always read from raw
const OUTPUT_PATH = join(ROOT, 'data', 'skills.json');

// --- Enrichment preservation ---
// Some fields (skill_first_commit_at from Phase 2 DATA-01) are backfilled
// out-of-band and don't live in skills-raw.json. We load the current
// skills.json if it exists and copy these enrichments forward so they
// survive each filter run. Never overwrites a good value with null.
const PRESERVED_FIELDS = ['skill_first_commit_at'];

function loadPriorEnrichments() {
  if (!existsSync(OUTPUT_PATH)) return new Map();
  try {
    const prior = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
    if (!Array.isArray(prior)) return new Map();
    const map = new Map();
    for (const p of prior) {
      if (!p || !p.id) continue;
      const enrichments = {};
      let anyValue = false;
      for (const field of PRESERVED_FIELDS) {
        if (p[field] != null) {
          enrichments[field] = p[field];
          anyValue = true;
        }
      }
      if (anyValue) map.set(p.id, enrichments);
    }
    return map;
  } catch {
    return new Map();
  }
}

// R3 — Track 1 freshness merge.
//
// Track 1 (scripts/scrape-pulse.js) updates the engagement fields below in
// skills.json IN PLACE every day. Track 2 (scrape.js) re-discovers skills
// and writes skills-raw.json with whatever values GitHub returned at
// discovery time — which may be hours stale relative to Track 1.
// When the same skill (matched by slug) exists in BOTH, we prefer Track 1's
// freshness fields. Then we re-score so quality_score reflects them.
//
// C1 (per 3.0.0-PLAN-CHECK): Why slug-keyed here, while loadPriorEnrichments
// is id-keyed? Different field classes need different merge keys:
//   - slug ("owner/skill-name") = stable repo identity. Track 1's daily
//     refresh and the skill's repo membership are tied to slug. Engagement
//     fields (stars, forks, etc.) belong to the REPO, so slug-keyed.
//   - id ("owner/repo/path") = stable RECORD identity. Content enrichments
//     like skill_first_commit_at are tied to the specific SKILL.md file at
//     a path, so id-keyed (a repo can host multiple SKILL.md files; each
//     gets its own enrichments).
// The two merges run independently and never compete for the same fields.
//
// The TRACK1_FRESHNESS_FIELDS list is imported from scripts/lib/skill-fields.js
// — single source of truth shared with scripts/scrape-pulse.js.

function loadCurrentSkillsBySlug() {
  if (!existsSync(OUTPUT_PATH)) return new Map();
  try {
    const current = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
    if (!Array.isArray(current)) return new Map();
    const map = new Map();
    for (const s of current) {
      if (!s || !s.slug) continue;
      map.set(s.slug, s);
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Apply Track 1 freshness from current skills.json onto raw discovered
 * skills, then re-score affected records. Exported for unit testing.
 *
 * @param {Array<object>} raw - Skills from skills-raw.json
 * @param {Map<string, object>} currentBySlug - slug -> current skill record
 * @returns {{ mergedCount: number }}
 */
export function applyTrack1Freshness(raw, currentBySlug) {
  let mergedCount = 0;
  for (const skill of raw) {
    const existing = currentBySlug.get(skill.slug);
    if (!existing) continue;
    let touched = false;
    for (const field of TRACK1_FRESHNESS_FIELDS) {
      if (existing[field] !== undefined && existing[field] !== null) {
        skill[field] = existing[field];
        touched = true;
      }
    }
    if (touched) {
      // Re-score with merged values. score.js depends on stars (log-scaled)
      // and recency (days since pushed_at) — both updated above.
      skill.quality_score = scoreSkill(skill);
      mergedCount++;
    }
  }
  return { mergedCount };
}

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
  // Phase 3.0.1: graceful fallback for missing skills-raw.json.
  //
  // skills-raw.json (~295 MB) is gitignored and lives only in (a) the
  // developer's local data dir or (b) the GHA cache (restored at start of
  // each daily/weekly workflow run, seeded once via bootstrap-skills-raw.yml).
  //
  // Cases this guard handles:
  //   - First-ever CI run before bootstrap workflow ran: cache miss,
  //     skills-raw.json absent. We still want the daily pipeline to deploy
  //     Track 1's fresh skills.json — don't hard-fail.
  //   - Cache eviction (GHA's 7-day inactive eviction policy): same recovery.
  //
  // The "raw missing AND skills.json missing" cold-start case IS fatal —
  // we can't compute anything from nothing. Operator action: run the
  // bootstrap-skills-raw.yml workflow once.
  if (!existsSync(RAW_PATH)) {
    if (existsSync(OUTPUT_PATH)) {
      console.warn(`[filter] WARN: ${RAW_PATH} missing; preserving existing skills.json (Track-1-only day).`);
      console.warn(`[filter]       Run .github/workflows/bootstrap-skills-raw.yml to seed the GHA cache.`);
      console.warn(`[filter]       Or run \`node scripts/scrape-discover-repos.js\` locally to rebuild.`);
      console.warn(`[filter] Exiting 0 to allow daily workflow to proceed with Track 1 output.`);
      process.exit(0);
    }
    console.error(`[filter] FATAL: both ${RAW_PATH} and ${OUTPUT_PATH} are missing — cold start.`);
    console.error(`[filter]        Run .github/workflows/bootstrap-skills-raw.yml first.`);
    process.exit(1);
  }

  console.log('=== ClaudeAtlas Filter ===');
  console.log(`Loading raw skills...`);

  const raw = JSON.parse(readFileSync(RAW_PATH, 'utf-8'));
  console.log(`Raw skills: ${raw.length}`);

  // Load prior enrichments (skill_first_commit_at, etc.) from existing skills.json
  const priorEnrichments = loadPriorEnrichments();
  if (priorEnrichments.size > 0) {
    console.log(`Prior enrichments to preserve: ${priorEnrichments.size} records`);
  }

  // --- Step 0: Load Track 1 freshness map ---
  const currentSkillsBySlug = loadCurrentSkillsBySlug();
  if (currentSkillsBySlug.size > 0) {
    console.log(`R3 merge: ${currentSkillsBySlug.size} prior skills available for freshness merge`);
  }

  // --- Step 0b: Apply Track 1 freshness BEFORE scoring/filtering ---
  const { mergedCount } = applyTrack1Freshness(raw, currentSkillsBySlug);
  if (mergedCount > 0) {
    console.log(`R3 merge: applied Track 1 freshness + re-scored ${mergedCount} skills`);
  }

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

  // --- Step 4c: Preserve enrichments from the previous skills.json ---
  // Keeps skill_first_commit_at (DATA-01 backfill) alive across cron runs.
  // Only copies forward — never wipes a value already present in the raw pipeline.
  let preservedCount = 0;
  for (const s of capped) {
    const prior = priorEnrichments.get(s.id);
    if (!prior) continue;
    for (const field of PRESERVED_FIELDS) {
      if (s[field] == null && prior[field] != null) {
        s[field] = prior[field];
        preservedCount++;
      }
    }
  }
  if (preservedCount > 0) {
    console.log(`Preserved ${preservedCount} enrichment values from prior skills.json`);
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

// Only run main() when invoked as a script, not when imported by tests.
// import.meta.url is a file:// URL; process.argv[1] is a path. Normalize.
const invokedAsScript = (() => {
  try {
    return import.meta.url === fileURLToPath(`file://${process.argv[1]}`).replace(/\\/g, '/')
      || fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (invokedAsScript) {
  main();
}

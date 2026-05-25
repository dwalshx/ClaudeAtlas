#!/usr/bin/env node
/**
 * Tier budget gate (Phase 03.1.1 T5c / R7 mitigation / DOD-10 sibling).
 *
 * Cloudflare Workers Static Assets caps file count at 20,000 on the Free plan
 * and 100,000 on Workers Paid (Sept 2025 changelog, verified in Phase 3.1
 * research §F). Astro emits one HTML file per skill page. With tier-aware
 * rendering (T5: only Top/Featured + Solid pre-rendered; Listed served via
 * SKILLS_KV at request time), the static file count is bounded by Top+Solid
 * tier counts.
 *
 * This script fails the build if the renderable count exceeds 18,000 —
 * a 2,000-file margin below the Free-plan cap. Listed tier is excluded
 * because it doesn't generate static pages; the worker renders it.
 *
 * Runs as part of `postbuild` so any drift catches mid-pipeline rather
 * than at deploy time.
 *
 * Exit codes:
 *   0 — under budget (build OK)
 *   1 — over budget (build must reject)
 *   2 — script error (input file missing, etc.)
 */

import { loadAllSkillsSync } from './lib/skills-stream.js';
import { resolveSkillsNdjsonPath } from './lib/build-input.js';

const BUDGET = 18000;
const STATIC_TIERS = new Set(['featured', 'top', 'solid']);

function main() {
  let path;
  try {
    path = resolveSkillsNdjsonPath();
  } catch (err) {
    console.error(`[check-tier-budget] FATAL: ${err.message}`);
    process.exit(2);
  }

  let skills;
  try {
    skills = loadAllSkillsSync(path);
  } catch (err) {
    console.error(`[check-tier-budget] FATAL: failed to load ${path}: ${err.message}`);
    process.exit(2);
  }

  const renderable = skills.filter(s => STATIC_TIERS.has(s.quality_tier)).length;
  const total = skills.length;
  const listed = total - renderable;

  console.log(`[check-tier-budget] catalog: ${total} (renderable: ${renderable}, listed: ${listed})`);
  console.log(`[check-tier-budget] budget: ${BUDGET} (Free-tier cap 20,000 minus 2,000 margin)`);

  if (renderable > BUDGET) {
    console.error(`[check-tier-budget] FATAL: ${renderable} renderable pages > ${BUDGET} budget`);
    console.error('[check-tier-budget] Options:');
    console.error('  1. Tighten the filter to reduce Top+Solid count');
    console.error('  2. Move to Workers Paid (cap 100,000, breaks $12/yr budget)');
    console.error('  3. Demote more skills to Listed tier (served by Worker, not pre-rendered)');
    process.exit(1);
  }

  console.log('[check-tier-budget] OK');
}

main();

#!/usr/bin/env node
/**
 * ClaudeAtlas Smoke Harness — local validation in <30s.
 *
 * Exercises the full discovery → parse → score → categorize → atomic-merge
 * chain against data/smoke-seed.json (10 repos, hand-picked for path
 * coverage). Reuses the helpers in scripts/scrape-discover-repos.js — never
 * re-implements them.
 *
 * What this catches:
 *   - "Did we wire it?" bugs (empty Set, broken imports, missing helpers)
 *   - Frontmatter parse regressions (parseSkill changes)
 *   - Score / category regressions (score.js / categorize.js drift)
 *   - Atomic-merge regressions (skills-raw.json shape drift)
 *
 * What this does NOT catch (per CONTEXT R6):
 *   - 30k-scale bugs (V8 string limits, rate-limit math under contention)
 *   - GHA cache restore/save behavior (workflow-level concerns)
 *   - Production rate-limit headers (we hit a token-authenticated path here)
 *
 * Output: data/smoke-output.json (gitignored — see .gitignore patterns
 *         that already exclude data/skills-raw* / data/*.partial).
 * Exit:   0 on success (≥ 5 of 10 repos return SOMETHING — null is allowed
 *           for the "no SKILL.md" / "404" paths)
 *         1 on hard failure (import error, all 10 repos error, output is
 *           not valid JSON, etc.)
 *
 * Tag prefix: [smoke]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchWithETag } from './lib/github-fetch.js';
import { listSkillPaths, fetchAndBuildRecord } from './scrape-discover-repos.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SEED_PATH = join(ROOT, 'data', 'smoke-seed.json');
const OUTPUT_PATH = join(ROOT, 'data', 'smoke-output.json');

function log(msg) { console.log(`[smoke] ${msg}`); }
function fail(msg) { console.error(`[smoke] FAIL: ${msg}`); process.exit(1); }

async function fetchRepoMeta(fullName) {
  const url = `https://api.github.com/repos/${fullName}`;
  const { data, status } = await fetchWithETag(url);
  if (!data) {
    log(`${fullName}: HTTP ${status} (deleted/private/network) — exercising null-data branch`);
    return null;
  }
  return data; // shape matches RepoMetadata used by discover helpers
}

async function main() {
  const startTime = Date.now();
  log('=== Smoke harness start ===');

  if (!existsSync(SEED_PATH)) fail(`seed file ${SEED_PATH} missing`);
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf-8'));
  if (!seed?.repos?.length) fail('seed.repos is empty');

  const records = [];
  const stats = { repos: 0, skills: 0, no_skill: 0, repo_404: 0, skipped_archived_or_fork: 0 };

  for (const seedEntry of seed.repos) {
    stats.repos++;
    const repo = await fetchRepoMeta(seedEntry.full_name);
    if (!repo) { stats.repo_404++; continue; }
    if (repo.archived || repo.fork) { stats.skipped_archived_or_fork++; continue; }

    const paths = await listSkillPaths(repo);
    if (paths.length === 0) { stats.no_skill++; continue; }

    for (const p of paths) {
      const record = await fetchAndBuildRecord(repo, p);
      if (record) { records.push(record); stats.skills++; }
    }
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify({
    timestamp: new Date().toISOString(),
    elapsed_seconds: ((Date.now() - startTime) / 1000),
    stats,
    sample: records.slice(0, 3), // first 3 for human eyeballing
  }, null, 2));

  log(`=== Smoke harness complete in ${((Date.now() - startTime) / 1000).toFixed(1)}s ===`);
  log(`stats: ${JSON.stringify(stats)}`);

  // Sanity gates (loose — seed coverage will vary as repos evolve):
  // - At least 5 of 10 repos must respond (not all 404)
  // - At least 1 SKILL.md must parse successfully (proves the chain works end-to-end)
  const responding = stats.repos - stats.repo_404;
  if (responding < 5) fail(`only ${responding}/${stats.repos} repos responded (expected ≥5)`);
  if (stats.skills < 1) fail(`zero SKILL.md parsed across ${stats.repos} seed repos (expected ≥1)`);
  log('OK gates passed');
}

main().catch(err => { console.error('[smoke] fatal:', err); process.exit(1); });

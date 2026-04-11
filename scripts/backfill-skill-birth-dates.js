#!/usr/bin/env node

/**
 * ClaudeAtlas Skill Birth Date Backfill
 *
 * Populates `skill_first_commit_at` (ISO 8601) on every skill in data/skills.json
 * by querying GitHub's commits API for the earliest commit that touched the
 * skill's path.
 *
 * Strategy per skill:
 *   1. HEAD-like probe: GET /repos/{owner}/{repo}/commits?path={skill_path}&per_page=1
 *      — parse the Link header to find `rel="last"` with the total page count
 *   2. Fetch the last page (1 commit at page=N) — that's the earliest commit
 *   3. Extract committer.date (or author.date if committer is missing)
 *
 * Falls back to `repo_created_at` if the API returns empty, the path is
 * unresolvable, or any step fails.
 *
 * Resumable: writes data/skills.json.birth-partial every 25 skills; on restart,
 * skills that already have `skill_first_commit_at` set are skipped.
 *
 * Rate limiting: conservative 250ms delay between requests, honors
 * X-RateLimit-Reset on 403/429.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const SKILLS_PATH = join(DATA_DIR, 'skills.json');
const PARTIAL_PATH = join(DATA_DIR, 'skills.json.birth-partial');

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('ERROR: GITHUB_TOKEN environment variable required.');
  process.exit(1);
}

const HEADERS = {
  'Authorization': `Bearer ${TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'ClaudeAtlas-SkillBirthBackfill/1.0',
};

const POLITE_DELAY_MS = 250;
const CHECKPOINT_EVERY = 25;
const MAX_RETRIES = 4;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ts() {
  return new Date().toISOString();
}

function log(msg) {
  console.log(`[${ts()}] ${msg}`);
}

async function rateLimitedFetch(url, attempt = 1) {
  let res;
  try {
    res = await fetch(url, { headers: HEADERS });
  } catch (err) {
    if (attempt >= MAX_RETRIES) throw err;
    const waitMs = 2000 * attempt;
    log(`  [retry] network error (${err.cause?.code || err.message}), waiting ${waitMs}ms (attempt ${attempt}/${MAX_RETRIES})`);
    await sleep(waitMs);
    return rateLimitedFetch(url, attempt + 1);
  }

  if (res.status === 403 || res.status === 429) {
    const resetHeader = res.headers.get('x-ratelimit-reset');
    if (resetHeader) {
      const resetTime = parseInt(resetHeader) * 1000;
      const waitMs = Math.max(resetTime - Date.now() + 2000, 5000);
      log(`  [rate-limit] ${res.status} hit, waiting ${Math.ceil(waitMs / 1000)}s until reset...`);
      await sleep(waitMs);
      return rateLimitedFetch(url, attempt);
    }
    log(`  [rate-limit] ${res.status} hit (no reset header), waiting 60s...`);
    await sleep(60000);
    return rateLimitedFetch(url, attempt);
  }

  return res;
}

function parseLastPage(linkHeader) {
  if (!linkHeader) return null;
  // Format: <url>; rel="next", <url>; rel="last"
  const match = linkHeader.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  return match ? parseInt(match[1], 10) : null;
}

async function findFirstCommit(repoFullName, skillPath) {
  const [owner, repo] = repoFullName.split('/');
  if (!owner || !repo || !skillPath) return null;

  const encodedPath = encodeURIComponent(skillPath);
  const probeUrl = `https://api.github.com/repos/${owner}/${repo}/commits?path=${encodedPath}&per_page=1`;

  const probeRes = await rateLimitedFetch(probeUrl);

  if (probeRes.status === 404 || probeRes.status === 409) return null;
  if (!probeRes.ok) return null;

  const linkHeader = probeRes.headers.get('link');
  const lastPage = parseLastPage(linkHeader);

  let commits;
  try {
    commits = await probeRes.json();
  } catch {
    return null;
  }

  if (!Array.isArray(commits) || commits.length === 0) return null;

  // If no Link header → probe response is the ONLY page → only one commit → use it
  if (!lastPage || lastPage === 1) {
    const c = commits[0];
    return c?.commit?.committer?.date || c?.commit?.author?.date || null;
  }

  // Otherwise fetch the last page (earliest commit)
  await sleep(POLITE_DELAY_MS);
  const lastUrl = `https://api.github.com/repos/${owner}/${repo}/commits?path=${encodedPath}&per_page=1&page=${lastPage}`;
  const lastRes = await rateLimitedFetch(lastUrl);

  if (!lastRes.ok) return null;

  let lastCommits;
  try {
    lastCommits = await lastRes.json();
  } catch {
    return null;
  }

  if (!Array.isArray(lastCommits) || lastCommits.length === 0) return null;

  const c = lastCommits[0];
  return c?.commit?.committer?.date || c?.commit?.author?.date || null;
}

async function main() {
  log('=== skill birth date backfill start ===');

  if (!existsSync(SKILLS_PATH)) {
    console.error(`ERROR: ${SKILLS_PATH} not found.`);
    process.exit(1);
  }

  // Prefer resuming from partial if available
  const sourcePath = existsSync(PARTIAL_PATH) ? PARTIAL_PATH : SKILLS_PATH;
  log(`loading skills from ${sourcePath}`);
  const skills = JSON.parse(readFileSync(sourcePath, 'utf-8'));
  log(`${skills.length} total skills`);

  const stats = { ok: 0, fallback: 0, error: 0, skipped: 0 };
  let processed = 0;

  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i];

    // Skip if already populated
    if (skill.skill_first_commit_at !== undefined && skill.skill_first_commit_at !== null) {
      stats.skipped++;
      processed++;
      continue;
    }

    try {
      const firstCommitAt = await findFirstCommit(skill.repo_full_name, skill.skill_path);
      if (firstCommitAt) {
        skill.skill_first_commit_at = firstCommitAt;
        stats.ok++;
      } else {
        // Fall back to repo_created_at so every skill has *some* value
        skill.skill_first_commit_at = skill.repo_created_at || null;
        stats.fallback++;
      }
    } catch (err) {
      skill.skill_first_commit_at = skill.repo_created_at || null;
      stats.error++;
      log(`  [ERROR] ${skill.repo_full_name}/${skill.skill_path}: ${err.message}`);
    }

    processed++;

    if (processed % 25 === 0) {
      log(`  [${processed}/${skills.length}] ok=${stats.ok} fallback=${stats.fallback} error=${stats.error} skipped=${stats.skipped}`);
    }

    if (processed % CHECKPOINT_EVERY === 0 || i === skills.length - 1) {
      writeFileSync(PARTIAL_PATH, JSON.stringify(skills), 'utf-8');
    }

    await sleep(POLITE_DELAY_MS);
  }

  // Final save — promote partial to canonical
  writeFileSync(SKILLS_PATH, JSON.stringify(skills), 'utf-8');
  log(`wrote ${SKILLS_PATH} with skill_first_commit_at populated on ${skills.length} skills`);

  log('=== summary ===');
  log(`  ok (API-resolved): ${stats.ok}`);
  log(`  fallback (repo_created_at): ${stats.fallback}`);
  log(`  error: ${stats.error}`);
  log(`  skipped (already populated): ${stats.skipped}`);
  log('=== skill birth date backfill complete ===');
}

main().catch(err => {
  console.error(`FATAL: ${err.stack || err.message}`);
  process.exit(1);
});

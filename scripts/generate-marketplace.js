#!/usr/bin/env node

/**
 * ClaudeAtlas Marketplace Generator
 *
 * Generates .claude-plugin/marketplace.json so ClaudeAtlas can be registered
 * as a Claude Code plugin marketplace. Users can then:
 *
 *   /plugin marketplace add https://github.com/dwalshx/ClaudeAtlas
 *   /plugin install videodb@claudeatlas
 *
 * Each Featured skill becomes a marketplace plugin entry pointing at the
 * skill's source GitHub repo. We only include Featured-tier skills to keep
 * the marketplace high-signal (consistent with the "curated" brand).
 *
 * Caveat: not every indexed skill lives in a repo with a proper plugin.json
 * manifest. For repos without one, Claude Code's install may not work fully.
 * This is acceptable for a v1 marketplace — the value is discoverability,
 * and the install command gives users the repo URL either way.
 *
 * Source format uses the GitHub shorthand: {"source": "github", "repo": "owner/repo"}
 * which Claude Code resolves to a git clone.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SKILLS_PATH = join(ROOT, 'data', 'skills.json');
const OUTPUT_DIR = join(ROOT, '.claude-plugin');
const OUTPUT_PATH = join(OUTPUT_DIR, 'marketplace.json');

function log(msg) {
  console.log(`[marketplace] ${msg}`);
}

function main() {
  log('=== marketplace generator start ===');

  if (!existsSync(SKILLS_PATH)) {
    console.error(`ERROR: ${SKILLS_PATH} not found`);
    process.exit(1);
  }

  const skills = JSON.parse(readFileSync(SKILLS_PATH, 'utf-8'));

  // Only include Featured skills — curated, high-signal marketplace
  const featured = skills.filter(s => s.quality_tier === 'featured');
  log(`${featured.length} featured skills → marketplace plugins`);

  // Dedupe by repo (a repo may have multiple skills, but the marketplace
  // points at the repo level, not individual skill files)
  const byRepo = new Map();
  for (const skill of featured) {
    const repo = skill.repo_full_name;
    if (!repo) continue;
    if (!byRepo.has(repo)) {
      byRepo.set(repo, []);
    }
    byRepo.get(repo).push(skill);
  }

  log(`${byRepo.size} unique repos`);

  // Build plugin entries — one per repo, with the best skill's metadata
  const plugins = [];
  for (const [repo, repoSkills] of byRepo) {
    // Pick the highest-scored skill as the representative
    const best = repoSkills.sort((a, b) => b.quality_score - a.quality_score)[0];
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) continue;

    plugins.push({
      name: best.name,
      source: {
        source: 'github',
        repo: repo,
      },
      description: (best.description || '').slice(0, 200),
      version: '1.0.0',
      author: {
        name: owner,
      },
      // Marketplace-specific metadata
      category: best.category || 'Productivity & Other',
      tags: [
        best.quality_tier,
        best.category?.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        best.repo_language?.toLowerCase(),
      ].filter(Boolean),
    });
  }

  // Sort by quality score (best first)
  plugins.sort((a, b) => {
    const sa = featured.find(s => s.name === a.name);
    const sb = featured.find(s => s.name === b.name);
    return (sb?.quality_score || 0) - (sa?.quality_score || 0);
  });

  const marketplace = {
    name: 'claudeatlas',
    owner: {
      name: 'ClaudeAtlas',
      email: 'dan@claudeatlas.com',
    },
    metadata: {
      description: 'Curated discovery index of top Claude ecosystem skills — 305 Featured, scored on 7 transparent signals, updated daily.',
      version: '1.0.0',
    },
    plugins,
  };

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(marketplace, null, 2), 'utf-8');

  log(`wrote ${OUTPUT_PATH} (${plugins.length} plugins)`);
  log('=== marketplace generator complete ===');
}

main();

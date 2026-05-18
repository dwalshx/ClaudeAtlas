#!/usr/bin/env node
/**
 * Deterministic 50k-record fixture generator for T2's Astro/Vite smoke.
 *
 * Each record carries ~5000-char body_markdown (matches production
 * truncation per CLAUDE.md and Research §A line 75). Total fixture size
 * on disk: ~450 MB — the realistic V8-ceiling-proximity test that
 * motivated the streaming foundation phase.
 *
 * Tier distribution:
 *   - Top:    2,500 records (5%)
 *   - Solid: 12,500 records (25%)
 *   - Listed: 35,000 records (70%)
 *
 * Categories distributed evenly across the 8 ClaudeAtlas categories.
 *
 * Deterministic via seeded PRNG keyed on record index — re-running
 * produces byte-identical output.
 *
 * Usage: node scripts/lib/__tests__/fixture-skills-50k.js [output_path]
 *   Default output: data/test-fixtures/skills-50k.ndjson
 */

import { mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeNdjsonStreaming } from '../ndjson.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const DEFAULT_OUTPUT = join(REPO_ROOT, 'data', 'test-fixtures', 'skills-50k.ndjson');

// Counts can be overridden via --count=N for smaller smoke fixtures
// (T2b uses ~3k records — Astro's build pipeline OOMs at 50k pages without
// tier filtering, which lands in T5; T2 proves the loader integration
// works at any meaningful page count).
const DEFAULT_TOTAL = 50000;
const DEFAULT_TIER_RATIOS = { top: 0.05, solid: 0.25, listed: 0.70 };
const CATEGORIES = [
  'AI & Automation',
  'Development',
  'Data & Analytics',
  'Content & Communication',
  'DevOps & Infrastructure',
  'Productivity',
  'Security',
  'Design',
];
const BODY_TARGET_CHARS = 5000;

// Mulberry32 — small deterministic PRNG. Seed from record index.
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Body words — small pool, deterministically sampled, padded to ~5000 chars.
const WORDS = [
  'agent', 'skill', 'claude', 'task', 'workflow', 'automation', 'data',
  'pipeline', 'context', 'tool', 'function', 'integration', 'api', 'mcp',
  'plugin', 'prompt', 'completion', 'embedding', 'vector', 'search',
  'index', 'retrieval', 'memory', 'state', 'session', 'project', 'file',
  'directory', 'commit', 'branch', 'merge', 'review', 'test', 'verify',
  'deploy', 'build', 'compile', 'lint', 'format', 'transform', 'parse',
];

function generateBody(rng) {
  const target = BODY_TARGET_CHARS;
  const parts = [];
  let len = 0;
  while (len < target) {
    const w = WORDS[Math.floor(rng() * WORDS.length)];
    parts.push(w);
    len += w.length + 1; // +1 for space
  }
  return parts.join(' ');
}

function tierFor(i, total, ratios) {
  const topCount = Math.floor(total * ratios.top);
  const solidCount = Math.floor(total * ratios.solid);
  if (i < topCount) return 'top';
  if (i < topCount + solidCount) return 'solid';
  return 'listed';
}

function qualityScoreFor(tier, rng) {
  if (tier === 'top') return Math.floor(90 + rng() * 10);
  if (tier === 'solid') return Math.floor(70 + rng() * 20);
  return Math.floor(40 + rng() * 30);
}

function* generateRecords(total, ratios) {
  for (let i = 0; i < total; i++) {
    const rng = mulberry32(i + 1);
    const tier = tierFor(i, total, ratios);
    const category = CATEGORIES[i % CATEGORIES.length];
    const owner = `owner${Math.floor(i / 10)}`;
    const name = `skill-${i}`;
    const slug = `${owner}/${name}`;
    const yieldRec = {
      id: `${owner}/repo${i % 100}/skills/${name}/SKILL.md`,
      name,
      slug,
      description: `Synthetic test skill ${i} for F1 streaming smoke.`,
      repo_full_name: `${owner}/repo${i % 100}`,
      repo_url: `https://github.com/${owner}/repo${i % 100}`,
      repo_stars: Math.floor(rng() * 10000),
      repo_pushed_at: new Date(2025, 0, 1 + (i % 365)).toISOString(),
      repo_created_at: new Date(2024, 0, 1 + (i % 365)).toISOString(),
      quality_score: qualityScoreFor(tier, rng),
      quality_tier: tier,
      category,
      tags: [],
      body_markdown: generateBody(rng),
      body_length: BODY_TARGET_CHARS,
      content_sha: `sha-${i}`,
      scraped_at: '2026-05-18T00:00:00Z',
    };
    yield yieldRec;
  }
}

function parseArgs(argv) {
  const args = { count: DEFAULT_TOTAL, outputPath: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--count=')) args.count = Number(a.slice('--count='.length));
    else if (a === '--count') args.count = Number(argv[++i]);
    else if (!args.outputPath) args.outputPath = a;
  }
  return args;
}

function main() {
  const { count, outputPath: argPath } = parseArgs(process.argv.slice(2));
  const outputPath = argPath || DEFAULT_OUTPUT;
  const outDir = dirname(outputPath);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const startTime = Date.now();
  console.log(`[fixture-50k] generating ${count} records to ${outputPath} ...`);
  writeNdjsonStreaming(outputPath, generateRecords(count, DEFAULT_TIER_RATIOS));
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[fixture-50k] wrote ${count} records in ${elapsed}s`);
}

main();

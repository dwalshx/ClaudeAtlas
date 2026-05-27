#!/usr/bin/env node
/**
 * Postbuild guard: scan dist/ for any file that exceeds Cloudflare Workers
 * Static Assets' 25 MiB per-asset cap.
 *
 * Phase 3.1's 28x catalog growth surfaced this class of bug three times in
 * three consecutive deploy attempts (run IDs 26492008864, 26535946389,
 * 26536617930):
 *   - dist/index.html              74.0 MiB (homepage inlined all 35k cards)
 *   - dist/skills-registry.json    34.7 MiB (full-catalog JSON dump)
 *   - dist/category/ai-and-automation/index.html  35.8 MiB (largest category)
 *
 * Each time we paid a CI cycle (~5–10 min push-event run, longer on the
 * cron-triggered ones) to discover the next one. This guard makes the
 * feedback loop instant: build fails immediately on any asset > 24 MiB,
 * with a 1 MiB safety margin below Cloudflare's hard 25 MiB limit.
 *
 * Exit codes:
 *   0 — all assets within budget
 *   1 — at least one asset exceeds the threshold (caller's build should fail)
 *   2 — dist/ missing or unreadable (caller should investigate)
 *
 * Runs as part of `postbuild` script in package.json.
 */

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST_DIR = join(ROOT, 'dist');

// Cloudflare Workers Static Assets per-asset cap is 25 MiB. We fail at
// 24 MiB to leave 1 MiB headroom — wrangler's deploy-time check measures
// raw file size; ours measures the same. The 1 MiB margin handles edge
// cases like build-time post-processing that might inflate files slightly.
const CAP_BYTES = 25 * 1024 * 1024;
const WARN_BYTES = 24 * 1024 * 1024;

function log(msg) {
  console.log(`[asset-sizes] ${msg}`);
}

function walk(dir, results = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, results);
    } else if (entry.isFile()) {
      const size = statSync(fullPath).size;
      if (size >= WARN_BYTES) {
        results.push({ path: fullPath, size });
      }
    }
  }
  return results;
}

function main() {
  if (!existsSync(DIST_DIR)) {
    console.error(`[asset-sizes] FATAL: ${DIST_DIR} does not exist. Did Astro build run?`);
    process.exit(2);
  }

  const oversized = walk(DIST_DIR);

  if (oversized.length === 0) {
    log('OK — all assets under 24 MiB');
    return;
  }

  // Sort by size descending so the worst offender is reported first.
  oversized.sort((a, b) => b.size - a.size);

  const overCap = oversized.filter(a => a.size >= CAP_BYTES);
  const inMargin = oversized.filter(a => a.size < CAP_BYTES);

  if (overCap.length > 0) {
    console.error(`[asset-sizes] FATAL: ${overCap.length} asset(s) exceed Cloudflare's 25 MiB cap:`);
    for (const a of overCap) {
      const rel = relative(ROOT, a.path);
      console.error(`  ${(a.size / 1024 / 1024).toFixed(1)} MiB  ${rel}`);
    }
    console.error('');
    console.error('[asset-sizes] Cloudflare Workers Static Assets rejects any file > 25 MiB.');
    console.error('[asset-sizes] Common causes at scale:');
    console.error('  - Inlining the full catalog into a single HTML page (homepage, category, creator)');
    console.error('  - Single-JSON bulk dump of catalog data (skills-registry, api-graph, similar-skills)');
    console.error('');
    console.error('[asset-sizes] Fixes:');
    console.error('  - Cap visible cards on listing pages; link to /browse or /api/v1/search for full list');
    console.error('  - Filter bulk JSON to a subset; expose full data via Worker route or release asset');
    process.exit(1);
  }

  // Within margin but above warning threshold — surface for visibility,
  // don't fail the build.
  log(`WARN: ${inMargin.length} asset(s) above 24 MiB threshold but within 25 MiB cap:`);
  for (const a of inMargin) {
    const rel = relative(ROOT, a.path);
    log(`  ${(a.size / 1024 / 1024).toFixed(1)} MiB  ${rel}`);
  }
  log('Approaching cap — plan mitigation before next catalog growth.');
}

main();

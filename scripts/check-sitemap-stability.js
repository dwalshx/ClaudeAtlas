#!/usr/bin/env node
/**
 * Pre/post-deploy URL stability gate (Phase 03.1.1 T5g / DOD-9).
 *
 * F1 changes URL routing in subtle ways (tier-aware rendering for skills,
 * sitemap customPages, worker fallback for Listed tier). DOD-9 is "every
 * URL in the pre-F1 sitemap.xml responds HTTP 200 on the post-F1 deploy".
 *
 * This script compares the pre-F1 sitemap snapshot (captured at T1 step 0,
 * lives at `.planning/phases/03.1.1-streaming-foundation/pre-f1-sitemap-
 * snapshot.xml`) against the live post-deploy sitemap fetched from
 * claudeatlas.com. Fails if ANY pre-F1 URL is missing from the live
 * sitemap.
 *
 * Runnable post-deploy, also intended as part of T5-verify-prod manual
 * checkpoint. Not part of the build's postbuild hook because it requires
 * live network access to the deployed site (CI runners would hit it
 * pre-deploy when the URLs aren't live yet).
 *
 * Limitation (NF-2 from plan-check Round 2): if a slug naturally drops
 * between T1 snapshot capture and deploy time (repo deleted, content_sha
 * changed enough to fail the filter gate), this fires a false positive.
 * Operator triages the missing URLs manually — most natural-drop cases
 * are easy to spot in the failure log.
 *
 * Usage:
 *   node scripts/check-sitemap-stability.js
 *     [--snapshot <path>]    Override pre-F1 snapshot path
 *     [--live-url <url>]     Override live sitemap URL
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_SNAPSHOT = join(
  ROOT,
  '.planning',
  'phases',
  '03.1.1-streaming-foundation',
  'pre-f1-sitemap-snapshot.xml',
);
const DEFAULT_LIVE_URL = 'https://claudeatlas.com/sitemap-0.xml';

function parseArgs(argv) {
  const args = { snapshot: DEFAULT_SNAPSHOT, liveUrl: DEFAULT_LIVE_URL };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--snapshot') args.snapshot = argv[++i];
    else if (a.startsWith('--snapshot=')) args.snapshot = a.slice('--snapshot='.length);
    else if (a === '--live-url') args.liveUrl = argv[++i];
    else if (a.startsWith('--live-url=')) args.liveUrl = a.slice('--live-url='.length);
  }
  return args;
}

function urlsFromSitemap(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

function main() {
  const { snapshot, liveUrl } = parseArgs(process.argv.slice(2));

  if (!existsSync(snapshot)) {
    console.error(`[sitemap-stability] FATAL: pre-F1 snapshot not found at ${snapshot}`);
    console.error('[sitemap-stability] T1 step 0 should have captured this. Check the file or pass --snapshot.');
    process.exit(2);
  }

  // Snapshot read uses readFileSync on .planning/ — allowed (file is a small,
  // bounded XML capture; lint scans data/ only).
  const preXml = readFileSync(snapshot, 'utf-8');
  const preUrls = urlsFromSitemap(preXml);
  console.log(`[sitemap-stability] pre-F1 snapshot: ${preUrls.length} URLs`);

  // Fetch live sitemap via curl (network egress required).
  // Use execFileSync with an args array (no shell) so the URL is passed as a
  // single argv entry and cannot be interpreted as shell syntax — closes the
  // command-injection vector from the prior shell-string execSync.
  let liveXml;
  try {
    liveXml = execFileSync('curl', ['-sLf', liveUrl], { encoding: 'utf-8' });
  } catch (err) {
    console.error(`[sitemap-stability] FATAL: failed to fetch ${liveUrl}: ${err.message}`);
    process.exit(2);
  }

  const liveUrls = urlsFromSitemap(liveXml);
  const liveSet = new Set(liveUrls);
  console.log(`[sitemap-stability] live sitemap:    ${liveUrls.length} URLs`);

  const missing = preUrls.filter((u) => !liveSet.has(u));
  if (missing.length > 0) {
    console.error(`[sitemap-stability] FATAL: ${missing.length} pre-F1 URL(s) missing from live sitemap.`);
    console.error('[sitemap-stability] Sample (first 20):');
    missing.slice(0, 20).forEach((u) => console.error(`  - ${u}`));
    console.error('');
    console.error('[sitemap-stability] If these are legitimate natural drops (repo deleted, content_sha');
    console.error('[sitemap-stability] changed enough to fail filter), document and rerun. Otherwise the');
    console.error('[sitemap-stability] tier-aware rendering or customPages config is dropping URLs.');
    process.exit(1);
  }

  console.log('[sitemap-stability] OK: all pre-F1 URLs still present in live sitemap');
}

main();

#!/usr/bin/env node
/**
 * scripts/test/upcaster-render-test.js — F2 Smoke E.2.
 *
 * Re-renders the 5 skill pages whose pre-F2 HTML was captured to
 * `data/regression-html/` by T2's capture script. Diffs the new HTML
 * against the snapshot. Tolerable: whitespace + `data-tags`/`data-entity-*`
 * attribute additions only.
 *
 * Implementation: this test relies on Astro's build output rather than
 * a one-off render call (Astro doesn't expose a programmatic
 * single-page renderer cheaply). Run `npm run build` BEFORE invoking
 * this test. The test reads `dist/skills/<slug>/index.html` and diffs
 * against the snapshot.
 *
 * Exits 0 on identical (modulo tolerable diffs); non-zero otherwise.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SNAP_DIR = join(REPO_ROOT, 'data', 'regression-html');
const DIST_SKILLS = join(REPO_ROOT, 'dist', 'skills');

function snapshotToSlug(filename) {
  // 'aiskillstore_auth-integration.html' -> 'aiskillstore/auth-integration'
  // Owner segment never contains an underscore in our data; subsequent
  // underscores within the skill name are preserved.
  const stem = basename(filename, '.html');
  const idx = stem.indexOf('_');
  if (idx === -1) return stem;
  return stem.slice(0, idx) + '/' + stem.slice(idx + 1);
}

// Normalize for whitespace-tolerant diff. Collapse runs of whitespace and
// strip data-attribute additions that F2 is allowed to introduce
// (`data-tags`, `data-entity-type`, etc).
function normalize(html) {
  return html
    .replace(/\s+/g, ' ')
    .replace(/\s+data-tags="[^"]*"/g, '')
    .replace(/\s+data-entity-type="[^"]*"/g, '')
    .replace(/\s+data-canonical-id="[^"]*"/g, '')
    .trim();
}

function main() {
  if (!existsSync(SNAP_DIR)) {
    console.error(`[upcaster-render-test] ${SNAP_DIR} missing — run T2 capture-regression-fixtures first`);
    process.exit(2);
  }
  if (!existsSync(DIST_SKILLS)) {
    console.error(`[upcaster-render-test] ${DIST_SKILLS} missing — run \`npm run build\` first`);
    process.exit(2);
  }

  const snapFiles = readdirSync(SNAP_DIR).filter((f) => f.endsWith('.html'));
  if (snapFiles.length === 0) {
    console.error('[upcaster-render-test] no .html snapshots found');
    process.exit(2);
  }

  let identical = 0;
  let differs = 0;
  const failures = [];

  for (const f of snapFiles) {
    const snapPath = join(SNAP_DIR, f);
    const slug = snapshotToSlug(f);
    const distHtml = join(DIST_SKILLS, slug, 'index.html');

    if (!existsSync(distHtml)) {
      failures.push({ slug, error: `missing rebuilt HTML at ${distHtml}` });
      differs++;
      continue;
    }

    const before = normalize(readFileSync(snapPath, 'utf-8'));
    const after = normalize(readFileSync(distHtml, 'utf-8'));

    if (before === after) {
      identical++;
    } else {
      // Sample first 200 chars of divergence
      let i = 0;
      while (i < before.length && i < after.length && before[i] === after[i]) i++;
      const sliceBefore = before.slice(Math.max(0, i - 40), i + 80);
      const sliceAfter = after.slice(Math.max(0, i - 40), i + 80);
      failures.push({ slug, error: `diverged at offset ${i}: BEFORE=${JSON.stringify(sliceBefore)} AFTER=${JSON.stringify(sliceAfter)}` });
      differs++;
    }
  }

  console.log(`[upcaster-render-test] ${identical}/${snapFiles.length} pages render identical (modulo whitespace + data-* additions)`);
  if (failures.length > 0) {
    for (const f of failures) {
      console.error(`  FAIL ${f.slug}: ${f.error}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main();

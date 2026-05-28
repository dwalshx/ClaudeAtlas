#!/usr/bin/env node
/**
 * scripts/lint-no-legacy-skill-shape.js — F2 CI guard rail (B1).
 *
 * Phase 3.1.2 — Polymorphic Entity Envelope.
 *
 * Scans the repo for legacy v1 skill-shape patterns that should have
 * been migrated to v2 EntityRecord<SkillExtra>'s extra.* paths in T7,
 * T7.5, T8. Per the F2 cutover plan:
 *   - D+0 through D+6: lint runs in WARNING mode (stderr, exit 0).
 *   - D+7 cutover commit: flip to ERROR (exit 1 on any hit).
 *
 * Banned READ patterns (consumers must read via entity.extra.* or use
 * the upcaster's dual-shape fallback `skill.extra?.X ?? skill.X`):
 *   - skill.body_markdown        (use skill.extra.body_markdown)
 *   - skill.frontmatter          (use skill.extra.frontmatter)
 *   - skill.has_name             (use skill.extra.has_name)
 *   - skill.has_description      (use skill.extra.has_description)
 *   - skill.skill_path           (use skill.extra.skill_path)
 *   - skill.skill_first_commit_at (use skill.extra.skill_first_commit_at)
 *
 * Banned WRITE-SITE patterns (object-literal keys outside upcaster /
 * migrator / tests):
 *   - skill_path:
 *   - body_markdown:
 *   - has_name:
 *   - has_description:
 *   - skill_first_commit_at:
 *
 * Excluded files:
 *   - scripts/lib/legacy-skill-reader.js  (upcaster — owns the v1→v2 lift)
 *   - scripts/migrate-to-entities.js      (T9 migrator — also owns the lift)
 *   - scripts/lib/types.* / src/lib/types.* (the typedefs themselves)
 *   - scripts/test/**, **__tests__/**, *.test.js (test fixtures)
 *   - node_modules/, dist/, data/
 *
 * Modes:
 *   --mode=warning (default): exit 0, log to stderr
 *   --mode=error              exit 1 on any hit (used on D+7 cutover)
 *
 * Env var LINT_LEGACY_SHAPE_LEVEL also honoured (=warning|error).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const READ_PATTERNS = [
  // Property access shapes
  /\bskill\.body_markdown\b/,
  /\bskill\.frontmatter\b/,
  /\bskill\.has_name\b/,
  /\bskill\.has_description\b/,
  /\bskill\.skill_path\b/,
  /\bskill\.skill_first_commit_at\b/,
];

const WRITE_SITE_PATTERNS = [
  // Object-literal key shapes (B1 pre-T11 grep gate).
  // We deliberately do NOT match `key: value` inside test fixtures or
  // upcaster output — those paths are in the excluded set below.
  /^\s*body_markdown\s*:/m,
  /^\s*frontmatter\s*:/m,
  /^\s*has_name\s*:/m,
  /^\s*has_description\s*:/m,
  /^\s*skill_path\s*:/m,
  /^\s*skill_first_commit_at\s*:/m,
];

const EXCLUDE = [
  /scripts[\\/]lib[\\/]legacy-skill-reader\.js$/,
  /scripts[\\/]migrate-to-entities\.js$/,
  /scripts[\\/]lib[\\/]recipes[\\/]skill\.recipe\.js$/,  // recipe parse() output IS the v2 envelope source
  /scripts[\\/]parse-skill\.js$/,                         // parser output: feeds the recipe
  /scripts[\\/]scrape\.js$/,                              // scraper writes v1 records; T9 migrates them
  /scripts[\\/]scrape-discover-repos\.js$/,               // Track 2 scraper, same as above (B1 (b) fallback)
  /scripts[\\/]scrape-plugins\.js$/,                      // plugin scraper (3.2 input, not F2 scope)
  /scripts[\\/]filter\.js$/,                              // filter writes v1 records (T9 migrates)
  /scripts[\\/]score\.js$/,                               // score reads frontmatter — input is raw
  /[\\/]types\.(js|d\.ts)$/,                              // typedefs are the schema authority
  /[\\/]__tests__[\\/]/,
  /[\\/]test[\\/]/,                                       // scripts/test/ harnesses
  /\.test\.(js|mjs)$/,
  /[\\/]node_modules[\\/]/,
  /[\\/]dist[\\/]/,
  /[\\/]data[\\/]/,
  /lint-no-legacy-skill-shape\.js$/,                      // this file contains the regexes as literals
  /check-banned-patterns\.js$/,                           // sibling lint — also contains the strings
];

const SCAN_ROOTS = ['src', 'scripts', 'worker'];
const SOURCE_EXTS = new Set(['.js', '.mjs', '.astro', '.ts']);

function parseArgs(argv) {
  let mode = process.env.LINT_LEGACY_SHAPE_LEVEL === 'error' ? 'error' : 'warning';
  for (const a of argv) {
    if (a.startsWith('--mode=')) mode = a.slice('--mode='.length);
  }
  if (!['warning', 'error'].includes(mode)) {
    console.error(`[lint-legacy-shape] unknown mode '${mode}'; expected warning|error`);
    process.exit(2);
  }
  return { mode };
}

function* walk(rootAbs) {
  let st;
  try { st = statSync(rootAbs); } catch { return; }
  if (st.isFile()) { yield rootAbs; return; }
  if (!st.isDirectory()) return;
  for (const ent of readdirSync(rootAbs, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === '.git') continue;
    const p = join(rootAbs, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else if (ent.isFile()) yield p;
  }
}

function isExcluded(rel) {
  const norm = rel.split(sep).join('/');
  return EXCLUDE.some((re) => re.test(norm));
}

function extOf(p) {
  const i = p.lastIndexOf('.');
  return i === -1 ? '' : p.slice(i).toLowerCase();
}

function scanFile(abs, rel, hits) {
  let content;
  try { content = readFileSync(abs, 'utf-8'); } catch { return; }
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // READ patterns. The upcaster's dual-shape pattern
    // `skill.extra?.X ?? skill.X` LOOKS like a legacy read on the
    // fallback half — but it's the documented safe pattern through
    // the cutover window. Skip lines that contain `extra?` to
    // tolerate the fallback shape.
    if (line.includes('extra?')) continue;
    if (line.includes('extra.')) continue;  // also tolerate `entity.extra.X` reads

    for (const re of READ_PATTERNS) {
      if (re.test(line)) {
        hits.push({ kind: 'legacy-read', file: rel, line: i + 1, text: line.trim() });
        break;
      }
    }

    // WRITE-SITE patterns
    for (const re of WRITE_SITE_PATTERNS) {
      if (re.test(line)) {
        hits.push({ kind: 'legacy-write-site', file: rel, line: i + 1, text: line.trim() });
        break;
      }
    }
  }
}

function main() {
  const { mode } = parseArgs(process.argv.slice(2));
  const hits = [];

  for (const root of SCAN_ROOTS) {
    const abs = join(REPO_ROOT, root);
    for (const f of walk(abs)) {
      const ext = extOf(f);
      if (!SOURCE_EXTS.has(ext)) continue;
      const rel = relative(REPO_ROOT, f);
      if (isExcluded(rel)) continue;
      scanFile(f, rel, hits);
    }
  }

  // Normalize paths
  for (const h of hits) h.file = h.file.split(sep).join('/');

  if (hits.length === 0) {
    console.log(`[lint-legacy-shape] mode=${mode}: clean (0 legacy-shape hits)`);
    process.exit(0);
  }

  const prefix = mode === 'error' ? 'ERROR' : 'WARN';
  for (const h of hits) {
    const msg = `${prefix} ${h.kind}: ${h.file}:${h.line}\n    ${h.text}`;
    if (mode === 'error') {
      console.error(msg);
    } else {
      // warning mode: still log to stderr for visibility but DON'T fail.
      console.error(msg);
    }
  }
  console.error(`[lint-legacy-shape] mode=${mode}: ${hits.length} legacy-shape hit(s)`);

  if (mode === 'error') process.exit(1);
  process.exit(0);
}

main();

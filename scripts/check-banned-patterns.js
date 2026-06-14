#!/usr/bin/env node
/**
 * scripts/check-banned-patterns.js — F1 lint gate.
 *
 * Scans the source tree for code patterns proven to crash the pipeline at
 * scale (the V8 ~536 MB single-string ceiling). See Research §A in
 * `.planning/research/2026-05-17-pipeline-scaling-polymorphic-entities.md`
 * and CLAUDE.md "Pipeline footguns" for the full rationale.
 *
 * Banned patterns:
 *   A: readFileSync(<data/...>, 'utf-8')       — full-file string read
 *   B: JSON.stringify(arr, null, 2)            — pretty-printed records array
 *   C: records.map(JSON.stringify).join(...)   — Rev 2 B3
 *   D: array.push(JSON.stringify(...)) + array.join('')  within 40 lines — Rev 2 B3 follow-on
 *   E: .github/workflows/*.yml inline `node -e "...JSON.parse(readFileSync(...))..."` — Rev 2 B4
 *
 * Modes:
 *   --mode=lint      (default)  Fail on any non-allowlisted hit.
 *   --mode=baseline              Snapshot existing hits to .lint-baseline.json; exit 0.
 *                                Use for migration windows where some intentional
 *                                hits exist before allowlist entries are written.
 *
 * Allowlist (LINT_ALLOWLIST below) documents the bounded-file reads that
 * stay sync per Research §A.
 *
 * Flags:
 *   --scan-path=<dir>   Scan a specific directory instead of the default
 *                       walk set (used by tests).
 *   --mode=baseline|lint
 *   --baseline-file=<path>   Defaults to .lint-baseline.json at repo root.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Allowlist — Rev 2 F3 + Research §A citations.
//
// Each entry is checked against the relative-from-repo-root path. `line`
// may be a number (exact line), a [start,end] tuple, or undefined (whole
// file). `pattern` may be a regex to match the line content; if both
// `line` and `pattern` are present, both must hold.
// ---------------------------------------------------------------------------
const LINT_ALLOWLIST = [
  {
    file: 'scripts/lib/ndjson.js',
    reason: 'helper itself — defines the chunked I/O primitives',
  },
  {
    file: 'scripts/lib/__tests__/ndjson.test.js',
    reason: 'tests for the helper; fixtures intentionally contain banned strings',
  },
  {
    // Allow any test file under __tests__ or *.test.js
    pathRegex: /(__tests__|\.test\.(js|mjs))/,
    reason: 'test files; fixtures may contain banned strings',
  },
  {
    file: 'src/lib/skills.js',
    line: 21,
    reason: 'similar-skills.json read — bounded JSON sidecar (Research §A line 75, safe through 200k records)',
  },
  {
    file: 'src/lib/skills.js',
    line: 30,
    reason: 'api-graph.json read — bounded JSON sidecar (Research §A line 75, safe at projected catalog sizes)',
  },
  {
    file: 'scripts/check-banned-patterns.js',
    reason: 'the lint script itself contains the banned-pattern regexes as string literals',
  },
  // ---------------------------------------------------------------------------
  // T5 5h: bounded-sidecar writers. Each entry is a JSON.stringify(x, null, 2)
  // write to a sidecar file that's structurally bounded — total size grows
  // sub-linearly with catalog size, and stays well under V8's ~536 MB string
  // limit at projected scales. Documenting here lets us flip the lint to
  // strict mode without losing the ability to keep these sidecars human-
  // readable in git.
  // ---------------------------------------------------------------------------
  {
    file: 'scripts/compute-clusters.js',
    line: 304,
    reason: 'skill-clusters.json write — bounded ~100 KB (k=16 clusters × cluster metadata)',
  },
  {
    file: 'scripts/filter.js',
    line: 555,
    reason: 'pipeline-stats.json write — bounded (~5 KB; tier counts + categories summary + 3.2.1 content_flags counts). Line shifted by F2 T6 + 3.1.2 drift hotfix + 3.1.4 v2-writer imports + 3.2 T7 tier-assignment extraction + body_length invariant warn-not-throw fragility fix + 3.2.1 Audit B annotation pass.',
  },
  {
    file: 'scripts/filter-plugins.js',
    line: 290,
    reason: 'pipeline-stats.json plugin-section merge write — bounded (~5 KB; tier counts). Phase 3.2 T7. Line shifted by 3.3-01 D-08 (resolveMarketplaceListings declared-name propagation).',
  },
  {
    file: 'scripts/filter-mcps.js',
    line: 246,
    reason: 'pipeline-stats.json mcp-section merge write — bounded (~5 KB; tier counts). Phase 3.2 T7.',
  },
  {
    file: 'scripts/filter.js',
    line: 491,
    reason: 'slug-redirects.json write — bounded by collision count (~402 entries at 33k catalog; <2000 long-term per RECALIBRATION.md Deviation 4). Line shifted by F2 T6 + 3.1.2 drift hotfix + 3.1.4 v2-writer imports.',
  },
  {
    file: 'scripts/generate-marketplace.js',
    line: 121,
    reason: 'marketplace.json write — bounded by Featured-tier count (~100 entries at projected scales)',
  },
  {
    file: 'scripts/lib/publish-kv.js',
    line: 84,
    reason: 'kv-published.json slug→sha sidecar write — bounded ~4 MB at 50k slugs (catalog-size linear, ~80 B/entry). Line shifted by F2 T10 (extra.body_markdown fallback in content_sha helper).',
  },
  {
    file: 'scripts/mine-apis.js',
    line: 281,
    reason: 'api-graph.json write — bounded by services × skill integrations (Research §A: safe at projected scales). Line shifted by F2 T8 (extra.body_markdown read).',
  },
  {
    file: 'scripts/scrape-plugins.js',
    line: 520,
    reason: 'plugins-meta.json sidecar write (T6 migration done — bulk records went to plugins-raw.ndjson). Metadata is bounded ~1 KB at any catalog size. Line shifted by 3.3-01 D-02 (loadCheckpoint NDJSON fix + invoked-as-script guard) and 3.4-01 Change A (buildProcessedSeedFrom export + resume log line).',
  },
  {
    file: 'scripts/scrape.js',
    line: 624,
    reason: 'pipeline-stats.json write (Track 2) — bounded (~5 KB; same shape as filter.js stats write)',
  },
  // ---------------------------------------------------------------------------
  // Phase 3.1.3 — Agent Hub generators. All bounded outputs (~1-10 KB each).
  // ---------------------------------------------------------------------------
  {
    file: 'scripts/generate-llms-txt.js',
    reason: 'llms.txt template render — bounded ~5 KB plaintext output; pipeline-stats.json sidecar read',
  },
  {
    file: 'scripts/generate-feeds.js',
    reason: 'JSON Feed 1.1 generator — 3 bounded files (~1-5 KB each) capped at 25/50/100 items; history snapshot reads are bounded sidecars',
  },
];

// ---------------------------------------------------------------------------
// Default scan set.
// ---------------------------------------------------------------------------
const DEFAULT_SCAN_ROOTS = [
  'scripts',
  'worker',
  'src',
  '.github/workflows',
  'astro.config.mjs',
  'wrangler.toml',
];

const SOURCE_EXTS = new Set(['.js', '.mjs', '.astro']);
const YAML_EXTS = new Set(['.yml', '.yaml']);

// ---------------------------------------------------------------------------
// Banned-pattern detectors.
// ---------------------------------------------------------------------------
const BANNED_A_RE = /readFileSync\s*\(\s*[^,)]+,\s*['"]utf-?8['"]\s*\)/;
const BANNED_B_RE = /JSON\.stringify\s*\(\s*[^,)]+,\s*null,\s*2\s*\)/;
const BANNED_C_RE = /\.map\s*\(\s*JSON\.stringify\s*\)\s*\.join\s*\(/;
const BANNED_E_RE = /node\s+-e\s+["'][^"']*(readFileSync|JSON\.parse|JSON\.stringify)/;

// Banned D is structural: file contains BOTH
//   <var>.push(JSON.stringify(...))
//   <var>.join('')
// within 40 lines of each other. We don't insist the variable names match
// (too brittle to refactor) — proximity is the heuristic.
const BANNED_D_PUSH_RE = /\.push\s*\(\s*JSON\.stringify\s*\(/;
const BANNED_D_JOIN_RE = /\.join\s*\(\s*['"]['"]\s*\)/;
const BANNED_D_WINDOW = 40;

// ---------------------------------------------------------------------------
// Arg parsing.
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  // T5 5h: default flipped from 'baseline' to 'lint' (strict). All
  // expected hits are now documented in LINT_ALLOWLIST with rationale.
  // Any new readFileSync/JSON.stringify pattern in scripts/ or workflows
  // fails CI loudly unless explicitly allowlisted.
  const args = { mode: 'lint', scanPath: null, baselineFile: join(REPO_ROOT, '.lint-baseline.json') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--mode=')) args.mode = a.slice('--mode='.length);
    else if (a === '--mode') args.mode = argv[++i];
    else if (a.startsWith('--scan-path=')) args.scanPath = a.slice('--scan-path='.length);
    else if (a === '--scan-path') args.scanPath = argv[++i];
    else if (a.startsWith('--baseline-file=')) args.baselineFile = a.slice('--baseline-file='.length);
    else if (a === '--baseline-file') args.baselineFile = argv[++i];
  }
  if (!['baseline', 'lint'].includes(args.mode)) {
    console.error(`unknown --mode=${args.mode}; expected baseline|lint`);
    process.exit(2);
  }
  return args;
}

// ---------------------------------------------------------------------------
// File walk.
// ---------------------------------------------------------------------------
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

function extOf(p) {
  const i = p.lastIndexOf('.');
  return i === -1 ? '' : p.slice(i).toLowerCase();
}

// ---------------------------------------------------------------------------
// Allowlist check.
// ---------------------------------------------------------------------------
function isAllowlisted(relPath, lineNum, lineText) {
  const relNorm = relPath.split(sep).join('/');
  for (const a of LINT_ALLOWLIST) {
    if (a.pathRegex) {
      if (a.pathRegex.test(relNorm)) return a.reason;
      continue;
    }
    if (a.file && a.file !== relNorm) continue;
    if (a.line !== undefined) {
      if (typeof a.line === 'number') {
        // Tolerance: ±1 line to survive trivial reformatting.
        if (Math.abs(a.line - lineNum) <= 1) return a.reason;
      } else if (Array.isArray(a.line)) {
        if (lineNum >= a.line[0] && lineNum <= a.line[1]) return a.reason;
      }
      continue;
    }
    if (a.pattern) {
      if (a.pattern.test(lineText)) return a.reason;
      continue;
    }
    // file-only allowlist: whole file exempt
    return a.reason;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-file scan.
// ---------------------------------------------------------------------------
function scanSourceFile(absPath, relPath, hits) {
  let content;
  try { content = readFileSync(absPath, 'utf-8'); } catch { return; }
  const lines = content.split('\n');

  // Lightweight per-line checks for A, B, C.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (BANNED_A_RE.test(line)) {
      // Banned A: only flag if the same file also references a data/ path.
      // (Rev 2 plan §T1 step 3 says "flag if same file has top-level
      // data/-rooted path constant" — heuristic: any string literal
      // starting with 'data/' or "data/" anywhere in the file.)
      if (/['"]data\//.test(content)) {
        const reason = isAllowlisted(relPath, lineNum, line);
        if (reason) {
          // Allowed; log but don't add to hits.
          continue;
        }
        hits.push({ kind: 'Banned A', file: relPath, line: lineNum, text: line.trim() });
      }
    }
    if (BANNED_B_RE.test(line)) {
      // Banned B: any pretty-printed JSON.stringify in scripts/.
      if (relPath.startsWith('scripts/') || relPath.startsWith('scripts\\')) {
        const reason = isAllowlisted(relPath, lineNum, line);
        if (reason) continue;
        hits.push({ kind: 'Banned B', file: relPath, line: lineNum, text: line.trim() });
      }
    }
    if (BANNED_C_RE.test(line)) {
      const reason = isAllowlisted(relPath, lineNum, line);
      if (reason) continue;
      hits.push({ kind: 'Banned C', file: relPath, line: lineNum, text: line.trim() });
    }
  }

  // Banned D: structural, look for push(JSON.stringify(... within WINDOW lines of join('').
  const pushLines = [];
  const joinLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (BANNED_D_PUSH_RE.test(lines[i])) pushLines.push(i + 1);
    if (BANNED_D_JOIN_RE.test(lines[i])) joinLines.push(i + 1);
  }
  for (const p of pushLines) {
    for (const j of joinLines) {
      if (Math.abs(p - j) <= BANNED_D_WINDOW) {
        // Allowlist on the join line (the typical hot spot).
        const reason = isAllowlisted(relPath, j, lines[j - 1] || '');
        if (reason) break;
        hits.push({
          kind: 'Banned D',
          file: relPath,
          line: j,
          text: `push(JSON.stringify(...)) at L${p} + .join('') at L${j} within ${BANNED_D_WINDOW} lines`,
        });
        break;
      }
    }
  }
}

function scanWorkflowFile(absPath, relPath, hits) {
  let content;
  try { content = readFileSync(absPath, 'utf-8'); } catch { return; }
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (BANNED_E_RE.test(line)) {
      const reason = isAllowlisted(relPath, i + 1, line);
      if (reason) continue;
      hits.push({ kind: 'Banned E', file: relPath, line: i + 1, text: line.trim() });
    }
  }
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv.slice(2));

  const scanRoots = args.scanPath
    ? [resolve(args.scanPath)]
    : DEFAULT_SCAN_ROOTS.map((p) => join(REPO_ROOT, p));

  // When --scan-path is provided, treat that dir as the base for relative
  // paths so allowlist entries (which are repo-relative) still work for the
  // common case of scanning the real repo, but tests that point at /tmp
  // fixtures get clean relative paths under that fixture root.
  const relBase = args.scanPath ? resolve(args.scanPath) : REPO_ROOT;

  const hits = [];
  for (const root of scanRoots) {
    for (const file of walk(root)) {
      const ext = extOf(file);
      const rel = relative(relBase, file);
      if (SOURCE_EXTS.has(ext) || file.endsWith('astro.config.mjs') || file.endsWith('wrangler.toml')) {
        scanSourceFile(file, rel, hits);
      } else if (YAML_EXTS.has(ext) && (file.includes('.github/workflows') || file.includes('.github\\workflows'))) {
        scanWorkflowFile(file, rel, hits);
      }
    }
  }

  // Normalize paths to forward slashes for stable baseline diffs.
  for (const h of hits) {
    h.file = h.file.split(sep).join('/');
  }

  if (args.mode === 'baseline') {
    // Always write baseline; exit 0 (or 1 only on I/O error).
    const baseline = {
      generated_at: new Date().toISOString(),
      hits: hits.map((h) => ({ kind: h.kind, file: h.file, line: h.line })),
    };
    try {
      writeFileSync(args.baselineFile, JSON.stringify(baseline, null, 2) + '\n', 'utf-8');
    } catch (err) {
      console.error(`failed to write baseline: ${err.message}`);
      process.exit(2);
    }
    console.log(`[check-banned-patterns] baseline mode: ${hits.length} hit(s) recorded in ${relative(REPO_ROOT, args.baselineFile)}`);
    for (const h of hits) {
      console.log(`  ${h.kind}: ${h.file}:${h.line}`);
    }
    process.exit(0);
  }

  // --mode=lint
  // Load baseline if present; only fail on NEW hits.
  let baselineHits = [];
  if (existsSync(args.baselineFile)) {
    try {
      const parsed = JSON.parse(readFileSync(args.baselineFile, 'utf-8'));
      baselineHits = parsed.hits || [];
    } catch {
      // ignore — empty baseline
    }
  }
  const baselineKey = (h) => `${h.kind}|${h.file}|${h.line}`;
  const baselineSet = new Set(baselineHits.map(baselineKey));

  const newHits = hits.filter((h) => !baselineSet.has(baselineKey(h)));

  if (newHits.length === 0) {
    console.log(`[check-banned-patterns] lint mode: clean (${hits.length} baselined, 0 new)`);
    process.exit(0);
  }

  console.error(`[check-banned-patterns] FAIL: ${newHits.length} new violation(s):`);
  for (const h of newHits) {
    console.error(`  ${h.kind}: ${h.file}:${h.line}`);
    if (h.text) console.error(`    ${h.text}`);
  }
  process.exit(1);
}

main();

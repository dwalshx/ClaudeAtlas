#!/usr/bin/env node
/**
 * scripts/check-skills-size.js — F1 size gate.
 *
 * For each `data/*.json` and `data/*.ndjson`, statSync and report size.
 * Fails (exit 1) if any file exceeds the threshold (default 400 MB).
 *
 * Rationale: V8's ~536 MB single-string limit is the load-bearing
 * constraint. 400 MB is the safety margin — once a data file crosses it,
 * the next quarter's growth (~5 MB/day per CLAUDE.md) puts us at the
 * ceiling. The gate fires loudly so we can migrate that file to NDJSON
 * (if it isn't already) before production crashes.
 *
 * Flags:
 *   --threshold=<MB>     Override the 400 MB default.
 *   --scan-path=<dir>    Scan a specific directory instead of `data/`.
 *                        (Used by tests.)
 */

import { statSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { thresholdMb: 400, scanPath: join(REPO_ROOT, 'data') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--threshold=')) args.thresholdMb = Number(a.slice('--threshold='.length));
    else if (a === '--threshold') args.thresholdMb = Number(argv[++i]);
    else if (a.startsWith('--scan-path=')) args.scanPath = a.slice('--scan-path='.length);
    else if (a === '--scan-path') args.scanPath = argv[++i];
  }
  if (!Number.isFinite(args.thresholdMb) || args.thresholdMb <= 0) {
    console.error(`invalid --threshold; expected positive number`);
    process.exit(2);
  }
  return args;
}

function mb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scanAbs = resolve(args.scanPath);

  if (!existsSync(scanAbs)) {
    console.log(`[check-skills-size] scan-path does not exist: ${scanAbs} — nothing to check.`);
    process.exit(0);
  }

  let entries;
  try {
    entries = readdirSync(scanAbs, { withFileTypes: true });
  } catch (err) {
    console.error(`[check-skills-size] failed to read ${scanAbs}: ${err.message}`);
    process.exit(2);
  }

  // Files that legitimately exceed the V8 string limit but are safe because
  // they're (a) gitignored, (b) accessed via chunked I/O, and (c) never
  // committed or distributed. Documenting here rather than reading
  // .gitignore at runtime keeps the lint deterministic.
  //   - etag-cache.json: ~500 MB local, chunked writes via 82cc7ab,
  //     gitignored; documented in CLAUDE.md known-issue #1.
  const EXCLUDE = new Set(['etag-cache.json']);

  const thresholdBytes = args.thresholdMb * 1024 * 1024;
  const findings = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const name = ent.name;
    if (!name.endsWith('.json') && !name.endsWith('.ndjson')) continue;
    if (EXCLUDE.has(name)) continue;
    const p = join(scanAbs, name);
    const st = statSync(p);
    findings.push({ file: relative(REPO_ROOT, p), bytes: st.size, mb: Number(mb(st.size)) });
  }

  findings.sort((a, b) => b.bytes - a.bytes);

  console.log(`[check-skills-size] threshold: ${args.thresholdMb} MB`);
  for (const f of findings) {
    const marker = f.bytes > thresholdBytes ? '  FAIL' : '  ok';
    console.log(`${marker}  ${f.mb} MB  ${f.file}`);
  }

  const violators = findings.filter((f) => f.bytes > thresholdBytes);
  if (violators.length > 0) {
    console.error(`[check-skills-size] ${violators.length} file(s) exceed ${args.thresholdMb} MB`);
    process.exit(1);
  }
  process.exit(0);
}

main();

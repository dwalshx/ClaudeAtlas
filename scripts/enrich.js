#!/usr/bin/env node

/**
 * Phase 3.1 — Post-filter enrichment pass.
 *
 * Reads:
 *   - data/skills.ndjson (output of scripts/filter.js)
 *   - data/skill-vectors.ndjson (output of scripts/embed-skills.js)
 *
 * Computes:
 *   - is_duplicate: boolean — true when this skill has cosine sim > 0.92
 *     to another skill, AND another skill in that cluster is older.
 *   - canonical_slug: string | null — when is_duplicate=true, the slug of
 *     the older canonical skill.
 *   - novelty_score: number in [0,1] — 1 minus max cosine similarity to
 *     any other skill in the catalog. Computed for non-duplicates only;
 *     duplicates get null (their novelty is meaningless — they're a copy).
 *
 * Writes data/skills.ndjson back via atomic temp+rename (the underlying
 * writeNdjsonStreaming helper takes care of tmp+rename and is V8-string-
 * limit safe).
 *
 * Logging: all lines prefixed `[enrich]`.
 *
 * Idempotent: re-running on the same input produces the same output.
 *
 * Scaling: ANN candidate retrieval via scripts/lib/ann.js (HNSW in CI,
 * exact fallback on dev). ~O(N log N); 51k ≈ 6-10 min on GHA.
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readNdjsonRecords, writeNdjsonStreaming } from './lib/ndjson.js';
import { buildHeader } from './lib/entity-version.js';
// Phase 3.1 Rev 2 BLOCKER 1: import the REAL vectorizeId from embed-skills.js.
// A local re-implementation was wrong — it didn't handle the >64-char SHA
// branch, so most production IDs (`owner/repo/path/to/SKILL.md`) trivially
// exceed 64 chars and would silently fail to join. Fixed by sharing the
// canonical helper (which `export`s the function as of Task 4 Step 0).
import { vectorizeId } from './embed-skills.js';
import { topKNeighbors, normalizeFloat32, dot, annEngine } from './lib/ann.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SKILLS_PATH = join(ROOT, 'data', 'skills.ndjson');
const VECTORS_PATH = join(ROOT, 'data', 'skill-vectors.ndjson');

const DUP_THRESHOLD = 0.92;

// Phase 3.2 (Task 10, D-10): enrich.js gains entity-type dispatch.
//   --input <vectors.ndjson> --records <records.ndjson> [--entity-type <t>] [--dry-run]
// Defaults preserve the legacy skills-only invocation. MCP enrich is SKIPPED
// (planner-discretion per D-10): at N=38 the O(n²) dedup overhead exceeds any
// benefit. Plugin enrich runs the SAME cosine logic (N≈4,500, well within the
// O(n²) practicality window — skills already run at N≈35k).
function parseArgs(argv) {
  const out = { input: null, records: null, entityType: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') out.input = argv[++i];
    else if (a.startsWith('--input=')) out.input = a.slice('--input='.length);
    else if (a === '--records') out.records = argv[++i];
    else if (a.startsWith('--records=')) out.records = a.slice('--records='.length);
    else if (a === '--entity-type') out.entityType = argv[++i];
    else if (a.startsWith('--entity-type=')) out.entityType = a.slice('--entity-type='.length);
    else if (a === '--dry-run') out.dryRun = true;
  }
  return out;
}

function resolvePath(p) {
  if (!p) return null;
  return (p.startsWith('/') || /^[A-Za-z]:/.test(p)) ? p : join(ROOT, p);
}

function log(msg) { console.log(`[enrich] ${msg}`); }
function warn(msg) { console.warn(`[enrich] WARN: ${msg}`); }

/**
 * Decide which of two duplicates is canonical. Older wins.
 * Ladder: skill_first_commit_at > repo_created_at > repo_pushed_at.
 * Final tie-break: lexically smaller slug for determinism.
 *
 * Returns -1 if a is canonical, 1 if b is canonical.
 */
export function compareForCanonical(a, b) {
  const aFirst = a.skill_first_commit_at;
  const bFirst = b.skill_first_commit_at;
  if (aFirst && bFirst && aFirst !== bFirst) return aFirst < bFirst ? -1 : 1;
  if (aFirst && !bFirst) return -1;
  if (!aFirst && bFirst) return 1;
  // Both missing skill_first_commit_at → fallback to repo_created_at
  const aCreated = a.repo_created_at;
  const bCreated = b.repo_created_at;
  if (aCreated && bCreated && aCreated !== bCreated) return aCreated < bCreated ? -1 : 1;
  // Final fallback: repo_pushed_at (older repo activity wins)
  const aPushed = a.repo_pushed_at;
  const bPushed = b.repo_pushed_at;
  if (aPushed && bPushed && aPushed !== bPushed) return aPushed < bPushed ? -1 : 1;
  // Deterministic tie-break
  return (a.slug || '') < (b.slug || '') ? -1 : 1;
}

/**
 * Pure core: takes skills array + parsed vector records, returns mutated
 * skills array with is_duplicate / canonical_slug / novelty_score set.
 * Exported for testing — no I/O.
 */
export function enrichSkills(skills, vectorRecords) {
  // Build vector ID → values map from the NDJSON records
  const vecById = new Map();
  for (const rec of vectorRecords) {
    if (!rec || !rec.id || !rec.values) continue;
    vecById.set(rec.id, rec.values);
  }

  // For each skill, look up its vector via vectorizeId(skill.id)
  const present = []; // { skill, vec: Float32Array }
  const absent = [];  // skills with no embedding (graceful fall-through)
  for (const s of skills) {
    let vid;
    try { vid = vectorizeId(s.id); } catch { absent.push(s); continue; }
    const raw = vecById.get(vid);
    if (!raw) {
      absent.push(s);
      continue;
    }
    present.push({ skill: s, vec: normalizeFloat32(raw) });
  }

  log(`enriching ${present.length} skills with vectors (${absent.length} without — left as-is)`);

  // Determinism contract (ann.js): insertion order must be stable. Sort by
  // skill.id — present[] indexes stay internally consistent because every
  // downstream structure (nnSim, dupNeighbors, clusters) is index-based and
  // output writes go through present[i].skill references.
  present.sort((a, b) => (a.skill.id < b.skill.id ? -1 : a.skill.id > b.skill.id ? 1 : 0));

  const n = present.length;
  const nnSim = new Float32Array(n);
  for (let i = 0; i < n; i++) nnSim[i] = -1;

  // Adjacency: dup pairs above DUP_THRESHOLD.
  const dupNeighbors = Array.from({ length: n }, () => []);

  // Phase 3.2.1: ANN candidate retrieval replaces the O(n²) scan.
  // K_DUP=64 + efSearch=150 (locked decision). Misses-only error model:
  // ann.js exact-verifies every candidate sim via dot before returning, so
  // a pair above DUP_THRESHOLD can be MISSED (cluster split) but never
  // invented (false merge). Edges are symmetrized — either endpoint
  // finding the other suffices for BFS connectivity.
  const K_DUP = 64;
  const items = present.map((p) => ({ id: p.skill.id, vec: p.vec }));
  log(`ann: engine=${annEngine()} querying top-${K_DUP} candidates for ${n} records`);
  const neighborSets = topKNeighbors(items, K_DUP, { efSearch: 150 });
  for (let i = 0; i < n; i++) {
    for (const { idx: j, sim } of neighborSets[i]) {
      if (sim > nnSim[i]) nnSim[i] = sim;
      if (sim > nnSim[j]) nnSim[j] = sim;   // symmetrize novelty input too
      if (sim > DUP_THRESHOLD) {
        dupNeighbors[i].push(j);
        dupNeighbors[j].push(i);            // duplicate edges are fine — BFS visited-check tolerates them
      }
    }
    if ((i + 1) % 5000 === 0) log(`  ann candidates: ${i + 1}/${n}`);
  }

  // BFS clusters; oldest is canonical, others get is_duplicate=true.
  const visited = new Uint8Array(n);
  let dupCount = 0;
  let clusterCount = 0;

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    if (dupNeighbors[i].length === 0) continue;
    const cluster = [];
    const stack = [i];
    while (stack.length > 0) {
      const k = stack.pop();
      if (visited[k]) continue;
      visited[k] = 1;
      cluster.push(k);
      for (const nb of dupNeighbors[k]) if (!visited[nb]) stack.push(nb);
    }
    if (cluster.length < 2) continue;
    clusterCount++;
    let canonicalIdx = cluster[0];
    for (let c = 1; c < cluster.length; c++) {
      if (compareForCanonical(present[cluster[c]].skill, present[canonicalIdx].skill) < 0) {
        canonicalIdx = cluster[c];
      }
    }
    const canonicalSlug = present[canonicalIdx].skill.slug;
    for (const idx of cluster) {
      if (idx === canonicalIdx) {
        present[idx].skill.is_duplicate = false;
        present[idx].skill.canonical_slug = null;
      } else {
        present[idx].skill.is_duplicate = true;
        present[idx].skill.canonical_slug = canonicalSlug;
        dupCount++;
      }
    }
  }

  // Non-clustered records were ASSESSED but not duplicates → is_duplicate=false.
  for (let i = 0; i < n; i++) {
    if (!visited[i]) {
      present[i].skill.is_duplicate = false;
      present[i].skill.canonical_slug = null;
    }
  }

  // Novelty: non-duplicates only. Duplicates get null.
  for (let i = 0; i < n; i++) {
    const skill = present[i].skill;
    if (skill.is_duplicate) {
      skill.novelty_score = null;
    } else {
      const nn = nnSim[i] < 0 ? 0 : nnSim[i];
      skill.novelty_score = Math.max(0, Math.min(1, 1 - nn));
    }
  }

  // Records without vectors: keep placeholder nulls (signal "not assessed").
  for (const s of absent) {
    if (s.is_duplicate === undefined) s.is_duplicate = null;
    if (s.canonical_slug === undefined) s.canonical_slug = null;
    if (s.novelty_score === undefined) s.novelty_score = null;
  }

  return {
    skills,
    stats: {
      total: skills.length,
      enriched: present.length,
      missingVector: absent.length,
      duplicates: dupCount,
      clusters: clusterCount,
    },
  };
}

/**
 * Stream-read vectors NDJSON using readNdjsonRecords. The vectors file
 * (~32 MB at 1,078 records; grows linearly with catalog) is well under
 * V8's string limit today but using the chunked helper keeps us safe at
 * future scales (F1 streaming foundation invariant).
 */
function loadVectors(path) {
  if (!existsSync(path)) {
    warn(`${path} missing — skipping enrichment (Track-1-only day or pre-embed cold start).`);
    return null;
  }
  const map = readNdjsonRecords(path, { keyFn: r => r.id });
  return [...map.values()];
}

function main() {
  const args = parseArgs(process.argv);
  const recordsPath = resolvePath(args.records) || SKILLS_PATH;
  const vectorsPath = resolvePath(args.input) || VECTORS_PATH;

  log('=== enrichment start ===');

  if (!existsSync(recordsPath)) {
    warn(`${recordsPath} missing — nothing to enrich. Exiting 0.`);
    process.exit(0);
  }

  const recordsMap = readNdjsonRecords(recordsPath, { keyFn: r => r.id });
  const records = [...recordsMap.values()];
  log(`loaded ${records.length} records`);

  // Determine entity_type: explicit flag wins; else infer from records.
  const entityType = args.entityType
    || (records[0] && records[0].entity_type)
    || 'skill';
  log(`entity_type: ${entityType}`);

  // D-10: MCP enrich is intentionally skipped (N=38 below dedup threshold).
  if (entityType === 'mcp_server') {
    log(`skipping mcp_server (N=${records.length} below dedup threshold; dedup overhead exceeds benefit per D-10). Exiting 0.`);
    process.exit(0);
  }

  const vectorRecords = loadVectors(vectorsPath);
  if (!vectorRecords) {
    log('no vectors available; leaving placeholders as-is. Exiting 0.');
    process.exit(0);
  }
  log(`loaded ${vectorRecords.length} vectors`);

  const startTime = Date.now();
  // enrichSkills is entity-type-agnostic: it keys on .id/.slug/.repo_* fields
  // that every EntityRecord carries. canonical ordering falls through
  // skill_first_commit_at → repo_created_at → repo_pushed_at → slug.
  const { stats } = enrichSkills(records, vectorRecords);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  log(`enrichment complete in ${elapsed}s`);
  log(`stats: ${JSON.stringify(stats)}`);

  // Phase 3.1 Rev 2 FLAG 2: timing hard-warn — post-HNSW (Phase 3.2.1) this
  // doubles as the engine-fallback regression tripwire (RESEARCH.md Pitfall 2).
  if (Number(elapsed) > 600) {
    warn(`ran ${elapsed}s — post-HNSW this should be minutes; engine fallback or regression likely. Check '[ann] engine=' line above.`);
  }

  if (args.dryRun) {
    log('--dry-run: computed enrichment in memory, NOT writing records file.');
    log('=== enrichment done (dry-run) ===');
    return;
  }

  // Atomic NDJSON write via tmp+rename. Preserve the entity_type header so the
  // v2 sentinel is not lost on rewrite (skills.ndjson historically had no
  // header; for non-skill types we MUST write one).
  const header = entityType === 'skill' ? undefined : buildHeader(entityType);
  writeNdjsonStreaming(recordsPath, records, header ? { header } : {});
  log(`wrote ${recordsPath}`);
  log('=== enrichment done ===');
}

// Only run main() when invoked as a script, not when imported by tests.
const invokedAsScript = (() => {
  try {
    return import.meta.url === fileURLToPath(`file://${process.argv[1]}`).replace(/\\/g, '/')
      || fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (invokedAsScript) main();

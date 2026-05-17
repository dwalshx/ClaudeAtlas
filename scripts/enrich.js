#!/usr/bin/env node

/**
 * Phase 3.1 — Post-filter enrichment pass.
 *
 * Reads:
 *   - data/skills.json (output of scripts/filter.js)
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
 * Writes data/skills.json back via atomic temp+rename.
 *
 * Logging: all lines prefixed `[enrich]`.
 *
 * Idempotent: re-running on the same input produces the same output.
 *
 * Scaling: brute-force O(n²) cosine. n=1,885 ≈ 5s. n=5,000 ≈ 50s.
 * n=20,000 ≈ 800s (R2 in 3.1-CONTEXT.md — known cliff; defer LSH to
 * Phase 3.x if/when n grows past O(n²) practicality).
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Phase 3.1 Rev 2: import the REAL vectorizeId from embed-skills.js.
// The earlier local re-implementation was wrong — it didn't handle the
// >64-char SHA-prefix branch, so most production skill IDs (`owner/repo/path/
// to/SKILL.md`) trivially exceed 64 chars and would silently fail to join.
// Fixed in Task 4 Step 0: `export` keyword added to embed-skills.js's
// existing vectorizeId function, then imported here.
import { vectorizeId } from './embed-skills.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SKILLS_PATH = join(ROOT, 'data', 'skills.json');
const VECTORS_PATH = join(ROOT, 'data', 'skill-vectors.ndjson');
const TMP_PATH = SKILLS_PATH + '.tmp';

const DUP_THRESHOLD = 0.92;

function log(msg) { console.log(`[enrich] ${msg}`); }
function warn(msg) { console.warn(`[enrich] WARN: ${msg}`); }

/**
 * Pre-normalize a vector to unit length. After normalization, plain dot
 * product = cosine similarity. Stored as Float32 for ~2× speed.
 */
function normalizeFloat32(values) {
  const nv = new Float32Array(values.length);
  let n = 0;
  for (let i = 0; i < values.length; i++) n += values[i] * values[i];
  n = Math.sqrt(n);
  if (n === 0) return nv;
  for (let i = 0; i < values.length; i++) nv[i] = values[i] / n;
  return nv;
}

function dot(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

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
  return a.slug < b.slug ? -1 : 1;
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
    const vid = vectorizeId(s.id);
    const raw = vecById.get(vid);
    if (!raw) {
      absent.push(s);
      continue;
    }
    present.push({ skill: s, vec: normalizeFloat32(raw) });
  }

  log(`enriching ${present.length} skills with vectors (${absent.length} without — left as-is)`);

  // Compute pairwise sim; track max-similarity-to-any-other per skill,
  // and collect duplicate pairs (sim > DUP_THRESHOLD).
  const n = present.length;
  const nnSim = new Float32Array(n);  // nearest-neighbor cosine sim for each
  for (let i = 0; i < n; i++) nnSim[i] = -1;

  // Adjacency: for each i, the set of j's where sim(i,j) > DUP_THRESHOLD.
  // Used to build dup clusters (union-find lite via greedy canonical pick).
  const dupNeighbors = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = dot(present[i].vec, present[j].vec);
      if (s > nnSim[i]) nnSim[i] = s;
      if (s > nnSim[j]) nnSim[j] = s;
      if (s > DUP_THRESHOLD) {
        dupNeighbors[i].push(j);
        dupNeighbors[j].push(i);
      }
    }
    if ((i + 1) % 500 === 0) log(`  pairwise: ${i + 1}/${n}`);
  }

  // Assign canonical / duplicate flags by walking the dup graph.
  // For each connected component of dup pairs, the "oldest" record (by
  // compareForCanonical) is canonical; everyone else gets is_duplicate=true
  // and canonical_slug = canonical.slug.
  const visited = new Uint8Array(n);
  let dupCount = 0;
  let clusterCount = 0;

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    if (dupNeighbors[i].length === 0) continue;
    // BFS/DFS to gather the cluster
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
    // Pick canonical: min via compareForCanonical
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

  // Records that participated in NO dup pair: is_duplicate=false (not null —
  // we KNOW they're not a duplicate now; we ran the check).
  for (let i = 0; i < n; i++) {
    if (!visited[i] && present[i].skill.is_duplicate == null) {
      present[i].skill.is_duplicate = false;
      present[i].skill.canonical_slug = null;
    }
  }

  // Novelty: for non-duplicates, novelty = 1 - nnSim. Duplicates get null
  // (novelty of a copy is undefined by design).
  for (let i = 0; i < n; i++) {
    const skill = present[i].skill;
    if (skill.is_duplicate) {
      skill.novelty_score = null;
    } else {
      const nn = nnSim[i] < 0 ? 0 : nnSim[i];  // single-record edge case
      skill.novelty_score = Math.max(0, Math.min(1, 1 - nn));
    }
  }

  // Records without vectors: keep the placeholder nulls from filter.js
  // (is_duplicate=null, canonical_slug=null, novelty_score=null). This
  // signals "not assessed" vs. "assessed and not duplicate" (false).
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

function loadVectors(path) {
  if (!existsSync(path)) {
    warn(`${path} missing — skipping enrichment (Track-1-only day or pre-embed cold start).`);
    return null;
  }
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
  const recs = [];
  for (const line of lines) {
    try {
      recs.push(JSON.parse(line));
    } catch (e) {
      warn(`bad NDJSON line skipped: ${e.message}`);
    }
  }
  return recs;
}

function main() {
  log('=== enrichment start ===');

  if (!existsSync(SKILLS_PATH)) {
    warn(`${SKILLS_PATH} missing — nothing to enrich. Exiting 0.`);
    process.exit(0);
  }

  const skills = JSON.parse(readFileSync(SKILLS_PATH, 'utf-8'));
  log(`loaded ${skills.length} skills`);

  const vectorRecords = loadVectors(VECTORS_PATH);
  if (!vectorRecords) {
    log('no vectors available; leaving placeholders as-is. Exiting 0.');
    process.exit(0);
  }
  log(`loaded ${vectorRecords.length} vectors`);

  const startTime = Date.now();
  const { stats } = enrichSkills(skills, vectorRecords);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  log(`enrichment complete in ${elapsed}s`);
  log(`stats: ${JSON.stringify(stats)}`);

  // Phase 3.1 Rev 2 — FLAG 2: timing hard-warn.
  // Daily budget is 25 min for the WHOLE pipeline. enrich.js at 600s
  // (10 min) eats 40% of that and signals we're nearing the O(n²) cliff
  // documented in RESEARCH.md §R2. The HNSW migration path is sketched
  // in §Q7; trip this warning to start that work before the cliff hits.
  if (Number(elapsed) > 600) {
    warn(`ran ${elapsed}s — approaching 25-min daily budget; consider HNSW migration per RESEARCH.md §R2/§Q7`);
  }

  // Atomic write: temp file then rename. Prevents a half-written
  // skills.json from being deployed if the process dies mid-write.
  writeFileSync(TMP_PATH, JSON.stringify(skills, null, 2), 'utf-8');
  renameSync(TMP_PATH, SKILLS_PATH);
  log(`wrote ${SKILLS_PATH}`);
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

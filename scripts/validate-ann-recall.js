#!/usr/bin/env node

/**
 * scripts/validate-ann-recall.js — one-shot HNSW-vs-exact recall validation
 * (Phase 3.2.1 Plan 05).
 *
 * Validates the ann.js HNSW engine against an exact O(n²) all-pairs baseline
 * on the REAL vector corpus. CI-ONLY in practice: the real ~51k
 * data/skill-vectors.ndjson lives only in the warm GHA `skill-vectors-*`
 * cache; local copies are the stale 1,078-vector Phase-1 seed AND the dev
 * box (win32-arm64) cannot compile hnswlib-node. Dispatch via
 * `gh workflow run daily-scrape.yml -f validate_ann=true` (~60-100 min).
 *
 * Four locked gates (RESEARCH.md §Validation Architecture, Real-recall row):
 *   1. pair_recall      >= 0.995  — fraction of true sim>0.92 pairs the ANN
 *                                   candidate retrieval finds (misses-only)
 *   2. dup_flap         <  0.005  — fraction of items whose "in a duplicate
 *                                   cluster (size >= 2)" boolean differs
 *                                   between the ANN and exact edge sets
 *   3. topk_overlap     >= 0.95   — mean per-item overlap of the ANN top-K
 *                                   neighbor set vs the exact top-K
 *                                   (compute-similar.js semantics, K=3)
 *   4. novelty_jaccard  >= 0.95   — Jaccard of the top-5%-by-novelty item
 *                                   sets under both paths (novelty = 1 -
 *                                   top-1 sim, enrich.js semantics)
 *
 * Misses-only invariant (ann.js exact-verification contract): every ANN
 * candidate sim is recomputed via dot() on the same Float32 vectors the
 * exact baseline uses, so annPairs MUST be a subset of exactPairs. Any
 * extra pair indicates an exact-verification bug → FAIL regardless of
 * recall.
 *
 * Usage:
 *   node scripts/validate-ann-recall.js [--input data/skill-vectors.ndjson]
 *     [--threshold 0.92] [--k-dup 64] [--ef-search 150] [--top-k 3]
 *
 * Output: one machine-greppable line per metric, then
 *   [validate-ann] RESULT=PASS   (exit 0)  — all four gates pass
 *   [validate-ann] RESULT=FAIL   (exit 1)  — any gate or invariant fails
 *
 * All logging prefixed `[validate-ann]`.
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readNdjsonRecords } from './lib/ndjson.js';
import { annEngine, normalizeFloat32, dot, topKNeighbors } from './lib/ann.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_INPUT = join(ROOT, 'data', 'skill-vectors.ndjson');

// Locked gate thresholds (RESEARCH.md §Validation Architecture).
const GATE_PAIR_RECALL = 0.995;
const GATE_DUP_FLAP = 0.005;
const GATE_TOPK_OVERLAP = 0.95;
const GATE_NOVELTY_JACCARD = 0.95;

function log(msg) { console.log(`[validate-ann] ${msg}`); }
function warn(msg) { console.warn(`[validate-ann] WARN: ${msg}`); }

function parseArgs(argv) {
  const out = { input: null, threshold: 0.92, kDup: 64, efSearch: 150, topK: 3 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') out.input = argv[++i];
    else if (a.startsWith('--input=')) out.input = a.slice('--input='.length);
    else if (a === '--threshold') out.threshold = Number(argv[++i]);
    else if (a.startsWith('--threshold=')) out.threshold = Number(a.slice('--threshold='.length));
    else if (a === '--k-dup') out.kDup = Number(argv[++i]);
    else if (a.startsWith('--k-dup=')) out.kDup = Number(a.slice('--k-dup='.length));
    else if (a === '--ef-search') out.efSearch = Number(argv[++i]);
    else if (a.startsWith('--ef-search=')) out.efSearch = Number(a.slice('--ef-search='.length));
    else if (a === '--top-k') out.topK = Number(argv[++i]);
    else if (a.startsWith('--top-k=')) out.topK = Number(a.slice('--top-k='.length));
  }
  return out;
}

function resolvePath(p) {
  if (!p) return null;
  return (p.startsWith('/') || /^[A-Za-z]:/.test(p)) ? p : join(ROOT, p);
}

/** Sort comparator mirroring ann.js: sim DESC, ties broken idx ASC. */
function compareNeighbors(a, b) {
  if (b.sim !== a.sim) return b.sim - a.sim;
  return a.idx - b.idx;
}

/**
 * Bounded insertion into a sorted (sim DESC, idx ASC) neighbor list of max
 * length kk. Mirrors ann.js's insertNeighbor so exact top-K tie-breaking is
 * identical to what topKNeighbors produces.
 */
function insertNeighbor(list, kk, cand) {
  if (list.length >= kk && compareNeighbors(cand, list[list.length - 1]) >= 0) return;
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (compareNeighbors(cand, list[mid]) < 0) hi = mid;
    else lo = mid + 1;
  }
  list.splice(lo, 0, cand);
  if (list.length > kk) list.pop();
}

/**
 * BFS-cluster an edge set (same stack-based BFS as enrich.js enrichSkills)
 * and return a per-item boolean "is in a cluster of size >= 2".
 *
 * @param {number} n item count
 * @param {Set<number>} pairKeys i<j pairs encoded as i*n+j
 * @returns {Uint8Array} inCluster booleans
 */
function clusterMembership(n, pairKeys) {
  const neighbors = Array.from({ length: n }, () => []);
  for (const key of pairKeys) {
    const i = Math.floor(key / n);
    const j = key % n;
    neighbors[i].push(j);
    neighbors[j].push(i);
  }
  const inCluster = new Uint8Array(n);
  const visited = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    if (neighbors[i].length === 0) continue;
    const cluster = [];
    const stack = [i];
    while (stack.length > 0) {
      const k = stack.pop();
      if (visited[k]) continue;
      visited[k] = 1;
      cluster.push(k);
      for (const nb of neighbors[k]) if (!visited[nb]) stack.push(nb);
    }
    if (cluster.length < 2) continue;
    for (const idx of cluster) inCluster[idx] = 1;
  }
  return inCluster;
}

/**
 * Indices of the top ceil(5%) items ranked by novelty (1 - top-1 sim) DESC,
 * ties broken idx ASC for determinism.
 *
 * @param {Float64Array} top1 per-item max similarity (-1 if none)
 * @returns {Set<number>}
 */
function noveltyTopSet(top1) {
  const n = top1.length;
  const m = Math.max(1, Math.ceil(n * 0.05));
  const order = Array.from({ length: n }, (_, i) => i);
  // novelty = 1 - top1 → rank by top1 ASC (lower sim = more novel).
  order.sort((a, b) => (top1[a] !== top1[b] ? top1[a] - top1[b] : a - b));
  return new Set(order.slice(0, m));
}

function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  let inter = 0;
  for (const v of setA) if (setB.has(v)) inter++;
  return inter / (setA.size + setB.size - inter);
}

function main() {
  const args = parseArgs(process.argv);
  const inputPath = resolvePath(args.input) || DEFAULT_INPUT;
  const { threshold, kDup, efSearch, topK } = args;

  // 1. Hard-require the native engine — validating HNSW recall against the
  //    exact engine ON the exact engine would be vacuous.
  if (annEngine() !== 'hnsw') {
    console.error('[validate-ann] FATAL: hnsw engine unavailable — validation is meaningless on the exact fallback');
    process.exit(1);
  }

  if (!existsSync(inputPath)) {
    console.error(`[validate-ann] FATAL: ${inputPath} not found`);
    process.exit(1);
  }

  // 2. Load + normalize vectors. Chunked NDJSON helper only — single-string
  //    reads of data/ files are banned (F1 streaming foundation, CLAUDE.md).
  const startLoad = Date.now();
  const vecMap = readNdjsonRecords(inputPath, { keyFn: (r) => r.id });
  const items = [];
  for (const rec of vecMap.values()) {
    if (!rec || !rec.id || !rec.values) continue;
    items.push({ id: rec.id, vec: normalizeFloat32(rec.values) });
    rec.values = null; // Pitfall 7: drop float64 source refs immediately
  }
  vecMap.clear();
  // ann.js determinism contract: caller sorts by id before querying.
  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const n = items.length;
  log(`loaded ${n} vectors from ${inputPath} in ${((Date.now() - startLoad) / 1000).toFixed(1)}s`);
  if (n < 10000) {
    warn(`n=${n} < 10000 — vector file looks like a cold-cache / stale seed; results are NOT representative of the production corpus. Proceeding anyway.`);
  }
  if (n < 2) {
    console.error('[validate-ann] FATAL: need at least 2 vectors');
    process.exit(1);
  }

  // 3. EXACT BASELINE — single O(n²) i<j pass collecting all three exact
  //    structures (~35-65 min at 51k on the 4-vCPU runner).
  const kEff = Math.min(topK, n - 1);
  const exactPairs = new Set();        // i*n+j keys for sim > threshold
  const exactTop1 = new Float64Array(n).fill(-1);
  const exactTopK = Array.from({ length: n }, () => []);
  const startExact = Date.now();
  for (let i = 0; i < n; i++) {
    const vi = items[i].vec;
    const ri = exactTopK[i];
    for (let j = i + 1; j < n; j++) {
      const sim = dot(vi, items[j].vec);
      if (sim > threshold) exactPairs.add(i * n + j);
      if (sim > exactTop1[i]) exactTop1[i] = sim;
      if (sim > exactTop1[j]) exactTop1[j] = sim;
      insertNeighbor(ri, kEff, { idx: j, sim });
      insertNeighbor(exactTopK[j], kEff, { idx: i, sim });
    }
    if ((i + 1) % 1000 === 0) {
      log(`  exact baseline: ${i + 1}/${n} rows (${((Date.now() - startExact) / 1000).toFixed(0)}s elapsed)`);
    }
  }
  log(`exact baseline done in ${((Date.now() - startExact) / 1000).toFixed(1)}s — ${exactPairs.size} pairs above ${threshold}`);

  // 4. ANN CANDIDATES — forced hnsw engine; THROWS rather than silently
  //    falling back (ann.js engine-override contract).
  const startAnn = Date.now();
  const neighborSets = topKNeighbors(items, kDup, { efSearch, engine: 'hnsw' });
  const annPairs = new Set();          // symmetrized: either side finding it counts
  const annTop1 = new Float64Array(n).fill(-1);
  const annTopK = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const set = neighborSets[i];
    for (let c = 0; c < set.length; c++) {
      const { idx: j, sim } = set[c];
      // enrich.js parity: nnSim (novelty input) is symmetrized.
      if (sim > annTop1[i]) annTop1[i] = sim;
      if (sim > annTop1[j]) annTop1[j] = sim;
      if (sim > threshold) annPairs.add(i < j ? i * n + j : j * n + i);
      // compute-similar.js parity: top-K is the first topK entries of the
      // item's own neighbor set (no symmetrization).
      if (c < kEff) annTopK[i].push(j);
    }
  }
  log(`ann retrieval done in ${((Date.now() - startAnn) / 1000).toFixed(1)}s — ${annPairs.size} pairs above ${threshold}`);

  // 5. METRICS + GATES.
  log(`n=${n} engine=hnsw k_dup=${kDup} ef_search=${efSearch} threshold=${threshold}`);

  // Misses-only invariant: annPairs ⊆ exactPairs. Sims on both sides come
  // from dot() over identical Float32 vectors, so any extra ANN pair means
  // the exact-verification contract is broken → FAIL regardless of recall.
  let extraPairs = 0;
  let hitPairs = 0;
  for (const key of annPairs) {
    if (exactPairs.has(key)) hitPairs++;
    else extraPairs++;
  }
  const invariantOk = extraPairs === 0;
  if (!invariantOk) {
    console.error(`[validate-ann] INVARIANT VIOLATION: ${extraPairs} ANN pairs not in the exact set — exact-verification bug in ann.js (sims must be identical dot() values)`);
  }

  const pairRecall = exactPairs.size === 0 ? 1 : hitPairs / exactPairs.size;
  if (exactPairs.size === 0) warn(`no exact pairs above ${threshold} — pair_recall vacuously 1`);
  const pairPass = pairRecall >= GATE_PAIR_RECALL && invariantOk;
  log(`pair_recall=${pairRecall.toFixed(4)} gate>=${GATE_PAIR_RECALL} ${pairPass ? 'PASS' : 'FAIL'}`);

  // dup_flap: BFS-cluster both edge sets (same stack-based BFS as enrich.js);
  // flap = fraction of items whose "in a cluster of size >= 2" boolean differs.
  const exactMembership = clusterMembership(n, exactPairs);
  const annMembership = clusterMembership(n, annPairs);
  let flips = 0;
  for (let i = 0; i < n; i++) if (exactMembership[i] !== annMembership[i]) flips++;
  const dupFlap = flips / n;
  const flapPass = dupFlap < GATE_DUP_FLAP;
  log(`dup_flap=${dupFlap.toFixed(4)} gate<${GATE_DUP_FLAP} ${flapPass ? 'PASS' : 'FAIL'}`);

  // topk_overlap: mean per-item |annTopK ∩ exactTopK| / kEff.
  let overlapSum = 0;
  for (let i = 0; i < n; i++) {
    const exactSet = new Set();
    for (const nb of exactTopK[i]) exactSet.add(nb.idx);
    let inter = 0;
    for (const j of annTopK[i]) if (exactSet.has(j)) inter++;
    overlapSum += inter / kEff;
  }
  const topkOverlap = overlapSum / n;
  const topkPass = topkOverlap >= GATE_TOPK_OVERLAP;
  log(`topk_overlap=${topkOverlap.toFixed(4)} gate>=${GATE_TOPK_OVERLAP} ${topkPass ? 'PASS' : 'FAIL'}`);

  // novelty_jaccard: novelty = 1 - top-1 sim; Jaccard of the top-5% item
  // sets by novelty under both paths.
  const noveltyJaccard = jaccard(noveltyTopSet(exactTop1), noveltyTopSet(annTop1));
  const noveltyPass = noveltyJaccard >= GATE_NOVELTY_JACCARD;
  log(`novelty_jaccard=${noveltyJaccard.toFixed(4)} gate>=${GATE_NOVELTY_JACCARD} ${noveltyPass ? 'PASS' : 'FAIL'}`);

  // 6. Verdict.
  if (pairPass && flapPass && topkPass && noveltyPass) {
    log('RESULT=PASS');
    process.exit(0);
  } else {
    log('RESULT=FAIL');
    process.exit(1);
  }
}

// Only run main() when invoked as a script, not when imported.
const invokedAsScript = (() => {
  try {
    return import.meta.url === fileURLToPath(`file://${process.argv[1]}`).replace(/\\/g, '/')
      || fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (invokedAsScript) main();

#!/usr/bin/env node

/**
 * ClaudeAtlas Skill Embedder
 *
 * Converts every curated skill in data/skills.json into a 1536-dimensional
 * vector using OpenAI's text-embedding-3-small, then writes the vectors as
 * NDJSON to data/skill-vectors.ndjson.
 *
 * Each line of the NDJSON file is a Vectorize-ready vector record:
 *
 *   {
 *     "id": "<vectorize_safe_id>",         // derived from skill.id, ≤64 chars
 *     "values": [0.01, -0.03, ...],        // 1536 floats
 *     "metadata": {
 *       "name": "videodb",
 *       "slug": "affaan-m/videodb",
 *       "skill_id": "affaan-m/everything-claude-code/skills/videodb/SKILL.md",
 *       "category": "AI & Automation",
 *       "quality_tier": "featured",
 *       "quality_score": 99,
 *       "repo_stars": 148923
 *     }
 *   }
 *
 * Note: the Vectorize `id` is derived from skill.id (unique per catalog
 * entry) because 6 skills in the current catalog share a slug (two
 * different repos host skills with the same name). Using slug as the
 * vector ID would cause 6 records to silently overwrite each other.
 * Vectorize has a 64-char ID limit, so long skill.id values are hashed
 * into a stable short form.
 *
 * Resumable: on startup, reads the existing NDJSON if present and builds a
 * map of {slug -> content_sha}. Only re-embeds skills whose content has
 * changed (different sha) or are new (missing slug). Unchanged skills are
 * copied forward from the existing file.
 *
 * Cost: 1,078 skills × ~400 input tokens each ≈ 430k tokens × $0.02/M
 * ≈ $0.009 for a full cold embed. Delta runs cost proportionally less.
 *
 * Rate limiting: OpenAI's default tier-1 limit for embeddings is 3,000
 * requests/minute and 1,000,000 tokens/minute. We batch 100 skills per
 * request (OpenAI supports batched inputs in a single call) and cap at
 * ~30 requests/minute to stay well under any tier limit.
 */

import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readNdjsonRecords, writeNdjsonStreaming } from './lib/ndjson.js';
import { loadSkillsArray } from './lib/skills-stream.js';
import { buildEmbeddingInput as buildEmbeddingInputRegistry } from './lib/embedding-input/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
// T5: NDJSON format. SKILLS_PATH retained for error messages; reads use loadSkillsArray().
const SKILLS_PATH = join(ROOT, 'data', 'skills.ndjson');

// Phase 3.2 (D-09): embed-skills.js is the unified embedder for all three
// entity_types. CLI: --input <path> --output <path> --entity-type <type>.
// Defaults preserve the legacy skill invocation so daily-scrape.yml's
// `node scripts/embed-skills.js` keeps working unchanged.
function parseArgs(argv) {
  const out = { input: null, output: null, entityType: 'skill' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') out.input = argv[++i];
    else if (a === '--output') out.output = argv[++i];
    else if (a === '--entity-type') out.entityType = argv[++i];
    else if (a.startsWith('--input=')) out.input = a.slice('--input='.length);
    else if (a.startsWith('--output=')) out.output = a.slice('--output='.length);
    else if (a.startsWith('--entity-type=')) out.entityType = a.slice('--entity-type='.length);
  }
  return out;
}

const DEFAULT_OUTPUTS = {
  skill: join(ROOT, 'data', 'skill-vectors.ndjson'),
  plugin: join(ROOT, 'data', 'plugin-vectors.ndjson'),
  mcp_server: join(ROOT, 'data', 'mcp-vectors.ndjson'),
};
const DEFAULT_INPUTS = {
  skill: join(ROOT, 'data', 'skills.ndjson'),
  plugin: join(ROOT, 'data', 'plugins.ndjson'),
  mcp_server: join(ROOT, 'data', 'mcp-servers.ndjson'),
};

const OPENAI_KEY = process.env.OPENAI_API_KEY;
// Note: we don't hard-fail on missing key here. If there are no deltas to
// embed (all skills already vectorized and hashes match), we skip the
// OpenAI call entirely. Only hard-fail if we have work to do and no key.

// EMBED_DRY_RUN=1 short-circuits the OpenAI call and generates deterministic
// SHA-256-seeded fake vectors instead. Used by:
//   - T2's smoke fixture run (50k records, would otherwise burn ~$0.42 and hit
//     OpenAI tier-1 rate limit at >17 min)
//   - CI verification runs during F1/F2/F3 plan-check rev cycles
//   - The 50k regression-set CI run (V3 in plan §verify)
// Live OpenAI smoke verifies the real path separately on a small (100-record)
// dataset via push-event workflow.
const DRY_RUN = process.env.EMBED_DRY_RUN === '1';

function fakeVectorFor(id) {
  if (!id) throw new Error('fakeVectorFor: missing id');
  const h = createHash('sha256').update(id).digest();
  const vec = new Array(DIMENSIONS);
  for (let i = 0; i < DIMENSIONS; i++) {
    const b = h[i % h.length];
    vec[i] = ((b / 255) * 2) - 1; // map [0,255] → [-1,1]
  }
  return vec;
}

const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536;
const BATCH_SIZE = 100;
const DELAY_BETWEEN_BATCHES_MS = 2000; // ~30 batches/minute, very safe
const MAX_RETRIES = 4;

function log(msg) {
  console.log(`[embed] ${msg}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// F2: helper that reads body_markdown from either v2 extra or legacy top-level.
// Used by BOTH computeContentSha and buildEmbeddingInput so the embedding
// cache key stays byte-identical across the v1→v2 migration (per R6 — do
// NOT trigger a 35k-record Vectorize re-upload).
function readBodyMarkdown(skill) {
  if (skill && skill.extra && typeof skill.extra.body_markdown === 'string') {
    return skill.extra.body_markdown;
  }
  return skill?.body_markdown || '';
}

// Content SHA is a stable fingerprint of the fields we embed.
//
// IMPORTANT (Phase 3.2 / B-2): for SKILLS the sha formula is FROZEN to the
// legacy pipe-join over name|description|category|body_markdown. Switching it
// to hash buildEmbeddingInput() output would change every prior _content_sha
// on disk and force a 35k-record re-embed (cache hit → 0%, ~$0.22). The skill
// embedding-input text is held byte-identical by the registry's
// buildSkillEmbeddingInput (parity-guarded in Task 4), so the embedded vectors
// do not drift — only the delta-detection key must stay stable.
//
// For NEW types (plugin/mcp_server) there is no prior vector file, so the sha
// is derived from the registry embedding-input text directly.
function computeContentSha(record, entityType) {
  if (entityType === 'skill') {
    const payload = [
      record.name || '',
      record.description || '',
      record.category || '',
      readBodyMarkdown(record),
    ].join('|');
    return createHash('sha256').update(payload).digest('hex');
  }
  return createHash('sha256').update(buildEmbeddingInputRegistry(record)).digest('hex');
}

// Vectorize accepts IDs up to 64 characters. Our skill.id values (full
// path including the SKILL.md filename) can exceed this. We keep them
// stable by using a SHA-256 prefix whenever the raw id is too long.
//
// Phase 3.1 Rev 2 BLOCKER 1: exported so scripts/enrich.js consumes the
// SAME implementation (including the >64-char SHA branch). A local
// re-implementation in enrich.js silently failed to join most production
// IDs (which exceed 64 chars) — fixed by sharing the canonical helper.
export function vectorizeId(skillId) {
  if (!skillId) throw new Error('skill missing id');
  if (skillId.length <= 64) {
    // Vectorize also requires ids to match a restricted charset — replace
    // path separators and other unsafe characters with underscores.
    return skillId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  }
  const hash = createHash('sha256').update(skillId).digest('hex');
  // Prefix with 'sk_' so it's obviously a hashed skill id, then 40 hex chars
  return 'sk_' + hash.slice(0, 40);
}

// Build the text we actually send to OpenAI via the Phase 3.2 registry
// (scripts/lib/embedding-input). Dispatches by entity_type. The skill builder
// is byte-identical to the legacy inline logic (B-2 parity guard, Task 4) so
// existing skill vectors do not drift.
function buildEmbeddingInput(record) {
  return buildEmbeddingInputRegistry(record);
}

// Drift decision (FIX A, quick-260804-dy2). The OLD guard bailed on overall
// cache hit rate (kept.length / records.length), which false-positives
// whenever the catalog GROWS or the vector cache is cold-seeded (e.g. a
// 1,078-vector seed vs ~50k current records → ~2% hit → spurious abort).
// The CORRECT drift signal is prior-overlap: of the vectors we already have,
// how many still match a current record by content_sha? A LOW prior-match-rate
// means buildEmbeddingInput()/content_sha drifted so the prior vectors are
// stale — that is the only case worth a costly full re-embed abort. Growth
// (lots of NEW records with nothing prior to match) is NOT drift.
//
// Thresholds (documented choices):
//   MIN_PRIOR_FOR_DRIFT_CHECK = 50 — below this the prior set is an
//     evicted/bootstrap remnant; the rate is statistically meaningless, so
//     PROCEED (embed everything — correct, not a surprise).
//   PRIOR_MATCH_BAIL_THRESHOLD = 0.5 — bail only when MOST prior vectors no
//     longer match (true logic drift). 0.5 (not 0.90) because legitimate
//     churn/removals routinely retire a chunk of prior vectors; only a
//     majority-miss indicates a formula change.
export const MIN_PRIOR_FOR_DRIFT_CHECK = 50;
export const PRIOR_MATCH_BAIL_THRESHOLD = 0.5;
export function shouldBailOnDrift({ priorCount, matchedFromPrior, forced }) {
  if (forced) return false;
  if (!priorCount || priorCount < MIN_PRIOR_FOR_DRIFT_CHECK) return false;
  const priorMatchRate = matchedFromPrior / priorCount;
  return priorMatchRate < PRIOR_MATCH_BAIL_THRESHOLD;
}

// --- Prior-run resume ---

// Load prior vectors keyed by metadata.skill_id (the source-of-truth unique
// identifier). The record's vector `id` is a derived vectorize-safe form.
function loadPriorVectors(outputPath) {
  // Uses the shared streaming reader from scripts/lib/ndjson.js (chunked
  // readSync — avoids V8 ~536 MB string limit). Header records (_header:
  // true) are filtered defensively.
  try {
    return readNdjsonRecords(outputPath, {
      keyFn: (r) => r.metadata?.skill_id || r.id,
    });
  } catch {
    return new Map();
  }
}

// Load the records to embed for the requested entity_type. Skills keep the
// legacy loadSkillsArray() path (NDJSON + legacy fallback, V8-safe); plugin
// and mcp_server records stream from their NDJSON via readNdjsonRecords.
function loadRecords(entityType, inputPath) {
  if (entityType === 'skill' && inputPath === DEFAULT_INPUTS.skill) {
    return loadSkillsArray();
  }
  return [...readNdjsonRecords(inputPath, { keyFn: (r) => r.id }).values()];
}

// --- OpenAI embedding call ---

async function embedBatch(inputs, attempt = 1) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      input: inputs,
      dimensions: DIMENSIONS,
    }),
  });

  if (res.status === 429 || res.status >= 500) {
    if (attempt >= MAX_RETRIES) {
      const body = await res.text();
      throw new Error(`OpenAI ${res.status} after ${MAX_RETRIES} attempts: ${body}`);
    }
    const waitMs = 2000 * Math.pow(2, attempt); // 4s, 8s, 16s, 32s
    log(`  [retry] OpenAI ${res.status} (attempt ${attempt}/${MAX_RETRIES}), waiting ${waitMs}ms`);
    await sleep(waitMs);
    return embedBatch(inputs, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI HTTP ${res.status}: ${body}`);
  }

  const json = await res.json();
  if (!json.data || !Array.isArray(json.data)) {
    throw new Error(`OpenAI response missing data array: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json.data.map(d => d.embedding);
}

// --- Main ---

async function main() {
  const args = parseArgs(process.argv);
  const entityType = args.entityType || 'skill';
  if (!DEFAULT_INPUTS[entityType]) {
    console.error(`ERROR: unknown --entity-type "${entityType}" (skill|plugin|mcp_server).`);
    process.exit(1);
  }
  const inputPath = args.input || DEFAULT_INPUTS[entityType];
  const outputPath = args.output || DEFAULT_OUTPUTS[entityType];

  log(`=== embedder start (entity_type=${entityType}) ===`);
  log(`input:  ${inputPath}`);
  log(`output: ${outputPath}`);

  let records;
  try {
    records = loadRecords(entityType, inputPath);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
  log(`loaded ${records.length} ${entityType} records`);

  const prior = loadPriorVectors(outputPath);
  log(`prior vectors: ${prior.size}`);

  // Partition records into 'kept' (unchanged, reuse prior vector) and 'todo'.
  const kept = [];
  const todo = [];

  for (const rec of records) {
    if (!rec.id) continue;
    const sha = computeContentSha(rec, entityType);
    const priorRec = prior.get(rec.id);

    if (priorRec && priorRec.metadata && priorRec.metadata._content_sha === sha && Array.isArray(priorRec.values) && priorRec.values.length === DIMENSIONS) {
      kept.push(priorRec);
    } else {
      todo.push({ skill: rec, sha });
    }
  }

  log(`unchanged: ${kept.length}`);
  log(`to embed:  ${todo.length}`);

  // Drift pre-check (FIX A, quick-260804-dy2): when re-embedding against an
  // EXISTING vector file, decide on PRIOR-OVERLAP, not overall cache hit rate.
  // A low prior-match-rate means the embedding-input (and therefore the
  // content_sha) drifted from what produced the prior vectors — re-embedding
  // the whole catalog would silently cost real money. Bail loudly unless
  // explicitly forced. Catalog GROWTH and cold-seed caches no longer
  // false-positive (only true drift does — see shouldBailOnDrift).
  const FORCE_REEMBED = process.env.EMBED_FORCE_REEMBED === '1';
  if (prior.size > 0 && records.length > 0) {
    // kept.length === matchedFromPrior: `prior` is keyed by unique skill_id and
    // each current rec.id is unique, so at most one prior vector is consumed per
    // kept record → the count of reused priors equals kept.length.
    const matchedFromPrior = kept.length;
    const priorMatchRate = matchedFromPrior / prior.size;
    log(`prior-overlap: ${(priorMatchRate * 100).toFixed(2)}% of prior vectors still match (${matchedFromPrior}/${prior.size} prior; ${kept.length}/${records.length} current kept)`);
    if (shouldBailOnDrift({ priorCount: prior.size, matchedFromPrior, forced: FORCE_REEMBED })) {
      console.error(
        `[embed-skills] DRIFT DETECTED: only ${(priorMatchRate * 100).toFixed(2)}% of the ` +
        `${prior.size} PRIOR vectors in ${outputPath} still match a current record by content_sha.\n` +
        `A majority-miss means buildEmbeddingInput()/content_sha diverged from the logic that\n` +
        `produced those vectors — proceeding would silently re-embed the whole catalog.\n` +
        `(NOTE: catalog GROWTH and cold-seed caches do NOT trip this guard anymore — only true drift does.)\n` +
        `Cost of proceeding: a full re-embed of ${records.length} records.\n` +
        `Bailing out. Re-run with EMBED_FORCE_REEMBED=1 to override.`,
      );
      process.exit(1);
    }
  }

  if (todo.length === 0) {
    log('no changes — writing output unchanged and exiting');
    writeNdjsonStreaming(outputPath, kept);
    log(`wrote ${outputPath} (${kept.length} vectors)`);
    log('=== embedder complete ===');
    return;
  }

  // We have work to do — OpenAI key is required UNLESS in DRY_RUN mode
  if (!OPENAI_KEY && !DRY_RUN) {
    console.error('ERROR: OPENAI_API_KEY required to embed new/changed skills.');
    console.error(`Found ${todo.length} skills needing embedding.`);
    console.error('Set OPENAI_API_KEY in .env (local) or as a GitHub Actions repo secret (CI).');
    console.error('To run without OpenAI (CI fixtures, plan-check rev cycles), set EMBED_DRY_RUN=1.');
    process.exit(1);
  }

  if (DRY_RUN) {
    log(`EMBED_DRY_RUN=1 — generating deterministic seeded fake vectors for ${todo.length} records (zero OpenAI calls)`);
  } else {
    // Cost estimate
    const estTokens = todo.length * 400;
    const estCost = (estTokens / 1_000_000) * 0.02;
    log(`estimated cost: ~$${estCost.toFixed(4)} (${estTokens.toLocaleString()} tokens)`);
  }

  // Process in batches
  const newRecords = [];
  let done = 0;
  const startTime = Date.now();

  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    const inputs = batch.map(({ skill }) => buildEmbeddingInput(skill));

    let vectors;
    if (DRY_RUN) {
      vectors = batch.map(({ skill }) => fakeVectorFor(skill.id));
    } else {
      try {
        vectors = await embedBatch(inputs);
      } catch (err) {
        log(`  [FATAL] batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${err.message}`);
        // Save progress before exiting so we can resume
        const partial = [...kept, ...newRecords];
        writeNdjsonStreaming(outputPath, partial);
        log(`saved partial: ${partial.length} vectors written`);
        process.exit(1);
      }
    }

    if (vectors.length !== batch.length) {
      throw new Error(`Expected ${batch.length} vectors, got ${vectors.length}`);
    }

    for (let j = 0; j < batch.length; j++) {
      const { skill, sha } = batch[j];
      newRecords.push({
        id: vectorizeId(skill.id),
        values: vectors[j],
        metadata: {
          name: skill.name,
          slug: skill.slug,
          skill_id: skill.id, // source-of-truth for re-embed delta detection
          category: skill.category || '',
          quality_tier: skill.quality_tier || 'listed',
          quality_score: skill.quality_score || 0,
          repo_stars: skill.repo_stars || 0,
          repo_full_name: skill.repo_full_name || '',
          description: (skill.description || '').slice(0, 500),
          // F2 (B4 / DOD-7): carry entity_type into Vectorize metadata so
          // the worker's ?type filter has a queryable field the day plugins
          // (Phase 3.2) land. Default to 'skill' for legacy v1 records on
          // disk during the cutover window. Phase 3.2: falls back to the
          // run's --entity-type so plugin/mcp vectors are tagged correctly.
          entity_type: skill.entity_type || entityType || 'skill',
          _content_sha: sha,
        },
      });
    }

    done += batch.length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`  [${done}/${todo.length}] batch ${Math.floor(i / BATCH_SIZE) + 1} done (${elapsed}s elapsed)`);

    // Checkpoint every batch (streaming write — V8-safe)
    writeNdjsonStreaming(outputPath, [...kept, ...newRecords]);

    // Polite pause between batches (skipped in DRY_RUN — no rate limit)
    if (i + BATCH_SIZE < todo.length && !DRY_RUN) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`embedded ${newRecords.length} new/changed records in ${totalElapsed}s`);
  log(`final output: ${kept.length + newRecords.length} total vectors`);
  log(`wrote ${outputPath}`);
  log('=== embedder complete ===');
}

// Phase 3.1 Task 4: gate main() so importing vectorizeId from this module
// (e.g. from scripts/enrich.js or its tests) doesn't trigger the embedder.
const invokedAsScript = (() => {
  try {
    return import.meta.url === fileURLToPath(`file://${process.argv[1]}`).replace(/\\/g, '/')
      || fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (invokedAsScript) {
  main().catch(err => {
    console.error(`FATAL: ${err.stack || err.message}`);
    process.exit(1);
  });
}

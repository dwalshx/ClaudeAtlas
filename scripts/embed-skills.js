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
 *     "id": "affaan-m/videodb",            // slug, stable across runs
 *     "values": [0.01, -0.03, ...],        // 1536 floats
 *     "metadata": {
 *       "name": "videodb",
 *       "slug": "affaan-m/videodb",
 *       "category": "AI & Automation",
 *       "quality_tier": "featured",
 *       "quality_score": 99,
 *       "repo_stars": 148923
 *     }
 *   }
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

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SKILLS_PATH = join(ROOT, 'data', 'skills.json');
const OUTPUT_PATH = join(ROOT, 'data', 'skill-vectors.ndjson');

const OPENAI_KEY = process.env.OPENAI_API_KEY;
// Note: we don't hard-fail on missing key here. If there are no deltas to
// embed (all skills already vectorized and hashes match), we skip the
// OpenAI call entirely. Only hard-fail if we have work to do and no key.

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

// Content SHA is a stable fingerprint of the fields we embed.
// Any change to name/description/category/body_markdown invalidates the vector.
function computeContentSha(skill) {
  const payload = [
    skill.name || '',
    skill.description || '',
    skill.category || '',
    skill.body_markdown || '',
  ].join('|');
  return createHash('sha256').update(payload).digest('hex');
}

// Build the text we actually send to OpenAI. This is what gets embedded,
// so the richer the better — but we cap at ~2000 chars to stay within
// single-batch token budgets and avoid tail-content dominating.
function buildEmbeddingInput(skill) {
  const parts = [
    skill.name,
    skill.description || '',
    skill.category || '',
    (skill.body_markdown || '').slice(0, 1500),
  ].filter(Boolean);
  return parts.join('\n\n').slice(0, 6000);
}

// --- Prior-run resume ---

function loadPriorVectors() {
  if (!existsSync(OUTPUT_PATH)) return new Map();
  try {
    const lines = readFileSync(OUTPUT_PATH, 'utf-8').split('\n').filter(Boolean);
    const map = new Map();
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        if (rec.id) map.set(rec.id, rec);
      } catch {
        // skip malformed lines
      }
    }
    return map;
  } catch {
    return new Map();
  }
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
  log('=== skill embedder start ===');

  if (!existsSync(SKILLS_PATH)) {
    console.error(`ERROR: ${SKILLS_PATH} not found.`);
    process.exit(1);
  }

  const skills = JSON.parse(readFileSync(SKILLS_PATH, 'utf-8'));
  log(`loaded ${skills.length} skills`);

  const prior = loadPriorVectors();
  log(`prior vectors: ${prior.size}`);

  // Partition skills into 'kept' (unchanged, reuse prior vector) and 'todo' (needs embedding)
  const kept = [];
  const todo = [];

  for (const skill of skills) {
    if (!skill.slug) continue;
    const sha = computeContentSha(skill);
    const priorRec = prior.get(skill.slug);

    if (priorRec && priorRec.metadata && priorRec.metadata._content_sha === sha && Array.isArray(priorRec.values) && priorRec.values.length === DIMENSIONS) {
      kept.push(priorRec);
    } else {
      todo.push({ skill, sha });
    }
  }

  log(`unchanged: ${kept.length}`);
  log(`to embed:  ${todo.length}`);

  if (todo.length === 0) {
    log('no changes — writing output unchanged and exiting');
    const ndjson = kept.map(r => JSON.stringify(r)).join('\n') + '\n';
    writeFileSync(OUTPUT_PATH, ndjson, 'utf-8');
    log(`wrote ${OUTPUT_PATH} (${kept.length} vectors)`);
    log('=== skill embedder complete ===');
    return;
  }

  // We have work to do — now the OpenAI key is required
  if (!OPENAI_KEY) {
    console.error('ERROR: OPENAI_API_KEY required to embed new/changed skills.');
    console.error(`Found ${todo.length} skills needing embedding.`);
    console.error('Set OPENAI_API_KEY in .env (local) or as a GitHub Actions repo secret (CI).');
    process.exit(1);
  }

  // Cost estimate
  const estTokens = todo.length * 400;
  const estCost = (estTokens / 1_000_000) * 0.02;
  log(`estimated cost: ~$${estCost.toFixed(4)} (${estTokens.toLocaleString()} tokens)`);

  // Process in batches
  const newRecords = [];
  let done = 0;
  const startTime = Date.now();

  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    const inputs = batch.map(({ skill }) => buildEmbeddingInput(skill));

    let vectors;
    try {
      vectors = await embedBatch(inputs);
    } catch (err) {
      log(`  [FATAL] batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${err.message}`);
      // Save progress before exiting so we can resume
      const partial = [...kept, ...newRecords];
      const ndjson = partial.map(r => JSON.stringify(r)).join('\n') + '\n';
      writeFileSync(OUTPUT_PATH, ndjson, 'utf-8');
      log(`saved partial: ${partial.length} vectors written`);
      process.exit(1);
    }

    if (vectors.length !== batch.length) {
      throw new Error(`Expected ${batch.length} vectors, got ${vectors.length}`);
    }

    for (let j = 0; j < batch.length; j++) {
      const { skill, sha } = batch[j];
      newRecords.push({
        id: skill.slug,
        values: vectors[j],
        metadata: {
          name: skill.name,
          slug: skill.slug,
          category: skill.category || '',
          quality_tier: skill.quality_tier || 'listed',
          quality_score: skill.quality_score || 0,
          repo_stars: skill.repo_stars || 0,
          repo_full_name: skill.repo_full_name || '',
          description: (skill.description || '').slice(0, 500),
          _content_sha: sha,
        },
      });
    }

    done += batch.length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`  [${done}/${todo.length}] batch ${Math.floor(i / BATCH_SIZE) + 1} done (${elapsed}s elapsed)`);

    // Checkpoint every batch
    const all = [...kept, ...newRecords];
    const ndjson = all.map(r => JSON.stringify(r)).join('\n') + '\n';
    writeFileSync(OUTPUT_PATH, ndjson, 'utf-8');

    // Polite pause between batches
    if (i + BATCH_SIZE < todo.length) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`embedded ${newRecords.length} new/changed skills in ${totalElapsed}s`);
  log(`final output: ${kept.length + newRecords.length} total vectors`);
  log(`wrote ${OUTPUT_PATH}`);
  log('=== skill embedder complete ===');
}

main().catch(err => {
  console.error(`FATAL: ${err.stack || err.message}`);
  process.exit(1);
});

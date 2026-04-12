#!/usr/bin/env node

/**
 * ClaudeAtlas Skill Clustering
 *
 * Runs k-means clustering on the skill embedding vectors to surface natural
 * groupings that may differ from the manually-assigned 8-category taxonomy.
 * Writes results to data/skill-clusters.json.
 *
 * Uses a simple k-means implementation (no external dependencies). With
 * n=1072 vectors of 1536 dimensions and k=16, this runs in ~5-10 seconds.
 *
 * Output shape:
 *   {
 *     "generated_at": "ISO 8601",
 *     "k": 16,
 *     "iterations": 25,
 *     "clusters": [
 *       {
 *         "id": 0,
 *         "size": 87,
 *         "label": "auto-generated from top keywords",
 *         "top_skills": [
 *           { "slug": "...", "name": "...", "category": "...", "distance": 0.12 }
 *         ],
 *         "category_distribution": { "AI & Automation": 40, "Data & Documents": 30, ... }
 *       }
 *     ]
 *   }
 *
 * The clusters reveal:
 *   - Skills that are miscategorized (dominant category doesn't match assigned)
 *   - Emergent sub-categories within broad categories
 *   - Cross-category skill clusters (e.g., "deployment" skills spanning DevOps + Code)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const VECTORS_PATH = join(ROOT, 'data', 'skill-vectors.ndjson');
const SKILLS_PATH = join(ROOT, 'data', 'skills.json');
const OUTPUT_PATH = join(ROOT, 'data', 'skill-clusters.json');

const K = 16; // Number of clusters
const MAX_ITERATIONS = 50;
const CONVERGENCE_THRESHOLD = 0.0001;

function log(msg) {
  console.log(`[clusters] ${msg}`);
}

// --- Vector math ---

function cosineDistance(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 1 : 1 - (dot / denom);
}

function vectorAdd(target, source) {
  for (let i = 0; i < target.length; i++) target[i] += source[i];
}

function vectorScale(v, s) {
  for (let i = 0; i < v.length; i++) v[i] *= s;
}

// --- K-Means ---

function kmeansInit(vectors, k) {
  // k-means++ initialization for better convergence
  const dims = vectors[0].length;
  const centroids = [];

  // Pick first centroid randomly
  const firstIdx = Math.floor(Math.random() * vectors.length);
  centroids.push([...vectors[firstIdx]]);

  for (let c = 1; c < k; c++) {
    // Compute distance from each point to nearest existing centroid
    const distances = vectors.map(v => {
      let minDist = Infinity;
      for (const cen of centroids) {
        const d = cosineDistance(v, cen);
        if (d < minDist) minDist = d;
      }
      return minDist;
    });

    // Pick next centroid with probability proportional to distance²
    const totalDist = distances.reduce((a, b) => a + b * b, 0);
    let r = Math.random() * totalDist;
    let idx = 0;
    for (let i = 0; i < distances.length; i++) {
      r -= distances[i] * distances[i];
      if (r <= 0) { idx = i; break; }
    }
    centroids.push([...vectors[idx]]);
  }

  return centroids;
}

function kmeans(vectors, k, maxIter = MAX_ITERATIONS) {
  const n = vectors.length;
  const dims = vectors[0].length;

  let centroids = kmeansInit(vectors, k);
  let assignments = new Array(n).fill(0);
  let prevCost = Infinity;

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign each point to nearest centroid
    let totalCost = 0;
    for (let i = 0; i < n; i++) {
      let bestDist = Infinity;
      let bestCluster = 0;
      for (let c = 0; c < k; c++) {
        const d = cosineDistance(vectors[i], centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          bestCluster = c;
        }
      }
      assignments[i] = bestCluster;
      totalCost += bestDist;
    }

    // Check convergence
    const improvement = (prevCost - totalCost) / Math.max(1, prevCost);
    if (iter > 0 && improvement < CONVERGENCE_THRESHOLD) {
      log(`  converged at iteration ${iter + 1} (improvement ${(improvement * 100).toFixed(4)}%)`);
      return { centroids, assignments, iterations: iter + 1, cost: totalCost };
    }
    prevCost = totalCost;

    // Recompute centroids
    const newCentroids = Array.from({ length: k }, () => new Float64Array(dims));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      vectorAdd(newCentroids[c], vectors[i]);
      counts[c]++;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        vectorScale(newCentroids[c], 1 / counts[c]);
      }
    }
    centroids = newCentroids.map(c => [...c]);

    if ((iter + 1) % 10 === 0) {
      log(`  iteration ${iter + 1}/${maxIter} — cost: ${totalCost.toFixed(4)}`);
    }
  }

  return { centroids, assignments, iterations: maxIter, cost: prevCost };
}

// --- Auto-labeling ---

function generateClusterLabel(clusterSkills) {
  // Count word frequencies in skill names and descriptions
  const wordCounts = new Map();
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'to', 'in', 'of', 'with', 'on', 'at', 'by', 'from', 'is', 'it', 'as', 'this', 'that', 'your', 'use', 'using', 'will', 'can', 'all', 'are', 'be', 'has', 'have', 'not', 'but', 'about', 'into', 'when', 'than', 'any', 'each', 'its', 'you']);

  for (const skill of clusterSkills) {
    const text = `${skill.name || ''} ${skill.description || ''}`.toLowerCase();
    const words = text.split(/[^a-z0-9]+/).filter(w => w.length > 2 && !stopWords.has(w));
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }
  }

  const topWords = [...wordCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word);

  return topWords.join(' + ') || 'miscellaneous';
}

// --- Main ---

function main() {
  log('=== skill clustering start ===');

  if (!existsSync(VECTORS_PATH)) {
    log('no skill-vectors.ndjson found — writing empty clusters');
    writeFileSync(OUTPUT_PATH, JSON.stringify({ generated_at: new Date().toISOString(), k: 0, clusters: [] }), 'utf-8');
    return;
  }

  // Load vectors + metadata
  const lines = readFileSync(VECTORS_PATH, 'utf-8').split('\n').filter(Boolean);
  const records = lines.map(l => JSON.parse(l));

  // Load full skills for name/description
  const allSkills = existsSync(SKILLS_PATH) ? JSON.parse(readFileSync(SKILLS_PATH, 'utf-8')) : [];
  const skillsBySlug = new Map();
  for (const s of allSkills) {
    if (s.slug) skillsBySlug.set(s.slug, s);
  }

  // Dedupe by slug (same collision handling as compute-similar.js)
  const slugSet = new Set();
  const deduped = [];
  for (const rec of records) {
    const slug = rec.metadata?.slug;
    if (!slug || slugSet.has(slug)) continue;
    slugSet.add(slug);
    deduped.push(rec);
  }

  log(`loaded ${deduped.length} unique vectors`);
  log(`running k-means with k=${K}, max ${MAX_ITERATIONS} iterations`);

  const vectors = deduped.map(r => r.values);
  const startTime = Date.now();
  const { centroids, assignments, iterations, cost } = kmeans(vectors, K);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  log(`completed in ${elapsed}s (${iterations} iterations, final cost: ${cost.toFixed(4)})`);

  // Build cluster summaries
  const clusters = [];
  for (let c = 0; c < K; c++) {
    const members = [];
    for (let i = 0; i < assignments.length; i++) {
      if (assignments[i] === c) {
        const rec = deduped[i];
        const slug = rec.metadata?.slug;
        const dist = cosineDistance(vectors[i], centroids[c]);
        const fullSkill = skillsBySlug.get(slug) || {};
        members.push({
          slug,
          name: rec.metadata?.name || '',
          category: rec.metadata?.category || '',
          quality_tier: rec.metadata?.quality_tier || 'listed',
          description: fullSkill.description || rec.metadata?.description || '',
          distance: Math.round(dist * 10000) / 10000,
        });
      }
    }

    // Sort by distance to centroid (closest = most representative)
    members.sort((a, b) => a.distance - b.distance);

    // Category distribution within this cluster
    const catDist = {};
    for (const m of members) {
      catDist[m.category] = (catDist[m.category] || 0) + 1;
    }

    // Auto-label from top keywords
    const label = generateClusterLabel(members);

    // Dominant category
    const dominantCat = Object.entries(catDist).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
    const dominantPct = Object.entries(catDist).sort((a, b) => b[1] - a[1])[0]?.[1] || 0;

    clusters.push({
      id: c,
      size: members.length,
      label,
      dominant_category: dominantCat,
      dominant_pct: Math.round((dominantPct / members.length) * 100),
      category_distribution: catDist,
      top_skills: members.slice(0, 10),
    });
  }

  // Sort clusters by size descending
  clusters.sort((a, b) => b.size - a.size);

  const output = {
    generated_at: new Date().toISOString(),
    k: K,
    iterations,
    cost: Math.round(cost * 10000) / 10000,
    total_skills: deduped.length,
    clusters,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
  log(`wrote ${OUTPUT_PATH}`);

  // Summary
  log('');
  log('cluster summary:');
  for (const cl of clusters) {
    log(`  #${cl.id.toString().padStart(2)} | ${cl.size.toString().padStart(4)} skills | "${cl.label}" | ${cl.dominant_category} (${cl.dominant_pct}%)`);
  }

  log('=== skill clustering complete ===');
}

main();

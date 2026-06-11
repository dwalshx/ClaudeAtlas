#!/usr/bin/env node

/**
 * Post-process the raw skills.json to produce a curated index.
 *
 * Filters:
 * 1. Mega-repo cap: max N skills per repo (prevents marketplace dump dominance)
 * 2. Minimum stars: must have at least N stars
 * 3. Minimum body length: SKILL.md must be substantive
 * 4. AI-slop detection: filter obvious generated garbage
 * 5. Tier recalibration: Featured 90+, Solid 70-89, Listed <70
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { scoreSkill } from './score.js';
import { TRACK1_FRESHNESS_FIELDS } from './lib/skill-fields.js';
import { readNdjsonRecords, writeNdjsonStreaming } from './lib/ndjson.js';
import { assignSlugs } from './lib/slug.js';
// F2: entity-type-aware filter dispatch + tag derivation.
import { isSlop as isSlopDispatch, dedupLanguageVariants } from './lib/filter-rules/index.js';
// Phase 3.2.1 (Audit B): content scanner — annotation only, never a gate.
import { scanContentFlags } from './lib/filter-rules/content.rules.js';
import { deriveTagsFromLegacyCategory, mergeTags } from './lib/tags.js';
// Phase 3.1.4: convert records to v2 EntityRecord shape on write so the
// polymorphic envelope is honored on the write path, not just the read
// path via the upcaster. Without this, skills-latest ships v1-shape
// records forever and Phase 3.2 plugins would need parallel data
// infrastructure. The upcaster preserves legacy flat fields alongside
// `extra.*` for the D+7 cutover window per 3.1.2-CUTOVER.md.
import { upcastRecord } from './lib/legacy-skill-reader.js';
import { buildHeader } from './lib/entity-version.js';
// Phase 3.2 (B-1): shared percentile tier assignment, also used by
// filter-plugins.js / filter-mcps.js. NO small-N carve-out.
import { assignPercentileTiers } from './lib/tier-assignment.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
// T4: NDJSON format (chunked I/O). Legacy .json path kept for graceful migration.
const RAW_PATH = join(ROOT, 'data', 'skills-raw.ndjson');
const LEGACY_RAW_PATH = join(ROOT, 'data', 'skills-raw.json');
// T5: NDJSON format (chunked I/O via scripts/lib/ndjson.js).
// Legacy .json path kept for one-week graceful migration window.
const OUTPUT_PATH = join(ROOT, 'data', 'skills.ndjson');
const LEGACY_OUTPUT_PATH = join(ROOT, 'data', 'skills.json');

// --- Enrichment preservation ---
// Some fields (skill_first_commit_at from Phase 2 DATA-01) are backfilled
// out-of-band and don't live in skills-raw.json. We load the current
// skills.json if it exists and copy these enrichments forward so they
// survive each filter run. Never overwrites a good value with null.
// Phase 3.1 Rev 2 BLOCKER 2: extended to carry the three new enrichment
// fields across daily runs. If enrich.js fails one day (OpenAI quota,
// NDJSON corrupt, runner OOM), yesterday's is_duplicate / canonical_slug /
// novelty_score values survive — the site doesn't visibly explode with
// duplicates until enrich.js succeeds again.
// NOTE (Phase 3.2.1, Audit B): 'content_flags' is deliberately NOT in PRESERVED_FIELDS —
// it is recomputed from the raw body on every filter run (see Step 1c in
// filterRaw). Copying it forward would let stale flags shadow a fresh scan.
// Exported for the filter.test.js regression guard.
export const PRESERVED_FIELDS = [
  'skill_first_commit_at',
  'is_duplicate',
  'canonical_slug',
  'novelty_score',
  // Phase 3.2 / F-3: the bundle-graph back edge populated by
  // scripts/link-bundles.js. Preserve it across re-filters so a partial
  // re-run of filter.js after link-bundles.js does not reset it to [].
  'bundled_in_plugins',
];

function loadPriorEnrichments() {
  // T5: prefer NDJSON; legacy JSON fallback during migration window.
  const source = existsSync(OUTPUT_PATH) ? OUTPUT_PATH
    : existsSync(LEGACY_OUTPUT_PATH) ? LEGACY_OUTPUT_PATH
    : null;
  if (!source) return new Map();
  try {
    let prior;
    if (source === OUTPUT_PATH) {
      prior = [...readNdjsonRecords(OUTPUT_PATH, { keyFn: r => r.id }).values()];
    } else {
      prior = JSON.parse(readFileSync(LEGACY_OUTPUT_PATH, 'utf-8'));
      if (!Array.isArray(prior)) return new Map();
    }
    const map = new Map();
    for (const p of prior) {
      if (!p || !p.id) continue;
      const enrichments = {};
      let anyValue = false;
      for (const field of PRESERVED_FIELDS) {
        if (p[field] != null) {
          enrichments[field] = p[field];
          anyValue = true;
        }
      }
      if (anyValue) map.set(p.id, enrichments);
    }
    return map;
  } catch {
    return new Map();
  }
}

// R3 — Track 1 freshness merge.
//
// Track 1 (scripts/scrape-pulse.js) updates the engagement fields below in
// skills.json IN PLACE every day. Track 2 (scrape.js) re-discovers skills
// and writes skills-raw.json with whatever values GitHub returned at
// discovery time — which may be hours stale relative to Track 1.
// When the same skill (matched by slug) exists in BOTH, we prefer Track 1's
// freshness fields. Then we re-score so quality_score reflects them.
//
// C1 (per 3.0.0-PLAN-CHECK): Why slug-keyed here, while loadPriorEnrichments
// is id-keyed? Different field classes need different merge keys:
//   - slug ("owner/skill-name") = stable repo identity. Track 1's daily
//     refresh and the skill's repo membership are tied to slug. Engagement
//     fields (stars, forks, etc.) belong to the REPO, so slug-keyed.
//   - id ("owner/repo/path") = stable RECORD identity. Content enrichments
//     like skill_first_commit_at are tied to the specific SKILL.md file at
//     a path, so id-keyed (a repo can host multiple SKILL.md files; each
//     gets its own enrichments).
// The two merges run independently and never compete for the same fields.
//
// The TRACK1_FRESHNESS_FIELDS list is imported from scripts/lib/skill-fields.js
// — single source of truth shared with scripts/scrape-pulse.js.

function loadCurrentSkillsBySlug() {
  // T5: prefer NDJSON; legacy JSON fallback during migration window.
  const source = existsSync(OUTPUT_PATH) ? OUTPUT_PATH
    : existsSync(LEGACY_OUTPUT_PATH) ? LEGACY_OUTPUT_PATH
    : null;
  if (!source) return new Map();
  try {
    let current;
    if (source === OUTPUT_PATH) {
      current = [...readNdjsonRecords(OUTPUT_PATH, { keyFn: r => r.id }).values()];
    } else {
      current = JSON.parse(readFileSync(LEGACY_OUTPUT_PATH, 'utf-8'));
      if (!Array.isArray(current)) return new Map();
    }
    const map = new Map();
    for (const s of current) {
      if (!s || !s.slug) continue;
      map.set(s.slug, s);
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Apply Track 1 freshness from current skills.json onto raw discovered
 * skills, then re-score affected records. Exported for unit testing.
 *
 * @param {Array<object>} raw - Skills from skills-raw.json
 * @param {Map<string, object>} currentBySlug - slug -> current skill record
 * @returns {{ mergedCount: number }}
 */
export function applyTrack1Freshness(raw, currentBySlug) {
  let mergedCount = 0;
  for (const skill of raw) {
    const existing = currentBySlug.get(skill.slug);
    if (!existing) continue;
    let touched = false;
    for (const field of TRACK1_FRESHNESS_FIELDS) {
      if (existing[field] !== undefined && existing[field] !== null) {
        skill[field] = existing[field];
        touched = true;
      }
    }
    if (touched) {
      // Re-score with merged values. score.js depends on stars (log-scaled)
      // and recency (days since pushed_at) — both updated above.
      skill.quality_score = scoreSkill(skill);
      mergedCount++;
    }
  }
  return { mergedCount };
}

// --- Config ---
const CONFIG = {
  // Phase 3.1: MAX_PER_REPO and MIN_STARS dropped. Embedding dedup
  // (scripts/enrich.js) is the new load-bearing gate against mega-repo
  // domination — penalizes content duplication, not per-repo volume.
  MIN_BODY_LENGTH: 200,  // Lowered from 500 (Phase 3.1)

  // Phase 3.1 ship-gate fix: tier assignment moved from absolute score
  // thresholds (90/70) to percentile rank. At post-3.1 catalog sizes
  // (~33k+), absolute thresholds put 84% in renderable tiers (Featured
  // 38% + Solid 46%) which blew Cloudflare Workers Static Assets'
  // 20,000-file free-tier cap (check-tier-budget.js gate fired in CI
  // run 26451472370). Percentile-based tiering auto-scales as the
  // catalog grows and restores meaning to the "Featured" label
  // (top 10% of catalog = real signal). RENDERABLE_CAP is defense in
  // depth — once catalog exceeds ~45k, even the percentiles overflow
  // the 18k budget and we trim the Solid tier to fit.
  FEATURED_PERCENTILE: 0.10,   // top 10% by quality_score → 'featured'
  SOLID_PERCENTILE: 0.30,      // next 30% → 'solid'; remainder → 'listed'
  RENDERABLE_CAP: 18000,       // safety net = Cloudflare 20k free cap - 2k margin

  // Legacy absolute thresholds — RETAINED for reference only. No longer
  // used in tier assignment. Kept here so analytics/dashboards that
  // reference these numbers don't silently drift; remove in Phase 3.6's
  // "Featured → Top" rename cleanup.
  FEATURED_THRESHOLD: 90,
  SOLID_THRESHOLD: 70,
};

// Placeholder/template skill names and descriptions
const TEMPLATE_NAMES = new Set([
  'agent-name', 'skill-name', 'example', 'example-skill', 'template',
  'my-skill', 'sample', 'sample-skill', 'untitled', 'new-skill',
  'placeholder', 'test', 'test-skill', 'hello-world', 'default',
]);

const PLACEHOLDER_DESC_PATTERNS = [
  /^one paragraph describing/i,
  /^describe what this/i,
  /^your description here/i,
  /^\[.*\]/,  // Starts with a bracket placeholder
  /^brief description of/i,
  /^this is a (sample|test|placeholder|template)/i,
];

// Business-domain AI slop patterns (auto-generated templates)
const BIZ_SLOP_PATTERNS = [
  /^(carrier|customs|energy|inventory|logistics|production|quality|returns|warehouse|fleet|freight|procurement|supply-chain|vendor|contract|compliance|audit|risk|incident|outage|regulatory)-/,
  /-management$/,
  /-compliance$/,
  /-optimization$/,
];

// F2: isSlop now delegates to the entity-type-aware rule-pack dispatcher
// in scripts/lib/filter-rules/index.js. The dispatcher applies common gates
// (template names / placeholder descriptions / biz-slop names) first, then
// per-entity-type gates selected by record.entity_type (default 'skill'
// for legacy v1 records on disk during the cutover window).
//
// The retained `TEMPLATE_NAMES`, `PLACEHOLDER_DESC_PATTERNS`, and
// `BIZ_SLOP_PATTERNS` constants above are referenced by filter.test.js;
// the production gate path is `isSlopDispatch(skill)` below.
function isSlop(skill) {
  return isSlopDispatch(skill);
}

// Deduplicate by base name (remove language variants like -ar, -de, -es).
// F2: thin delegator to common.rules.js so plugin/MCP filters share the same gate.
function deduplicateLanguageVariants(skills) {
  return dedupLanguageVariants(skills);
}

/**
 * Pure in-memory filter pipeline. Exported for unit tests so test code can
 * drive the full filter logic with synthetic inputs without touching disk.
 *
 * @param {Array<object>} raw - Raw skill records (same shape as skills-raw.ndjson)
 * @param {Map<string, object>} currentBySlug - slug -> prior skill record (for Track 1 freshness merge)
 * @param {Map<string, object>} priorEnrichments - id -> { skill_first_commit_at?, is_duplicate?, ... }
 * @returns {{
 *   capped: Array<object>,
 *   redirects: Object<string, string>,
 *   collisionCount: number,
 *   tiers: { featured: number, solid: number, listed: number },
 *   categories: Object<string, number>,
 *   uniqueRepos: number,
 *   mergedCount: number,
 *   preservedCount: number,
 *   contentFlagStats: { flagged_records: number, by_rule: Object<string, number>, multi_rule_records: number },
 * }}
 */
export function filterRaw(raw, currentBySlug = new Map(), priorEnrichments = new Map()) {
  const { mergedCount } = applyTrack1Freshness(raw, currentBySlug);

  // Step 1: slop filter (MIN_STARS removed in Phase 3.1)
  let filtered = raw.filter(s => !isSlop(s));

  // Step 1b: language variant dedup
  filtered = deduplicateLanguageVariants(filtered);

  // Step 1c (Phase 3.2.1, Audit B): content-scanner annotation. FLAG, don't
  // block — see content.rules.js header. MUST run before Step 4b truncation:
  // body_markdown here is the raw scraper output (5000-char cap); truncating
  // first would blind the scanner to payloads at offsets 1500-5000.
  // Recomputed from raw every run — deliberately NOT in PRESERVED_FIELDS.
  const contentFlagStats = { flagged_records: 0, by_rule: {}, multi_rule_records: 0 };
  for (const s of filtered) {
    s.content_flags = scanContentFlags(s);
    if (s.content_flags.length > 0) {
      contentFlagStats.flagged_records++;
      if (s.content_flags.length >= 2) contentFlagStats.multi_rule_records++;
      for (const r of s.content_flags) contentFlagStats.by_rule[r] = (contentFlagStats.by_rule[r] || 0) + 1;
    }
  }

  // Step 2: path-aware slug assignment (replaces old MAX_PER_REPO cap)
  const capped = filtered;
  const { redirects, collisionCount } = assignSlugs(capped);

  // Step 3: tier assignment (percentile rank + safety cap).
  //
  // Phase 3.2 (B-1): delegated to the shared `assignPercentileTiers` helper
  // so filter.js / filter-plugins.js / filter-mcps.js use identical math.
  // Passing CONFIG.RENDERABLE_CAP preserves the skill path's
  // defense-in-depth Solid-trim byte-for-byte (the plugin/MCP filters omit
  // the cap). NO small-N carve-out exists in the helper.
  assignPercentileTiers(capped, { renderableCap: CONFIG.RENDERABLE_CAP });

  // Step 4: sort
  capped.sort((a, b) => {
    if (b.quality_score !== a.quality_score) return b.quality_score - a.quality_score;
    if (b.repo_stars !== a.repo_stars) return b.repo_stars - a.repo_stars;
    return new Date(b.repo_pushed_at) - new Date(a.repo_pushed_at);
  });

  // Step 4b: trim body + placeholder enrichment fields + F2 invariants + F2 tags.
  for (const s of capped) {
    // F2 invariant (per src/lib/types.d.ts EntityCommon.body_length JSDoc):
    // body_length captures the ORIGINAL body length, BEFORE filter-stage
    // truncation. Capture pre-trim, assert post-trim it wasn't mutated.
    const originalBodyLengthBeforeTrim = (s.body_markdown && typeof s.body_markdown === 'string')
      ? s.body_markdown.length
      : (s.body_length || 0);

    if (s.body_markdown && s.body_markdown.length > 1500) {
      s.body_markdown = s.body_markdown.substring(0, 1500) + '...';
    }
    delete s.etag_repo;
    delete s.etag_content;
    delete s.consecutive_404s;
    if (s.is_duplicate === undefined) s.is_duplicate = null;
    if (s.canonical_slug === undefined) s.canonical_slug = null;
    if (s.novelty_score === undefined) s.novelty_score = null;

    // F2 — body_length invariant check. If the field already existed
    // (raw scraper records carry body_length pre-trim), it should equal the
    // pre-trim length we just captured. Drift bounded by SMALL_DRIFT_TOL
    // is auto-corrected silently (pre-F2 scraper computed body_length via
    // body_markdown.trim().length while storing untrimmed body_markdown,
    // producing 1-5 char drift from whitespace/newlines). Larger drift was
    // previously assumed to be an F2 writer bug and threw fatally — but in
    // production a single benign record (CJK / multi-byte length counting, or
    // heavy trailing whitespace) must NOT abort the whole filter and drop the
    // unreplayable daily history snapshot + deploy. The invariant now stays a
    // logged warning, not a pipeline circuit-breaker: large drift is warned
    // for visibility and then auto-corrected exactly like small drift.
    const SMALL_DRIFT_TOL = 10;
    if (typeof s.body_length === 'number' && s.body_length !== originalBodyLengthBeforeTrim) {
      if (s.body_length < originalBodyLengthBeforeTrim) {
        const drift = originalBodyLengthBeforeTrim - s.body_length;
        if (drift > SMALL_DRIFT_TOL) {
          console.warn(
            `[filter] body_length invariant drift for ${s.id}: ` +
            `body_length=${s.body_length} < pre-trim body_markdown.length=${originalBodyLengthBeforeTrim} ` +
            `(drift=${drift} > tolerance=${SMALL_DRIFT_TOL}). ` +
            `Auto-correcting to pre-trim length; not fatal (benign CJK/whitespace length drift).`,
          );
        }
        // Auto-correct drift (small: pre-F2 raw scraper quirk; large: benign
        // multi-byte/whitespace length divergence, warned above).
        s.body_length = originalBodyLengthBeforeTrim;
      }
      // s.body_length > originalBodyLengthBeforeTrim is FINE — body_markdown
      // got trimmed by scrape.js's 5000-char cap; body_length retains
      // the original pre-trim length as designed.
    } else if (typeof s.body_length !== 'number') {
      // Missing body_length — populate it once from the pre-trim length.
      s.body_length = originalBodyLengthBeforeTrim;
    }

    // F2 — derive category:* tag from legacy `category` field. The tag becomes
    // the canonical classifier; the legacy `category` field is retained on
    // disk through Phase 3.6 for back-compat. The upcaster projects category
    // back from tags on read.
    if (s.category) {
      const categoryTags = deriveTagsFromLegacyCategory(s.category);
      const existing = Array.isArray(s.tags) ? s.tags.filter((t) => typeof t === 'string') : [];
      // Merge: namespaced tags first (validated), then preserved legacy
      // freeform tags (which fail the strict namespace regex but carry
      // signal that consumers may still query). Dedup against namespaced.
      const validated = mergeTags(categoryTags);
      s.tags = validated.concat(existing.filter((t) => !validated.includes(t)));
    }
  }

  // Step 4c: preserve enrichments from prior skills.ndjson
  let preservedCount = 0;
  for (const s of capped) {
    const prior = priorEnrichments.get(s.id);
    if (!prior) continue;
    for (const field of PRESERVED_FIELDS) {
      if (s[field] == null && prior[field] != null) {
        s[field] = prior[field];
        preservedCount++;
      }
    }
  }

  // Stats
  const tiers = {
    featured: capped.filter(s => s.quality_tier === 'featured').length,
    solid: capped.filter(s => s.quality_tier === 'solid').length,
    listed: capped.filter(s => s.quality_tier === 'listed').length,
  };
  const categories = {};
  for (const s of capped) categories[s.category] = (categories[s.category] || 0) + 1;
  const uniqueRepos = new Set(capped.map(s => s.repo_full_name)).size;

  return {
    capped,
    redirects,
    collisionCount,
    tiers,
    categories,
    uniqueRepos,
    mergedCount,
    preservedCount,
    contentFlagStats,
  };
}

function main() {
  // Phase 3.0.1: graceful fallback for missing skills-raw.json.
  //
  // skills-raw.json (~295 MB) is gitignored and lives only in (a) the
  // developer's local data dir or (b) the GHA cache (restored at start of
  // each daily/weekly workflow run, seeded once via bootstrap-skills-raw.yml).
  //
  // Cases this guard handles:
  //   - First-ever CI run before bootstrap workflow ran: cache miss,
  //     skills-raw.json absent. We still want the daily pipeline to deploy
  //     Track 1's fresh skills.json — don't hard-fail.
  //   - Cache eviction (GHA's 7-day inactive eviction policy): same recovery.
  //
  // The "raw missing AND skills.json missing" cold-start case IS fatal —
  // we can't compute anything from nothing. Operator action: run the
  // bootstrap-skills-raw.yml workflow once.
  // T4: prefer NDJSON path; fall back to legacy JSON-array during migration window.
  const rawSource = existsSync(RAW_PATH) ? RAW_PATH
    : existsSync(LEGACY_RAW_PATH) ? LEGACY_RAW_PATH
    : null;

  if (!rawSource) {
    if (existsSync(OUTPUT_PATH)) {
      console.warn(`[filter] WARN: ${RAW_PATH} missing; preserving existing skills.json (Track-1-only day).`);
      console.warn(`[filter]       Run .github/workflows/bootstrap-skills-raw.yml to seed the GHA cache.`);
      console.warn(`[filter]       Or run \`node scripts/scrape-discover-repos.js\` locally to rebuild.`);
      console.warn(`[filter] Exiting 0 to allow daily workflow to proceed with Track 1 output.`);
      process.exit(0);
    }
    console.error(`[filter] FATAL: ${RAW_PATH}, ${LEGACY_RAW_PATH}, and ${OUTPUT_PATH} all missing — cold start.`);
    console.error(`[filter]        Run .github/workflows/bootstrap-skills-raw.yml first.`);
    process.exit(1);
  }

  console.log('=== ClaudeAtlas Filter ===');
  console.log(`Loading raw skills from ${rawSource}...`);

  let raw;
  if (rawSource === RAW_PATH) {
    // T4: chunked NDJSON read — V8-string-limit safe regardless of file size.
    const map = readNdjsonRecords(RAW_PATH, { keyFn: r => r.id });
    raw = [...map.values()];
  } else {
    // Legacy JSON-array path. Will FAIL with ERR_STRING_TOO_LONG on files
    // past ~500 MB; that's the bug T4 fixes. Loud warning so this branch
    // doesn't silently linger.
    console.warn(`[filter] WARN: reading LEGACY ${LEGACY_RAW_PATH} — run \`node scripts/migrate-raw-to-ndjson.js\` to convert.`);
    raw = JSON.parse(readFileSync(LEGACY_RAW_PATH, 'utf-8'));
  }
  console.log(`Raw skills: ${raw.length}`);

  // Load prior enrichments (skill_first_commit_at, etc.) from existing skills.json
  const priorEnrichments = loadPriorEnrichments();
  if (priorEnrichments.size > 0) {
    console.log(`Prior enrichments to preserve: ${priorEnrichments.size} records`);
  }

  // --- Step 0: Load Track 1 freshness map ---
  const currentSkillsBySlug = loadCurrentSkillsBySlug();
  if (currentSkillsBySlug.size > 0) {
    console.log(`R3 merge: ${currentSkillsBySlug.size} prior skills available for freshness merge`);
  }

  // --- Steps 0b through 4c: run the in-memory filter pipeline ---
  const {
    capped, redirects, collisionCount,
    tiers, categories, uniqueRepos,
    mergedCount, preservedCount, contentFlagStats,
  } = filterRaw(raw, currentSkillsBySlug, priorEnrichments);

  if (mergedCount > 0) {
    console.log(`R3 merge: applied Track 1 freshness + re-scored ${mergedCount} skills`);
  }
  console.log(`After slop filters (body>=${CONFIG.MIN_BODY_LENGTH}): ${capped.length} (post slug+lang dedup)`);
  console.log(`Slug pass: ${collisionCount} collisions resolved, ${Object.keys(redirects).length} redirect entries`);

  // Persist the redirect map to disk so the worker bundle picks it up.
  const REDIRECTS_PATH = join(ROOT, 'data', 'slug-redirects.json');
  writeFileSync(
    REDIRECTS_PATH,
    JSON.stringify({
      generated_at: new Date().toISOString(),
      note: 'Phase 3.1: old (owner/name) → new (owner/repo/name) for collision-resolved records. Consumed by worker/index.js at build time.',
      redirects,
    }, null, 2),
    'utf-8',
  );
  console.log(`Wrote ${Object.keys(redirects).length} redirect entries to ${REDIRECTS_PATH}`);

  if (preservedCount > 0) {
    console.log(`Preserved ${preservedCount} enrichment values from prior skills.ndjson`);
  }

  console.log();
  console.log('=== Final Results ===');
  console.log(`Total skills: ${capped.length}`);
  console.log(`Unique repos: ${uniqueRepos}`);
  console.log(`Tiers: ${tiers.featured} Featured, ${tiers.solid} Solid, ${tiers.listed} Listed`);
  // Audit B summary — flags are annotations, never gates; surfaced for review.
  console.log(`Content flags: ${contentFlagStats.flagged_records} flagged (${contentFlagStats.multi_rule_records} multi-rule)`);
  console.log(`Categories:`);
  for (const [cat, count] of Object.entries(categories).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }

  // T5: streaming NDJSON write (V8-string-limit safe).
  // Phase 3.1.4: each record is upcast to v2 EntityRecord shape (nests
  // skill-specific fields under `extra`, sets entity_type='skill',
  // schema_version=2). Legacy flat fields are preserved by the upcaster
  // for the D+7 cutover window. `opts.header` prepends the canonical
  // `_header: true, schema_version: 2, entity_type: 'skill', generated_at`
  // sentinel line per scripts/lib/entity-version.js.
  const v2Records = capped.map(upcastRecord);
  writeNdjsonStreaming(OUTPUT_PATH, v2Records, { header: buildHeader('skill') });
  console.log(`\nWritten to ${OUTPUT_PATH} (v2 EntityRecord shape; schema_version=2; entity_type=skill)`);

  // Also update the stats file
  const STATS_PATH = join(ROOT, 'data', 'pipeline-stats.json');
  const stats = {
    timestamp: new Date().toISOString(),
    total_discovered: raw.length,
    total_skills: capped.length,
    unique_repos: uniqueRepos,
    tiers,
    categories,
    // Phase 3.2.1 (Audit B): per-run content-scanner summary. Counts only —
    // pipeline-stats.json stays a bounded sidecar (allowlisted).
    content_flags: contentFlagStats,
    filter_config: CONFIG,
  };
  writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2), 'utf-8');
}

// Only run main() when invoked as a script, not when imported by tests.
// import.meta.url is a file:// URL; process.argv[1] is a path. Normalize.
const invokedAsScript = (() => {
  try {
    return import.meta.url === fileURLToPath(`file://${process.argv[1]}`).replace(/\\/g, '/')
      || fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (invokedAsScript) {
  main();
}

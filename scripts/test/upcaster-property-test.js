#!/usr/bin/env node
/**
 * scripts/test/upcaster-property-test.js — F2 Smoke E.1.
 *
 * 20-sample field-level property test of the v1→v2 upcaster.
 *
 * For each sampled record:
 *   (a) Every common field present on the v2 record.
 *   (b) Every SkillExtra field correctly nested under `extra`.
 *   (c) Tags includes the expected `category:*` tag.
 *   (d) Dual-shape: legacy flat fields preserved (for cutover-window
 *       back-compat).
 *
 * Exits 0 on "20/20 identical"; non-zero with diff log otherwise.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolveSkillsNdjsonPath } from '../../scripts/lib/build-input.js';
import { loadAllSkillsSync } from '../../scripts/lib/skills-stream.js';
import { upcastRecord } from '../../scripts/lib/legacy-skill-reader.js';
import { deriveTagsFromLegacyCategory } from '../../scripts/lib/tags.js';

const REQUIRED_COMMON_FIELDS = [
  'id', 'slug', 'entity_type', 'name', 'description',
  'repo_full_name', 'repo_url', 'repo_stars', 'repo_forks',
  'repo_open_issues', 'repo_topics', 'repo_license', 'repo_language',
  'repo_created_at', 'repo_updated_at', 'repo_pushed_at',
  'repo_owner_type', 'repo_owner_avatar', 'repo_archived', 'repo_is_fork',
  'repo_description', 'body_length', 'quality_score', 'quality_tier',
  'novelty_score', 'is_duplicate', 'canonical_id', 'tags', 'category',
  'scraped_at', 'content_sha', 'source', 'discovery_signals', 'schema_version',
  'extra',
];

const REQUIRED_EXTRA_FIELDS = [
  'type', 'skill_path', 'body_markdown', 'frontmatter',
  'has_name', 'has_description', 'skill_first_commit_at',
];

function checkSample(rec) {
  const upcast = upcastRecord(rec);
  const errors = [];

  // (a) common fields
  for (const f of REQUIRED_COMMON_FIELDS) {
    if (!(f in upcast)) errors.push(`missing common field: ${f}`);
  }

  // entity_type discriminator
  if (upcast.entity_type !== 'skill') errors.push(`entity_type !== 'skill' (got ${upcast.entity_type})`);

  // schema_version pinned
  if (upcast.schema_version !== 2) errors.push(`schema_version !== 2 (got ${upcast.schema_version})`);

  // (b) extra fields
  for (const f of REQUIRED_EXTRA_FIELDS) {
    if (!(f in upcast.extra)) errors.push(`missing extra field: extra.${f}`);
  }
  if (upcast.extra.type !== 'skill') errors.push(`extra.type !== 'skill' (got ${upcast.extra.type})`);

  // (c) category tag derived correctly
  if (rec.category) {
    const expected = deriveTagsFromLegacyCategory(rec.category)[0];
    if (expected && !upcast.tags.includes(expected)) {
      errors.push(`tags missing expected category tag: ${expected}`);
    }
  }

  // (d) dual-shape preservation
  if (rec.body_markdown !== undefined && upcast.body_markdown !== rec.body_markdown) {
    errors.push('dual-shape: body_markdown not preserved at top level');
  }
  if (rec.skill_path !== undefined && upcast.skill_path !== rec.skill_path) {
    errors.push('dual-shape: skill_path not preserved at top level');
  }
  if (upcast.has_name !== Boolean(rec.has_name)) {
    errors.push('dual-shape: has_name not preserved at top level');
  }

  // round-trip: extra.body_markdown must equal top-level body_markdown
  if (upcast.extra.body_markdown !== upcast.body_markdown) {
    errors.push('round-trip: extra.body_markdown !== top-level body_markdown');
  }

  return errors;
}

function main() {
  const path = resolveSkillsNdjsonPath();
  if (!existsSync(path)) {
    console.error(`[upcaster-property-test] ${path} not found`);
    process.exit(2);
  }

  // Load all records, then sample 20 evenly across the file (or all if <20).
  const all = loadAllSkillsSync(path);
  if (all.length === 0) {
    console.error('[upcaster-property-test] no records loaded');
    process.exit(2);
  }

  const N = Math.min(20, all.length);
  const stride = Math.max(1, Math.floor(all.length / N));
  const samples = [];
  for (let i = 0; i < N; i++) samples.push(all[i * stride]);

  let pass = 0;
  const failures = [];
  for (const rec of samples) {
    const errs = checkSample(rec);
    if (errs.length === 0) {
      pass++;
    } else {
      failures.push({ id: rec.id || rec.slug, errors: errs });
    }
  }

  console.log(`[upcaster-property-test] ${pass}/${N} identical at field level`);
  if (failures.length > 0) {
    for (const f of failures) {
      console.error(`  FAIL ${f.id}:`);
      for (const e of f.errors) console.error(`    - ${e}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main();

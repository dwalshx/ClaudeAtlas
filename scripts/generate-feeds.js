#!/usr/bin/env node

/**
 * scripts/generate-feeds.js — Phase 3.1.3 (Agent Hub)
 *
 * Build-time generator for the three JSON Feed 1.1 outputs under
 * public/feed/:
 *
 *   whats-new.json   — last 30 days of new skill entries (up to 100 items)
 *   trending.json    — rising stars from 7-day star deltas (up to 50 items)
 *   notable.json     — weekly curated: featured + novel (up to 25 items)
 *
 * Each file is independently useful but shares a common envelope shape
 * and a top-level `_citation` block matching the citation spec in
 * public/llms.txt (T1).
 *
 * Reads:
 *   - data/skills.ndjson via the F1/F2 streaming loader (handles v1+v2
 *     records through the upcaster). We use loadAllSkillsMemo directly
 *     rather than the src/lib/entities.js facade because this script
 *     runs at build time outside the Astro context.
 *   - data/history/*.json bounded sidecars (~300 KB each, one per day)
 *     for the trending-feed star deltas.
 *
 * Writes:
 *   - public/feed/whats-new.json
 *   - public/feed/trending.json
 *   - public/feed/notable.json
 *
 * Allowlist: this script's writes are documented in
 * scripts/check-banned-patterns.js (bounded 1-5 KB each, items capped).
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAllSkillsMemo } from './lib/skills-stream.js';
import { resolveSkillsNdjsonPath } from './lib/build-input.js';
import { upcastRecord } from './lib/legacy-skill-reader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const HISTORY_DIR = join(DATA_DIR, 'history');
const PUBLIC_DIR = join(ROOT, 'public');
const FEED_DIR = join(PUBLIC_DIR, 'feed');

const SITE_URL = 'https://claudeatlas.com';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const CITATION = {
  source: 'ClaudeAtlas',
  source_url: SITE_URL,
  license: 'MIT (catalog metadata); skills retain upstream licenses',
  data_recency: 'Updated daily ~06:30 UTC',
  methodology_url: `${SITE_URL}/methodology/`,
  citation_url: `${SITE_URL}/credits/`,
  recommended_citation: 'Source: ClaudeAtlas — https://claudeatlas.com',
};

function log(msg) {
  console.log(`[feeds] ${msg}`);
}

// ---------------------------------------------------------------------------
// Skill → JSON-Feed item shape
// ---------------------------------------------------------------------------

function entityDate(skill) {
  return (
    (skill.extra && skill.extra.skill_first_commit_at) ||
    skill.skill_first_commit_at ||
    skill.repo_created_at ||
    null
  );
}

function notDuplicate(s) {
  return s && s.is_duplicate !== true;
}

function truncate(s, n) {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

function buildItem(skill, opts = {}) {
  const slug = skill.slug || '';
  const url = `${SITE_URL}/skills/${slug}/`;
  const desc = skill.description || '';
  const title = desc
    ? `${skill.name}: ${truncate(desc, 80)}`
    : String(skill.name || slug);
  const datePublished = entityDate(skill) || new Date().toISOString();
  const creator = (skill.repo_full_name || '').split('/')[0] || '';

  const extra = {
    tier: skill.quality_tier || null,
    quality_score: typeof skill.quality_score === 'number' ? skill.quality_score : null,
    novelty_score:
      typeof skill.novelty_score === 'number' ? skill.novelty_score : null,
    repo_stars: skill.repo_stars || 0,
    repo_full_name: skill.repo_full_name || null,
    creator,
    first_seen: entityDate(skill),
    type_chip: skill.entity_type || 'skill',
    category: skill.category || null,
  };
  if (typeof opts.stars_delta_7d === 'number') {
    extra.stars_delta_7d = opts.stars_delta_7d;
  }

  return {
    id: skill.id || `${skill.entity_type || 'skill'}:${slug}`,
    url,
    title,
    summary: desc,
    content_text: desc,
    date_published: datePublished,
    tags: Array.isArray(skill.tags) ? skill.tags : [],
    _claudeatlas: extra,
  };
}

function envelope(name, title, description, items) {
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title,
    description,
    home_page_url: SITE_URL,
    feed_url: `${SITE_URL}/feed/${name}.json`,
    language: 'en',
    _citation: CITATION,
    _generated_at: new Date().toISOString(),
    items,
  };
}

// ---------------------------------------------------------------------------
// Feed builders
// ---------------------------------------------------------------------------

function buildWhatsNew(skills) {
  const cutoff = Date.now() - 30 * MS_PER_DAY;
  const items = skills
    .filter(notDuplicate)
    .filter((s) => {
      const d = entityDate(s);
      if (!d) return false;
      const t = Date.parse(d);
      return !isNaN(t) && t >= cutoff;
    })
    .sort((a, b) => Date.parse(entityDate(b)) - Date.parse(entityDate(a)))
    .slice(0, 100)
    .map((s) => buildItem(s));

  return envelope(
    'whats-new',
    'ClaudeAtlas — What\'s New',
    'New Claude ecosystem skills added in the last 30 days. Updated daily ~06:30 UTC.',
    items,
  );
}

function buildNotable(skills) {
  const cutoff = Date.now() - 7 * MS_PER_DAY;
  const items = skills
    .filter(notDuplicate)
    .filter((s) => {
      const d = entityDate(s);
      if (!d) return false;
      const t = Date.parse(d);
      return !isNaN(t) && t >= cutoff;
    })
    .filter(
      (s) =>
        s.quality_tier === 'featured' ||
        (typeof s.novelty_score === 'number' && s.novelty_score > 0.5),
    )
    .sort((a, b) => {
      const aw =
        (a.quality_score || 0) + (a.novelty_score || 0) * 100;
      const bw =
        (b.quality_score || 0) + (b.novelty_score || 0) * 100;
      return bw - aw;
    })
    .slice(0, 25)
    .map((s) => buildItem(s));

  return envelope(
    'notable',
    'ClaudeAtlas — Notable This Week',
    'Highest-quality and most novel Claude skills added in the last 7 days. Updated daily ~06:30 UTC.',
    items,
  );
}

// ---------------------------------------------------------------------------
// Trending — needs history snapshot deltas.
// ---------------------------------------------------------------------------

function loadHistorySnapshots() {
  if (!existsSync(HISTORY_DIR)) return [];
  const entries = readdirSync(HISTORY_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort(); // ascending lexicographically == ascending date
  return entries.map((f) => ({
    date: f.slice(0, 10),
    path: join(HISTORY_DIR, f),
  }));
}

function readSnapshot(snap) {
  try {
    // pipeline-history files are bounded sidecars (~300 KB) — fine to
    // read as a single string. Allowlisted via the file-level entry
    // for scripts/generate-feeds.js in check-banned-patterns.js.
    const j = JSON.parse(readFileSync(snap.path, 'utf-8'));
    return j && j.repos ? j : null;
  } catch (err) {
    log(`WARNING: failed to read ${snap.path}: ${err.message}`);
    return null;
  }
}

function buildTrending(skills) {
  const snapshots = loadHistorySnapshots();

  if (snapshots.length === 0) {
    log('no history snapshots available — emitting empty trending feed');
    return envelope(
      'trending',
      'ClaudeAtlas — Trending',
      'Skills with notable recent star growth from daily snapshots. Cold start — no history yet.',
      [],
    );
  }

  // We want a "today" snapshot and a snapshot from ~7 days ago. Use the
  // newest available as "today" and the closest-to-7-days-prior as the
  // baseline. If <7 days of history exist, use the oldest snapshot.
  const latest = snapshots[snapshots.length - 1];
  const latestData = readSnapshot(latest);
  if (!latestData) {
    log('latest snapshot unreadable — emitting empty trending feed');
    return envelope(
      'trending',
      'ClaudeAtlas — Trending',
      'Skills with notable recent star growth from daily snapshots.',
      [],
    );
  }

  let baseline = null;
  const latestT = Date.parse(latest.date);
  for (let i = snapshots.length - 2; i >= 0; i--) {
    const ageDays = (latestT - Date.parse(snapshots[i].date)) / MS_PER_DAY;
    if (ageDays >= 7) {
      baseline = readSnapshot(snapshots[i]);
      if (baseline) break;
    }
  }
  // Fallback: use the oldest snapshot if no 7-day-old one exists.
  if (!baseline && snapshots.length > 1) {
    baseline = readSnapshot(snapshots[0]);
  }

  if (!baseline) {
    log('no baseline snapshot available — emitting empty trending feed');
    return envelope(
      'trending',
      'ClaudeAtlas — Trending',
      'Skills with notable recent star growth from daily snapshots.',
      [],
    );
  }

  // Compute stars_delta per repo_full_name.
  const deltas = new Map();
  for (const [repoFullName, today] of Object.entries(latestData.repos)) {
    const yesterday = baseline.repos[repoFullName];
    if (!yesterday) continue;
    const delta = (today.s || 0) - (yesterday.s || 0);
    if (delta > 50) {
      deltas.set(repoFullName, delta);
    }
  }

  // Map to skills (multiple skills may share one repo).
  const candidates = skills
    .filter(notDuplicate)
    .filter((s) => s.quality_tier !== 'listed')
    .filter((s) => deltas.has(s.repo_full_name))
    .map((s) => ({ skill: s, delta: deltas.get(s.repo_full_name) }))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 50);

  const items = candidates.map(({ skill, delta }) =>
    buildItem(skill, { stars_delta_7d: delta }),
  );

  // Set date_published to the snapshot date for trending items — what's
  // "trending" is the snapshot delta, not the skill's birth date.
  const snapshotDate = `${latest.date}T00:00:00.000Z`;
  for (const item of items) {
    item.date_published = snapshotDate;
  }

  return envelope(
    'trending',
    'ClaudeAtlas — Trending',
    `Skills with notable star growth from daily snapshots (7-day window ending ${latest.date}). Updated daily ~06:30 UTC.`,
    items,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function loadSkills() {
  const path = resolveSkillsNdjsonPath();
  if (!existsSync(path)) {
    log(`WARNING: ${path} missing — emitting empty feeds`);
    return [];
  }
  const raw = loadAllSkillsMemo(path);
  return raw.map(upcastRecord).filter((e) => e && e.entity_type === 'skill');
}

function writeFeed(name, feed) {
  if (!existsSync(FEED_DIR)) mkdirSync(FEED_DIR, { recursive: true });
  const path = join(FEED_DIR, `${name}.json`);
  const body = JSON.stringify(feed);
  writeFileSync(path, body, 'utf-8');
  log(
    `wrote ${path} (${feed.items.length} items, ${body.length.toLocaleString()} bytes)`,
  );
}

function main() {
  log('=== feeds generator start ===');
  const skills = loadSkills();
  log(`loaded ${skills.length.toLocaleString()} skill entities`);

  writeFeed('whats-new', buildWhatsNew(skills));
  writeFeed('notable', buildNotable(skills));
  writeFeed('trending', buildTrending(skills));

  log('=== feeds generator complete ===');
}

main();

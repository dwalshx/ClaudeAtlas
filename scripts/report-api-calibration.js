/**
 * scripts/report-api-calibration.js
 *
 * Phase 4.2 Plan 13 (D-06, 4.2-M12). Dev-only — NOT in the cron. Reads
 * data/apis-raw.ndjson + data/apis.ndjson through readNdjsonRecords,
 * recomputes the drop table via filterApisRaw(raw), and writes the
 * calibration markdown to the path given as argv[2]. No weights are changed
 * here; this script only reports.
 *
 * Usage: node scripts/report-api-calibration.js <out.md>
 */

import { writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readNdjsonRecords } from './lib/ndjson.js';
import { filterApisRaw, rawKey, SOURCES } from './filter-apis.js';
import {
  scoreFeedDocs, scoreFeedLicense, feedFreshnessInput, scoreFeedPopularity, scoreAdoption,
  NEUTRAL_FRESHNESS, NEUTRAL_REACHABILITY,
} from './lib/scorers/feed.signals.js';
import { scoreRecency } from './score.js';
import { hasBizSlopName } from './lib/filter-rules/common.rules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RAW_PATH = join(ROOT, 'data', 'apis-raw.ndjson');
const OUT_PATH = join(ROOT, 'data', 'apis.ndjson');

const SIGNALS = ['access', 'reachability', 'docs', 'license', 'freshness', 'popularity', 'adoption'];

/** Re-derive the 7 api signals exactly as api.scorer.js computes them. */
export function signalsOf(r) {
  const input = feedFreshnessInput(r);
  return {
    access: (Number(r?.extra?.access_clarity) || 0) * 100,
    reachability: NEUTRAL_REACHABILITY,
    docs: scoreFeedDocs(r),
    license: scoreFeedLicense(r),
    freshness: input == null ? NEUTRAL_FRESHNESS : scoreRecency(input),
    popularity: scoreFeedPopularity(r),
    adoption: scoreAdoption(r),
  };
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const n1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–');
const fmt = (n) => Number(n).toLocaleString('en-US');
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const table = (head, rows) => [
  `| ${head.join(' | ')} |`,
  `|${head.map(() => '---').join('|')}|`,
  ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`),
].join('\n');
const countBy = (xs, f) => {
  const m = new Map();
  for (const x of xs) {
    const k = f(x);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

function signalRow(r) {
  const s = signalsOf(r);
  return [r.name, r.slug, r.origin?.source, r.quality_score, r.quality_tier, ...SIGNALS.map((k) => n1(s[k]))];
}

export function buildReport(raw, filtered, { date = new Date().toISOString().slice(0, 10) } = {}) {
  // Capture filter-apis' id-collision warnings (the suffixed record may be dropped by a gate later).
  const collisionLines = [];
  const origWarn = console.warn;
  console.warn = (...a) => {
    const s = a.join(' ');
    if (s.includes('id collision')) collisionLines.push(s.replace(/^\[filter-apis\] id collision: /, ''));
    else origWarn(...a);
  };
  let stats;
  try {
    ({ stats } = filterApisRaw(structuredClone(raw)));
  } finally {
    console.warn = origWarn;
  }
  const records = filtered;
  const md = [];
  const push = (...l) => md.push(...l);

  // --- Run
  const guruRaw = raw.filter((r) => r.origin?.source === 'apis.guru');
  const parsedTrue = guruRaw.filter((r) => r.extra?.spec_parsed === true).length;
  const unparsed = guruRaw.filter((r) => r.extra?.spec_parsed !== true);
  const byReason = new Map();
  for (const r of unparsed) {
    const k = r.raw_source?.spec_skip_reason ?? '(none)';
    if (!byReason.has(k)) byReason.set(k, []);
    byReason.get(k).push(r);
  }
  const collided = records.filter((r) => String(r.id).includes('~'));
  const alsoListed = records.filter((r) => (r.origin?.also_listed_in || []).length > 0);

  push('## Run', '',
    `- Date: ${date}. Real local harvest (network) + filter-apis.js; scorer weights are the spec table (UNCALIBRATED), api Freshness neutral 50 when unknown (decision 8).`,
    `- Raw ${fmt(stats.total_raw)} → merged ${fmt(stats.total_merged)} → kept ${fmt(stats.total_apis)} (records in data/apis.ndjson: ${fmt(records.length)}).`,
    `- Merged duplicates: cross_source ${stats.merged_duplicates.cross_source}, same_source ${stats.merged_duplicates.same_source}. Kept records with a non-empty \`also_listed_in\`: ${alsoListed.length}.`,
    `- id_collisions: ${stats.id_collisions}${collisionLines.length ? ` — ${collisionLines.map((l) => `\`${esc(l)}\``).join('; ')}` : ''}. Suffixed ids still present in data/apis.ndjson: ${collided.length ? collided.map((r) => `\`${r.id}\``).join(', ') : 'none (the suffixed record was dropped by a gate)'}. Each is a merge-key fix candidate for 4.x.`,
    '',
    table(['source', 'raw', 'kept', 'kept %'], SOURCES.map((s) => {
      const b = stats.by_source[s];
      return [s, fmt(b.raw), fmt(b.kept), b.raw ? `${((100 * b.kept) / b.raw).toFixed(1)}%` : '–'];
    })),
    '',
    `Spec pass (APIs.guru raw, ${fmt(guruRaw.length)} records): spec_parsed true ${fmt(parsedTrue)}, false ${fmt(unparsed.length)}.`,
    '',
    table(['spec_skip_reason', 'count'], [...byReason.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, v]) => [k, v.length])),
    '',
    '### Every spec_parsed:false record, grouped by reason',
    '');
  for (const [k, v] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
    push(`**${k}** (${v.length}): ${v.map((r) => `\`${esc(r.origin?.source_id)}\``).sort().join(', ')}`, '');
  }

  // --- Tiers
  push('## Tiers', '', table(['tier', 'count'], [['featured', stats.tiers.featured], ['solid', stats.tiers.solid], ['listed', stats.tiers.listed]]), '');
  push('## Tiers × source', '', table(['source', 'featured', 'solid', 'listed', 'total'], SOURCES.map((s) => {
    const rs = records.filter((r) => r.origin?.source === s);
    const c = (t) => rs.filter((r) => r.quality_tier === t).length;
    return [s, c('featured'), c('solid'), c('listed'), rs.length];
  })), '');

  // --- Signal means
  push('## Signal means per source', '', '(kept records; signals re-derived exactly as api.scorer.js; weights access .20, others .15, adoption .05)', '',
    table(['source', 'n', ...SIGNALS, 'quality_score'], SOURCES.map((s) => {
      const rs = records.filter((r) => r.origin?.source === s);
      const sig = rs.map(signalsOf);
      return [s, rs.length, ...SIGNALS.map((k) => n1(mean(sig.map((x) => x[k])))), n1(mean(rs.map((r) => r.quality_score)))];
    })), '');
  const guruKept = records.filter((r) => r.origin?.source === 'apis.guru');
  const guruNeutral = guruKept.filter((r) => feedFreshnessInput(r) == null).length;
  const freshDist = (s) => countBy(records.filter((r) => r.origin?.source === s), (r) => signalsOf(r).freshness)
    .sort((a, b) => b[0] - a[0]).map(([v, c]) => `${v}: ${c}`).join(', ');
  push(`Freshness under decision 8: ${guruNeutral} of ${guruKept.length} kept APIs.guru records have no usable \`source_modified_at\` (the directory is a frozen 2023 snapshot; the harvester nulls pre-2024 dates), so they score NEUTRAL 50 instead of the 5 a stale date would give. Without decision 8 the APIs.guru mean quality_score would be ≈ 6.75 points lower (0.15 × 45).`, '',
    'Freshness value distribution per source (value: records):', '',
    table(['source', 'freshness distribution'], SOURCES.map((s) => [s, freshDist(s)])), '',
    'data.gouv.fr and UK records carry REAL modification dates, so a stale real date (e.g. UK `dateUpdated` in 2020 → 5) now scores BELOW an unknown one (50): decision 8 rewards "unknown" over "known and old". public-apis has no date at all → neutral 50. Access is still a declared-field bias: data.gouv.fr declares rate_limiting + access_type and is a cost-free catalog, whereas APIs.guru records get auth from the spec only (cost and rate limit stay unknown).', '');

  // --- Top / bottom
  const sorted = [...records].sort((a, b) => b.quality_score - a.quality_score || String(a.id).localeCompare(String(b.id)));
  const head = ['name', 'slug', 'source', 'score', 'tier', ...SIGNALS];
  push('## Top 20', '', table(head, sorted.slice(0, 20).map(signalRow)), '');
  push('## Bottom 20', '', table(head, sorted.slice(-20).reverse().map(signalRow)), '');

  // --- Access clarity
  const h = stats.access_clarity_histogram;
  push('## Access clarity histogram', '', table(['bucket', 'count'], h.map((c, i) => [`${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}${i === 9 ? ' (incl. 1.0)' : ''}`, c])), '');
  push('### auth.type distribution (kept)', '', table(['auth.type', 'method', 'count'],
    countBy(records, (r) => `${r.access?.auth?.type}\u0000${r.access?.provenance?.['auth.type']?.method ?? '–'}`)
      .map(([k, c]) => [...k.split('\u0000'), c])), '');
  const specNone = records.filter((r) => r.access?.auth?.type === 'none' && r.access?.provenance?.['auth.type']?.method === 'spec').length;
  push(`Spec-derived \`none\` (OpenAPI document declares no security scheme): ${specNone}. Several of these are keyed APIs in practice, so \`none\` at confidence 0.9 is optimistic.`, '');
  push('## 10 highest-scored unknown-auth records', '', table(head,
    sorted.filter((r) => (r.access?.auth?.type ?? 'unknown') === 'unknown').slice(0, 10).map(signalRow)), '');

  // --- Rate limit
  const gouvKept = records.filter((r) => r.origin?.source === 'data.gouv.fr');
  const parsedRl = gouvKept.filter((r) => typeof r.access?.rate_limit?.requests === 'number').length;
  const notesOnly = gouvKept.filter((r) => typeof r.access?.rate_limit?.requests !== 'number' && r.access?.rate_limit?.notes).length;
  push('## Rate-limit parse', '', table(['data.gouv.fr kept', 'records'], [
    ['parsed (requests + per)', parsedRl], ['notes only (unparseable free text)', notesOnly], ['no rate_limiting declared', gouvKept.length - parsedRl - notesOnly],
  ]), '', 'Parsed limits earn full Access credit × 0.8; notes-only earn half credit (accessClarity rule).', '');

  // --- Drops
  push('## Drops', '', table(['gate', 'dropped'], Object.entries(stats.dropped)), '');
  const rawByName = new Map(raw.map((r) => [`${r.origin?.source}:${r.name}`, r]));
  push('### short_description (< 50 chars), grouped by source', '');
  for (const s of SOURCES) {
    const names = stats.dropped_names.short_description.filter((n) => n.startsWith(`${s}:`));
    push(`**${s}** (${names.length}):`, '');
    push(names.length ? names.map((n) => {
      const r = rawByName.get(n);
      return `\`${esc(n.slice(s.length + 1))}\` (${(r?.description ?? '').length})`;
    }).join(', ') : '_none_', '');
  }
  for (const g of ['no_home_url', 'no_base_or_spec', 'biz_slop', 'placeholder_description', 'template_name', 'fixture_repo']) {
    const names = stats.dropped_names[g];
    push(`### ${g} (${names.length})`, '', names.length ? names.map((n) => `\`${esc(n)}\``).join(', ') : '_none_', '');
  }
  const bizAll = raw.filter((r) => hasBizSlopName(r));
  push(`### BIZ_SLOP_PATTERNS across ALL raw names (pre-merge, pre-gate): ${bizAll.length}`, '',
    bizAll.length ? table(['source', 'name', 'title / API'], bizAll.map((r) => [r.origin?.source, r.name, r.raw_source?.title ?? r.raw_source?.API ?? r.raw_source?.name ?? ''])) : '_none_', '',
    'Research (2026-11-05) expected 19: the 7 data.gouv.fr `production-…` électricité titles, `Library Management`, `Carrier Ledger`, `Asset Management`, `Customs Inventory Linking Exports` (UK/public-apis), and 8 APIs.guru names. The `biz_slop` gate count above can be lower than this list because some of these records are dropped earlier (short description) or merged away.', '');
  const between = (s) => raw.filter((r) => r.origin?.source === s && (r.description ?? '').length >= 30 && (r.description ?? '').length < 50).length;
  const guruEmpty = guruRaw.filter((r) => !(r.description ?? '').trim()).length;
  push('### Recommendation', '',
    `- **biz-slop:** every name listed above is a real, documented API (energy-production feeds, library/asset management systems, customs services), not LLM-generated skill slop. Recommend exempting the \`api\` rule pack from \`BIZ_SLOP_PATTERNS\` (a one-line dispatch change in scripts/lib/filter-rules/index.js) rather than narrowing the patterns, which still protect the skill catalog.`,
    `- **description floor:** \`MIN_DESCRIPTION_LENGTH\` 50 → 30 would recover (raw records with 30 ≤ len < 50): ${SOURCES.map((s) => `${s} ${between(s)}`).join(', ')}.`,
    `- **empty APIs.guru descriptions:** ${guruEmpty} raw APIs.guru records have an empty description. A harvester-side fallback built from \`info.title\` + provider + categories (derivation, not padding — decision 6) would bring them back; report only, not implemented.`,
    '');

  // --- public-apis
  const pubKept = records.filter((r) => r.origin?.source === 'public-apis');
  const pubLinkOnly = pubKept.filter((r) => !r.extra?.spec_url).length;
  push('## public-apis-only records', '',
    `${pubKept.length} public-apis records won their merge group and were kept; ${pubLinkOnly} of them pass HAS_BASE_URL_OR_SPEC only because \`base_urls = [Link]\` (decision 2). That \`base_urls[0]\` is usually a docs or landing page, not an API base URL; its provenance is \`declared\` at 0.5, and the 4.4 reachability probe must treat it as a landing URL (expect HTML, not JSON).`, '');

  // --- Levers
  push('## Levers (not applied — D-06/D-08)', '',
    '- Per-source Popularity proxy (today every api record gets neutral 50): data.gouv.fr `metrics.views` / `followers`, APIs.guru `x-preferred` / version count, GitHub stars of `x-origin` repos (~1,346 GitHub-backed specs; needs API calls).',
    '- Lower the api description floor (50 → 30), or derive descriptions for empty APIs.guru entries (see Recommendation).',
    '- Exempt api from `BIZ_SLOP_PATTERNS`.',
    '- Freshness source-awareness beyond decision 8 (e.g. use x-origin repo pushed_at for GitHub-backed APIs.guru specs).',
    '- Fetch data.gouv.fr `machine_documentation_url` specs and APIs.guru `x-origin` GitHub specs (4.x) so more records get spec-derived auth / formats / base URLs.',
    '- Spec-derived `none` auth at 0.9 is optimistic; consider 0.6 when no securitySchemes are declared.',
    '');

  return { markdown: md.join('\n'), stats };
}

function main() {
  const out = process.argv[2];
  if (!out) {
    console.error('Usage: node scripts/report-api-calibration.js <out.md>');
    process.exit(1);
  }
  if (!existsSync(RAW_PATH) || !existsSync(OUT_PATH)) {
    console.error(`[report-api-calibration] need ${RAW_PATH} and ${OUT_PATH} (run harvest-apis.js + filter-apis.js first)`);
    process.exit(1);
  }
  const raw = [...readNdjsonRecords(RAW_PATH, { keyFn: rawKey }).values()];
  const filtered = [...readNdjsonRecords(OUT_PATH, { keyFn: (r) => r.id }).values()];
  const { markdown } = buildReport(raw, filtered);
  writeFileSync(out, `# Phase 4.2 — API calibration report\n\n${markdown}\n`);
  console.log(`[report-api-calibration] wrote ${out}`);
}

const invokedAsScript = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (invokedAsScript) main();

/**
 * Build-time SVG chart generators for the ClaudeAtlas homepage.
 *
 * All functions are pure — they take the skills array (and sometimes a date
 * reference point) and return an SVG string. No external dependencies, no
 * client-side rendering.
 *
 * Palette references Tailwind's default colors directly (hex values) since
 * inline SVG doesn't pick up CSS variables without extra work.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

// --- Color palette (aligned with tailwind.config.mjs where possible) ---
const COLORS = {
  text: '#9ca3af',        // gray-400
  axis: '#374151',        // gray-700
  gridline: '#1f2937',    // gray-800
  bar: '#f59e0b',         // amber-500 (matches atlas/Featured accent)
  barHover: '#fbbf24',    // amber-400
  // Maintenance buckets — fresh → stale
  thisWeek: '#10b981',    // emerald-500
  thisMonth: '#22c55e',   // green-500
  quarter: '#eab308',     // yellow-500
  halfYear: '#f59e0b',    // amber-500
  stale: '#6b7280',       // gray-500
};

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isoWeekStart(date) {
  // Return the Monday 00:00 UTC that starts the ISO week containing `date`.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  if (day !== 1) d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.getTime();
}

/**
 * DATA-02: New skills per week over the last 52 weeks.
 *
 * Uses `skill_first_commit_at` when available, falls back to `repo_created_at`.
 * Returns an SVG string.
 */
export function buildNewSkillsWeekChart(skills, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const WEEKS = 52;
  const width = 720;
  const height = 180;
  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  // Build week buckets, oldest → newest
  const thisWeekStart = isoWeekStart(now);
  const buckets = new Array(WEEKS).fill(0).map((_, i) => ({
    start: thisWeekStart - (WEEKS - 1 - i) * MS_PER_WEEK,
    count: 0,
  }));
  const earliest = buckets[0].start;

  for (const skill of skills) {
    // F2: prefer extra.skill_first_commit_at (v2 EntityRecord<SkillExtra>);
    // fall back to top-level skill_first_commit_at (legacy v1 + dual-shape
    // upcaster output during the cutover window).
    const rawDate = skill.extra?.skill_first_commit_at || skill.skill_first_commit_at || skill.repo_created_at;
    if (!rawDate) continue;
    const t = Date.parse(rawDate);
    if (isNaN(t) || t < earliest) continue;
    const weekIdx = Math.floor((t - earliest) / MS_PER_WEEK);
    if (weekIdx >= 0 && weekIdx < WEEKS) {
      buckets[weekIdx].count++;
    }
  }

  const maxCount = Math.max(1, ...buckets.map(b => b.count));
  const barWidth = plotW / WEEKS;

  // Y-axis ticks (0, max/2, max)
  const yTicks = [0, Math.round(maxCount / 2), maxCount];

  let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="New skills per week over the last 52 weeks" class="w-full h-auto">`;
  svg += `<title>New Claude skills per week, last 52 weeks (source: skill_first_commit_at with repo_created_at fallback)</title>`;

  // Y-axis lines + labels
  for (const tick of yTicks) {
    const y = padding.top + plotH - (tick / maxCount) * plotH;
    svg += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="${COLORS.gridline}" stroke-width="1"/>`;
    svg += `<text x="${padding.left - 6}" y="${y + 3}" text-anchor="end" font-size="10" font-family="ui-monospace, monospace" fill="${COLORS.text}">${tick}</text>`;
  }

  // Bars — each rect carries data attrs so client JS can drive a positioned tooltip
  for (let i = 0; i < WEEKS; i++) {
    const b = buckets[i];
    const h = (b.count / maxCount) * plotH;
    const x = padding.left + i * barWidth;
    const y = padding.top + plotH - h;
    const weekStart = new Date(b.start).toISOString().slice(0, 10);
    const weekEnd = new Date(b.start + 6 * MS_PER_DAY).toISOString().slice(0, 10);
    svg += `<rect class="chart-bar" data-tooltip="${b.count} new skill${b.count === 1 ? '' : 's'} · week of ${weekStart} → ${weekEnd}" x="${x + 0.5}" y="${y}" width="${Math.max(0.5, barWidth - 1)}" height="${h}" fill="${COLORS.bar}"><title>${b.count} new in week of ${weekStart}</title></rect>`;
  }

  // X-axis labels: earliest and latest week only
  const firstLabel = new Date(buckets[0].start).toISOString().slice(0, 10);
  const lastLabel = new Date(buckets[WEEKS - 1].start).toISOString().slice(0, 10);
  svg += `<text x="${padding.left}" y="${height - 8}" text-anchor="start" font-size="10" font-family="ui-monospace, monospace" fill="${COLORS.text}">${firstLabel}</text>`;
  svg += `<text x="${width - padding.right}" y="${height - 8}" text-anchor="end" font-size="10" font-family="ui-monospace, monospace" fill="${COLORS.text}">${lastLabel}</text>`;

  // Baseline
  svg += `<line x1="${padding.left}" y1="${padding.top + plotH}" x2="${width - padding.right}" y2="${padding.top + plotH}" stroke="${COLORS.axis}" stroke-width="1"/>`;

  svg += `</svg>`;
  return svg;
}

/**
 * DATA-03: Active maintenance breakdown — stacked horizontal bar.
 *
 * Uses `repo_pushed_at`. Buckets:
 *   - This week:    ≤ 7 days
 *   - This month:   ≤ 30 days
 *   - Last 3 months: ≤ 90 days
 *   - Last 6 months: ≤ 180 days
 *   - Stale:        > 180 days
 */
export function buildMaintenanceChart(skills, opts = {}) {
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();

  const buckets = [
    { key: 'thisWeek', label: 'This week', count: 0, color: COLORS.thisWeek, maxAge: 7 },
    { key: 'thisMonth', label: 'This month', count: 0, color: COLORS.thisMonth, maxAge: 30 },
    { key: 'quarter', label: 'Last 3 months', count: 0, color: COLORS.quarter, maxAge: 90 },
    { key: 'halfYear', label: 'Last 6 months', count: 0, color: COLORS.halfYear, maxAge: 180 },
    { key: 'stale', label: 'Stale (6+ months)', count: 0, color: COLORS.stale, maxAge: Infinity },
  ];

  let total = 0;
  for (const skill of skills) {
    const pushedAt = skill.repo_pushed_at;
    if (!pushedAt) continue;
    const ageDays = (now - Date.parse(pushedAt)) / MS_PER_DAY;
    if (isNaN(ageDays)) continue;
    total++;
    for (const b of buckets) {
      if (ageDays <= b.maxAge) {
        b.count++;
        break;
      }
    }
  }

  if (total === 0) {
    return `<svg viewBox="0 0 720 80" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="No maintenance data"><text x="360" y="44" text-anchor="middle" font-size="14" font-family="ui-monospace, monospace" fill="${COLORS.text}">No maintenance data</text></svg>`;
  }

  const width = 720;
  const height = 110;
  const barY = 20;
  const barHeight = 28;
  const barX = 0;
  const barWidth = width;

  let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Active maintenance breakdown" class="w-full h-auto">`;
  svg += `<title>Active maintenance breakdown — ${total} indexed skills by last repo push</title>`;

  let xCursor = barX;
  for (const b of buckets) {
    const segWidth = (b.count / total) * barWidth;
    if (segWidth > 0) {
      const pct = Math.round((b.count / total) * 100);
      svg += `<rect class="chart-bar" data-tooltip="${escapeXml(b.label)} · ${b.count} skills · ${pct}%" x="${xCursor}" y="${barY}" width="${segWidth}" height="${barHeight}" fill="${b.color}"><title>${escapeXml(b.label)}: ${b.count} (${pct}%)</title></rect>`;
      // Inline percentage label if segment is wide enough
      if (segWidth > 40) {
        svg += `<text x="${xCursor + segWidth / 2}" y="${barY + barHeight / 2 + 4}" text-anchor="middle" font-size="11" font-weight="600" font-family="ui-monospace, monospace" fill="#0a0a0a" pointer-events="none">${pct}%</text>`;
      }
    }
    xCursor += segWidth;
  }

  // Legend row below the bar
  const legendY = barY + barHeight + 18;
  let legendX = 0;
  const legendPad = 12;
  const maxLegendWidth = width / buckets.length;
  for (const b of buckets) {
    const pct = Math.round((b.count / total) * 100);
    svg += `<rect x="${legendX}" y="${legendY - 8}" width="10" height="10" fill="${b.color}"/>`;
    svg += `<text x="${legendX + 14}" y="${legendY + 1}" font-size="10" font-family="ui-sans-serif, system-ui, sans-serif" fill="${COLORS.text}">${escapeXml(b.label)} · ${pct}%</text>`;
    legendX += maxLegendWidth;
  }

  svg += `</svg>`;
  return svg;
}

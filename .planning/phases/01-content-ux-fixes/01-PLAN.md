---
plan: 01
phase: 1
wave: 1
depends_on: []
files_modified:
  - src/lib/skills.js
  - src/pages/index.astro
  - src/pages/methodology.astro
  - src/layouts/BaseLayout.astro
autonomous: true
requirements: [UX-01]
---

# Plan 01: Hero stat — show the real "analyzed" number everywhere

<objective>
Replace every hardcoded "1,078 skills analyzed" (and variants) with a single source of truth pulled from `data/pipeline-stats.json`. Display format wherever the full stat appears: `{total_discovered} analyzed · {total_indexed} indexed · {total_featured} Featured · Updated daily`. Numbers use `toLocaleString()` so they render as "33,000" not "33000".
</objective>

<must_haves>
- Homepage hero shows `{N} analyzed · {M} indexed · {K} Featured · Updated daily` where N/M/K come from `data/pipeline-stats.json`, not from `allSkills.length` alone.
- Footer in `BaseLayout.astro` shows the same three numbers consistent with the hero.
- Methodology page references the three numbers somewhere (in "Discovery" or a new intro line) using the same helper.
- Meta description in `BaseLayout.astro` defaults incorporate the `analyzed` number when rendered on the homepage.
- Zero hardcoded skill counts remain in the templates — grep verifies.
</must_haves>

<tasks>

<task id="01.1">
<action>
Extend `src/lib/skills.js` with a new exported function `getPipelineStats()` that loads `../../data/pipeline-stats.json` and returns an object:

```js
{
  total_discovered: number,     // pipeline-stats.total_discovered (e.g. 33000)
  total_indexed: number,        // pipeline-stats.total_skills or allSkills.length (prefer allSkills.length as authoritative)
  total_featured: number,       // count of allSkills where quality_tier === 'featured'
  updated_at: string,           // pipeline-stats.timestamp
}
```

Implementation:
1. Add at top of `src/lib/skills.js`: `import pipelineStats from '../../data/pipeline-stats.json';`
2. Add exported function `getPipelineStats()`:
   ```js
   export function getPipelineStats() {
     return {
       total_discovered: pipelineStats.total_discovered || allSkills.length,
       total_indexed: allSkills.length,
       total_featured: allSkills.filter(s => s.quality_tier === 'featured').length,
       updated_at: pipelineStats.timestamp || null,
     };
   }
   ```
3. Do NOT remove the existing `getStats()` function — other code paths depend on it.
</action>
<read_first>
- src/lib/skills.js (current state)
- data/pipeline-stats.json (field names: total_discovered, total_skills, timestamp, tiers.featured)
</read_first>
<acceptance_criteria>
- `grep -n "export function getPipelineStats" src/lib/skills.js` returns exactly one match
- `grep -n "pipeline-stats.json" src/lib/skills.js` returns exactly one match
- File still exports `allSkills`, `getStats`, `getFeaturedSkills`, `getAllCategories`, `getSkillBySlug`, `getSkillsByCategory`, `getRelatedSkills`, `getCategorySlug`, `getCategoryFromSlug`, `timeAgo`, `tierColor`, `categoryColor`
- `npm run build` completes without errors
</acceptance_criteria>
</task>

<task id="01.2">
<action>
Update `src/pages/index.astro` to use `getPipelineStats()` for the hero stat line.

1. Import update: change the import from `import { ..., getStats, ... }` to also include `getPipelineStats`:
   ```js
   import { allSkills, getFeaturedSkills, getAllCategories, getStats, getPipelineStats } from '../lib/skills.js';
   ```
2. Add `const pstats = getPipelineStats();` right after `const stats = getStats();`
3. Replace the `<p class="text-sm text-gray-500 mb-8 font-mono">...</p>` line currently showing `{stats.total.toLocaleString()} skills analyzed &middot; {stats.featured} featured &middot; Updated daily` with:
   ```astro
   <p class="text-sm text-gray-500 mb-8 font-mono">
     {pstats.total_discovered.toLocaleString()} analyzed &middot; {pstats.total_indexed.toLocaleString()} indexed &middot; {pstats.total_featured} Featured &middot; Updated daily
   </p>
   ```
4. Do not touch the search input, Featured section, Top Skills section, or category chips. Those are Plan 02's scope.
</action>
<read_first>
- src/pages/index.astro (current state — especially lines 1-14 and 26-28)
- data/pipeline-stats.json (to confirm field values)
</read_first>
<acceptance_criteria>
- `grep -n "getPipelineStats" src/pages/index.astro` returns exactly one match in the import and one match in the `const pstats = ` line (2 total)
- `grep -n "pstats.total_discovered.toLocaleString()" src/pages/index.astro` returns one match
- `grep -n "pstats.total_indexed.toLocaleString()" src/pages/index.astro` returns one match
- `grep -n "pstats.total_featured" src/pages/index.astro` returns one match
- `grep -c "analyzed &middot;" src/pages/index.astro` returns 1
- `grep -c "indexed &middot;" src/pages/index.astro` returns 1
- `grep -c "Featured &middot;" src/pages/index.astro` returns 1
- Old hero line containing `stats.total.toLocaleString() skills analyzed` is removed — grep returns 0 matches
- `npm run build` completes without errors
</acceptance_criteria>
</task>

<task id="01.3">
<action>
Update `src/layouts/BaseLayout.astro`:

1. Change the `getStats` import to `getPipelineStats`:
   Replace `import { getStats } from '../lib/skills.js';`
   With `import { getPipelineStats } from '../lib/skills.js';`
2. Replace `const stats = getStats();` with `const pstats = getPipelineStats();`
3. Update the footer summary string. Find:
   ```astro
   <span class="font-medium text-gray-400">ClaudeAtlas</span> — {stats.total} skills analyzed, {stats.featured} featured
   ```
   Replace with:
   ```astro
   <span class="font-medium text-gray-400">ClaudeAtlas</span> — {pstats.total_discovered.toLocaleString()} analyzed, {pstats.total_indexed.toLocaleString()} indexed, {pstats.total_featured} Featured
   ```
4. Update the default description to reference the real scale. Replace:
   ```
   description = 'Discover the best agent skills — curated, scored, and auto-updated daily.'
   ```
   With:
   ```
   description = `Discover the best Claude skills — ${pstats.total_discovered.toLocaleString()} analyzed, ${pstats.total_indexed.toLocaleString()} indexed, ${pstats.total_featured} Featured. Auto-updated daily.`
   ```
   Note the change from single-quote to backtick for string interpolation. The destructuring of `Astro.props` must come AFTER the `const pstats = getPipelineStats();` line so that `pstats` is in scope for the default parameter. Rewrite the frontmatter so the order is:
   ```js
   import { getPipelineStats } from '../lib/skills.js';
   const pstats = getPipelineStats();
   const defaultDescription = `Discover the best Claude skills — ${pstats.total_discovered.toLocaleString()} analyzed, ${pstats.total_indexed.toLocaleString()} indexed, ${pstats.total_featured} Featured. Auto-updated daily.`;
   const { title = 'ClaudeAtlas', description = defaultDescription } = Astro.props;
   const fullTitle = title === 'ClaudeAtlas' ? title : `${title} | ClaudeAtlas`;
   ```
</action>
<read_first>
- src/layouts/BaseLayout.astro (current state, especially the frontmatter at lines 1-7 and the footer at lines 54-65)
- src/lib/skills.js (after task 01.1 — to confirm getPipelineStats export exists)
</read_first>
<acceptance_criteria>
- `grep -n "getPipelineStats" src/layouts/BaseLayout.astro` returns exactly one match (the import)
- `grep -n "getStats" src/layouts/BaseLayout.astro` returns 0 matches — the old import is fully removed
- `grep -n "pstats.total_discovered.toLocaleString()" src/layouts/BaseLayout.astro` returns at least 2 matches (default description + footer)
- `grep -n "pstats.total_featured" src/layouts/BaseLayout.astro` returns at least 2 matches
- `grep -n "const pstats = getPipelineStats" src/layouts/BaseLayout.astro` returns one match, on a line BEFORE the `const { title` destructure
- `grep -c "skills analyzed, " src/layouts/BaseLayout.astro` returns 0 (old footer string removed)
- `npm run build` completes without errors
</acceptance_criteria>
</task>

<task id="01.4">
<action>
Update `src/pages/methodology.astro` to reference the real scale in the Discovery section.

1. Add import and const at the top of the frontmatter:
   ```js
   import BaseLayout from '../layouts/BaseLayout.astro';
   import { getPipelineStats } from '../lib/skills.js';
   const pstats = getPipelineStats();
   ```
2. In the Discovery `<section>` (currently lines 11-16), replace its `<p>` with a version that embeds the numbers:
   ```astro
   <p class="text-gray-300 leading-relaxed">
     ClaudeAtlas automatically discovers skills by scanning GitHub for <code class="text-atlas-400 bg-gray-800 px-1 rounded">SKILL.md</code> files using the GitHub Code Search API. We use size-range partitioning to exceed the API's 1,000-result cap, supplemented by GitHub Topics search and known skill repositories. The scraper runs daily via GitHub Actions and has discovered <strong class="text-white">{pstats.total_discovered.toLocaleString()}</strong> skill files so far — of which <strong class="text-white">{pstats.total_indexed.toLocaleString()}</strong> pass our filters and are indexed, with <strong class="text-white">{pstats.total_featured}</strong> earning the Featured tier.
   </p>
   ```
3. Do not touch any other section on the methodology page.
</action>
<read_first>
- src/pages/methodology.astro (current state)
- src/lib/skills.js (confirm getPipelineStats available)
</read_first>
<acceptance_criteria>
- `grep -n "getPipelineStats" src/pages/methodology.astro` returns exactly one match (import) + one match (const) = 2
- `grep -n "pstats.total_discovered.toLocaleString()" src/pages/methodology.astro` returns one match
- `grep -n "pstats.total_indexed.toLocaleString()" src/pages/methodology.astro` returns one match
- `grep -n "pstats.total_featured" src/pages/methodology.astro` returns one match
- The string "scraper runs daily via GitHub Actions" still appears in the file (context preserved)
- `npm run build` completes without errors
</acceptance_criteria>
</task>

</tasks>

<verification>
After all tasks complete:
1. `npm run build` exits 0
2. `grep -r "skills analyzed" src/ | grep -v "analyzed · "` returns nothing (old phrasing gone, new phrasing remains)
3. `grep -r "hardcoded" src/ || true` — no TODO comments left behind
4. Build output includes the real `total_discovered` number in the rendered `dist/index.html` — verify with `grep "analyzed" dist/index.html` after build
</verification>

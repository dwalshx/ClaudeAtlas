---
plan: 02
phase: 1
wave: 2
depends_on: [01]
files_modified:
  - src/pages/index.astro
autonomous: true
requirements: [UX-02, UX-03, UX-04]
---

# Plan 02: Search rebuild — sticky header, expand to all, Featured searchable

<objective>
Rebuild the homepage search UX so that:
1. Search input is pinned to the top of the page content as a sticky bar (below the existing nav)
2. Typing any value hides the Featured Skills section and expands the results grid to include ALL indexed skills (not just the top 60)
3. Featured skills are part of the filterable dataset so every indexed skill is reachable via search
4. Clear-search button appears when the input has a value
</objective>

<must_haves>
- Sticky search bar below the main nav — visible at all times while scrolling the homepage
- On empty input: page renders as before (hero + Featured + top 60 top skills)
- On non-empty input: Featured section hidden, grid shows ALL matching skills from `allSkills` (not just the top-60 subset)
- Featured skills are discoverable via search by name, description, or category
- Clear-search (X) button visible when input has value; clicking it empties the input and restores empty-state view
- No regressions to category chips, nav, footer, or hero layout from Plan 01
- Keeps the substring match behavior — no Pagefind, no fuzzy matching
</must_haves>

<tasks>

<task id="02.1">
<action>
Rewrite the homepage frontmatter and Top Skills section in `src/pages/index.astro` to pass ALL skills into the rendered grid (with a separate flag marking which are in the Featured set), and to hide the Featured section based on search state.

1. Frontmatter — change the top section to:
   ```js
   ---
   import BaseLayout from '../layouts/BaseLayout.astro';
   import SkillCard from '../components/SkillCard.astro';
   import CategoryChip from '../components/CategoryChip.astro';
   import { allSkills, getFeaturedSkills, getAllCategories, getStats, getPipelineStats } from '../lib/skills.js';

   const stats = getStats();
   const pstats = getPipelineStats();
   const featured = getFeaturedSkills(6);
   const categories = getAllCategories();

   // Sort the full catalog by quality_score descending.
   // On the homepage we render ALL skills into the DOM but mark which are in the
   // initial "top 60" visible set. Search expands visibility to the full list.
   const HOMEPAGE_LIMIT = 60;
   const allSorted = [...allSkills].sort((a, b) => b.quality_score - a.quality_score);
   const topSkills = allSorted.slice(0, HOMEPAGE_LIMIT);
   const extraSkills = allSorted.slice(HOMEPAGE_LIMIT);
   ---
   ```
2. Keep the hero section (from Plan 01) unchanged.
3. Wrap the Featured Skills section in `<section id="featured-section">` — the client-side script will toggle its display based on search state.
4. Replace the Top Skills grid block with one that renders ALL skills but with two groups. Use `data-default-visible="true"` on the top 60 and `data-default-visible="false"` on the remainder. The remainder must be hidden by default via inline style `style="display: none;"` so they only show when a search is active.

Replacement section (starts at line 72 of current file, the `<!-- Top Skills -->` comment):

```astro
  <!-- Top Skills / Full Catalog -->
  <section class="px-4 pb-16">
    <div class="max-w-6xl mx-auto">
      <div class="flex items-end justify-between mb-6">
        <h2 id="skills-heading" class="text-xl font-semibold text-white flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-atlas-500"></span>
          <span id="skills-heading-text">Top Skills</span>
        </h2>
        <span id="skills-count" class="text-sm text-gray-500">Showing top {HOMEPAGE_LIMIT} of {pstats.total_indexed.toLocaleString()}</span>
      </div>
      <div id="skills-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {topSkills.map(skill => (
          <div class="skill-item" data-default-visible="true" data-name={skill.name.toLowerCase()} data-desc={(skill.description || '').toLowerCase()} data-cat={skill.category.toLowerCase()} data-tier={skill.quality_tier}>
            <SkillCard skill={skill} />
          </div>
        ))}
        {extraSkills.map(skill => (
          <div class="skill-item" data-default-visible="false" style="display: none;" data-name={skill.name.toLowerCase()} data-desc={(skill.description || '').toLowerCase()} data-cat={skill.category.toLowerCase()} data-tier={skill.quality_tier}>
            <SkillCard skill={skill} />
          </div>
        ))}
      </div>
      <div id="no-results" class="hidden text-center py-12 text-gray-500">
        No skills match your search. Try different keywords or <a href="/category/ai-and-automation/" class="text-atlas-400 hover:underline">browse by category</a>.
      </div>
      <div id="browse-more" class="text-center mt-10">
        <p class="text-gray-500 text-sm mb-4">Want to explore more?</p>
        <div class="flex flex-wrap justify-center gap-2">
          {categories.map(cat => (
            <CategoryChip category={cat.name} count={cat.count} />
          ))}
        </div>
      </div>
    </div>
  </section>
```
</action>
<read_first>
- src/pages/index.astro (post Plan 01 state)
- src/components/SkillCard.astro (ensure SkillCard handles both Featured and non-Featured skills; no changes needed)
</read_first>
<acceptance_criteria>
- `grep -n "const allSorted" src/pages/index.astro` returns one match
- `grep -n "const topSkills = allSorted.slice(0, HOMEPAGE_LIMIT)" src/pages/index.astro` returns one match
- `grep -n "const extraSkills = allSorted.slice(HOMEPAGE_LIMIT)" src/pages/index.astro` returns one match
- `grep -c 'data-default-visible="true"' src/pages/index.astro` returns 1 (the top 60 map)
- `grep -c 'data-default-visible="false"' src/pages/index.astro` returns 1 (the extras map)
- `grep -n 'id="featured-section"' src/pages/index.astro` returns one match
- `grep -n 'id="skills-heading-text"' src/pages/index.astro` returns one match
- `grep -n 'id="skills-count"' src/pages/index.astro` returns one match
- `grep -n 'id="browse-more"' src/pages/index.astro` returns one match
- `npm run build` completes without errors
</acceptance_criteria>
</task>

<task id="02.2">
<action>
Wrap the Featured Skills section with `id="featured-section"` so the client script can toggle its display. Find the existing block:

```astro
  <!-- Featured Skills -->
  {featured.length > 0 && (
    <section class="px-4 pb-12">
```

Replace the `<section class="px-4 pb-12">` line with:

```astro
    <section id="featured-section" class="px-4 pb-12">
```

Keep everything else in that section identical.
</action>
<read_first>
- src/pages/index.astro (after task 02.1)
</read_first>
<acceptance_criteria>
- `grep -n 'id="featured-section"' src/pages/index.astro` returns one match
- `grep -c '<!-- Featured Skills -->' src/pages/index.astro` returns 1 (comment preserved)
- `grep -n "featured.length > 0" src/pages/index.astro` returns one match (still gated)
</acceptance_criteria>
</task>

<task id="02.3">
<action>
Replace the existing sticky-header placement and search input wiring. The search needs to move OUT of the hero block and into a standalone sticky bar that sits right below the site nav. The sticky bar will be above the hero. The existing search input inside the hero is removed.

Location: modify `src/pages/index.astro`. Between the `<BaseLayout>` opening tag and the `<!-- Hero -->` comment, insert a sticky search bar. Remove the old search block from inside the hero (the `<div class="max-w-xl mx-auto mb-10">...</div>` wrapper currently at homepage lines 31-44).

Insert this at the top of the `<BaseLayout>` content:

```astro
<BaseLayout>
  <!-- Sticky Search Bar -->
  <div id="search-bar" class="sticky top-[57px] z-40 bg-gray-950/90 backdrop-blur border-b border-gray-800 px-4 py-3">
    <div class="max-w-3xl mx-auto relative">
      <svg class="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.35-4.35"/>
      </svg>
      <input
        type="text"
        id="skill-search"
        placeholder="Search 1,000+ Claude skills..."
        autocomplete="off"
        class="w-full pl-12 pr-12 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-atlas-500 focus:border-transparent text-base"
      />
      <button
        id="search-clear"
        type="button"
        aria-label="Clear search"
        class="hidden absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full text-gray-400 hover:text-white hover:bg-gray-800 flex items-center justify-center"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- Hero -->
```

Then delete the old `<!-- Search -->` block from inside the hero. Find and remove:

```astro
      <!-- Search -->
      <div class="max-w-xl mx-auto mb-10">
        <div class="relative">
          <svg class="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="text"
            id="skill-search"
            placeholder="Search skills... (e.g. testing, docker, api)"
            class="w-full pl-12 pr-4 py-3.5 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-atlas-500 focus:border-transparent text-base"
          />
        </div>
      </div>
```

The hero should now contain only the `<h1>`, the two descriptive `<p>` tags (including the Plan 01 stat line), and the category chips.

Note: `top-[57px]` corresponds to the current nav height (~56-57px — one line with py-3 padding and text-lg). If the nav changes, this value needs updating, but for now it places the search bar directly under the nav.
</action>
<read_first>
- src/pages/index.astro (after tasks 02.1 + 02.2)
- src/layouts/BaseLayout.astro (to verify nav height for the sticky offset)
</read_first>
<acceptance_criteria>
- `grep -n 'id="search-bar"' src/pages/index.astro` returns one match
- `grep -n 'id="search-clear"' src/pages/index.astro` returns one match
- `grep -n 'id="skill-search"' src/pages/index.astro` returns exactly one match (old input removed, only new one remains)
- `grep -c 'sticky top-\[57px\]' src/pages/index.astro` returns 1
- `grep -c '<!-- Search -->' src/pages/index.astro` returns 0 (old search comment block fully removed)
- `grep -n 'Search skills... (e.g. testing, docker, api)' src/pages/index.astro` returns 0 (old placeholder removed)
- `grep -n 'Search 1,000+ Claude skills' src/pages/index.astro` returns 1 (new placeholder)
- `npm run build` completes without errors
</acceptance_criteria>
</task>

<task id="02.4">
<action>
Replace the existing `<script>` block at the bottom of `src/pages/index.astro` with one that:

1. Filters all `.skill-item` elements (both default-visible and default-hidden sets)
2. Toggles the Featured section visibility based on whether there's a search query
3. Toggles the browse-more / category chip footer based on search state
4. Updates the heading text and result count based on search state
5. Shows/hides the clear button
6. Clicking the clear button empties the input and restores empty-state view

Replace the current `<script>` at the bottom of the file with:

```astro
<script>
  const searchInput = document.getElementById('skill-search') as HTMLInputElement | null;
  const searchClear = document.getElementById('search-clear') as HTMLButtonElement | null;
  const featuredSection = document.getElementById('featured-section');
  const browseMore = document.getElementById('browse-more');
  const skillsHeadingText = document.getElementById('skills-heading-text');
  const skillsCount = document.getElementById('skills-count');
  const noResults = document.getElementById('no-results');
  const skillItems = document.querySelectorAll<HTMLElement>('.skill-item');

  const totalIndexed = skillItems.length;
  const defaultTopCount = Array.from(skillItems).filter(el => el.dataset.defaultVisible === 'true').length;
  const initialCountText = skillsCount?.textContent || '';

  function applyFilter(rawQuery: string) {
    const query = rawQuery.toLowerCase().trim();
    const isSearching = query.length > 0;

    // Toggle clear button
    if (searchClear) {
      searchClear.classList.toggle('hidden', !isSearching);
    }

    // Toggle Featured section (hide when searching)
    if (featuredSection) {
      featuredSection.style.display = isSearching ? 'none' : '';
    }

    // Toggle browse-more footer (hide when searching)
    if (browseMore) {
      browseMore.style.display = isSearching ? 'none' : '';
    }

    // Update heading text
    if (skillsHeadingText) {
      skillsHeadingText.textContent = isSearching ? 'Search Results' : 'Top Skills';
    }

    let visible = 0;
    skillItems.forEach(el => {
      const name = el.dataset.name || '';
      const desc = el.dataset.desc || '';
      const cat = el.dataset.cat || '';

      if (!isSearching) {
        // Empty-state: show only the default top-60
        const shouldShow = el.dataset.defaultVisible === 'true';
        el.style.display = shouldShow ? '' : 'none';
        if (shouldShow) visible++;
        return;
      }

      const matches = name.includes(query) || desc.includes(query) || cat.includes(query);
      el.style.display = matches ? '' : 'none';
      if (matches) visible++;
    });

    // Update count label
    if (skillsCount) {
      if (!isSearching) {
        skillsCount.textContent = initialCountText;
      } else {
        skillsCount.textContent = `${visible} result${visible === 1 ? '' : 's'} of ${totalIndexed.toLocaleString()}`;
      }
    }

    // No-results message
    if (noResults) {
      noResults.classList.toggle('hidden', visible > 0 || !isSearching);
    }
  }

  searchInput?.addEventListener('input', (e) => {
    applyFilter((e.target as HTMLInputElement).value);
  });

  searchClear?.addEventListener('click', () => {
    if (searchInput) {
      searchInput.value = '';
      applyFilter('');
      searchInput.focus();
    }
  });

  // Initialize state on page load
  applyFilter('');
</script>
```
</action>
<read_first>
- src/pages/index.astro (after tasks 02.1 / 02.2 / 02.3)
</read_first>
<acceptance_criteria>
- `grep -n "function applyFilter" src/pages/index.astro` returns one match
- `grep -n "featuredSection" src/pages/index.astro` returns at least 2 matches (declaration + style toggle)
- `grep -n "skillsHeadingText" src/pages/index.astro` returns at least 2 matches
- `grep -n "searchClear" src/pages/index.astro` returns at least 3 matches
- `grep -n "Search Results" src/pages/index.astro` returns one match
- `grep -n "dataset.defaultVisible" src/pages/index.astro` returns at least 1 match
- `grep -c "skillItems.forEach" src/pages/index.astro` returns 1
- Old script block pattern `const query = (e.target as HTMLInputElement).value.toLowerCase().trim();` appears only inside the new applyFilter-powered input listener, NOT as an old duplicate
- `npm run build` completes without errors
</acceptance_criteria>
</task>

</tasks>

<verification>
After all tasks complete:
1. `npm run build` exits 0
2. `grep -c 'id="skill-search"' src/pages/index.astro` returns exactly 1 (no duplicate search input)
3. `grep -c 'id="featured-section"' src/pages/index.astro` returns exactly 1
4. `grep -c "applyFilter" src/pages/index.astro` returns ≥ 4 (definition, two listeners, initial call)
5. Visual smoke test when dev server runs: homepage shows hero + Featured + top 60 by default; typing "testing" hides Featured and shows all matching skills including Featured ones.
</verification>

// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import { loadAllSkillsSync } from './scripts/lib/skills-stream.js';
import { resolveSkillsNdjsonPath } from './scripts/lib/build-input.js';

// T5 (DOD-10 / Rev 2 B1/B2): Tier-aware rendering means only Top+Solid
// slugs get a static HTML file in dist/. Without customPages,
// `@astrojs/sitemap` only enumerates pages that exist in dist/ — Listed
// slugs (served at request time by worker/index.js via SKILLS_KV) would
// silently vanish from sitemap.xml. Search engines stop indexing them
// within a few weeks; existing rankings erode silently. Exactly the
// "no immediate user-facing breakage; traffic erodes over weeks" failure
// pattern the 3.0.x lessons warned about.
//
// Fix: enumerate every skill slug (regardless of tier) via customPages
// from the same NDJSON source-of-truth the rest of the build reads.
// scripts/check-sitemap-completeness.js (postbuild) asserts
// `<loc>` count ≈ skill count ± 25 (margin for static pages).
const skillSlugs = (() => {
  try {
    return loadAllSkillsSync(resolveSkillsNdjsonPath())
      .map((s) => `https://claudeatlas.com/skills/${s.slug}/`);
  } catch (err) {
    // First-run / cold-start cases: filter hasn't generated skills.ndjson
    // yet. Sitemap falls back to whatever Astro auto-discovers in dist/.
    // postbuild check-sitemap-completeness will fail loudly if this
    // empty-customPages path causes a regression.
    console.warn(`[astro.config] customPages: ${err.message}; using auto-discovered pages only`);
    return [];
  }
})();

export default defineConfig({
  site: 'https://claudeatlas.com',
  output: 'static',
  integrations: [
    tailwind(),
    sitemap({
      customPages: skillSlugs,
    }),
  ],
  build: {
    format: 'directory',
  },
});

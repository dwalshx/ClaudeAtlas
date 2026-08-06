/**
 * worker/markdown.test.js — Accept-header negotiation + markdown renderers
 * (quick-260806-ejd, E2).
 *
 * markdown.js is a pure ESM module (zero imports, zero I/O) so these tests
 * run under plain `node --test`. NEVER import worker/index.js here — it uses
 * native JSON imports that esbuild handles but plain Node cannot; its wiring
 * is verified by grep instead (Wave 1 convention).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  prefersMarkdown,
  renderSkillMarkdown,
  renderSiteIndexMarkdown,
} from './markdown.js';

// ---------------------------------------------------------------------------
// prefersMarkdown
// ---------------------------------------------------------------------------

test('prefersMarkdown: bare text/markdown → true', () => {
  assert.equal(prefersMarkdown('text/markdown'), true);
});

test('prefersMarkdown: markdown q=0.9 beats html q=0.8 → true', () => {
  assert.equal(prefersMarkdown('text/markdown;q=0.9,text/html;q=0.8'), true);
});

test('prefersMarkdown: html q=1.0 beats markdown q=0.5 → false', () => {
  assert.equal(prefersMarkdown('text/html,text/markdown;q=0.5'), false);
});

test('prefersMarkdown: Chrome default Accept (wildcard only) → false', () => {
  // NO explicit text/markdown range — */* must NOT count as markdown
  // preference (Googlebot/browsers send this; SEO unaffected).
  assert.equal(
    prefersMarkdown(
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
    ),
    false
  );
});

test('prefersMarkdown: text/* wildcard does not count as markdown', () => {
  assert.equal(prefersMarkdown('text/*'), false);
});

test('prefersMarkdown: text/markdown;q=0 → false', () => {
  assert.equal(prefersMarkdown('text/markdown;q=0'), false);
});

test('prefersMarkdown: null/undefined/empty → false', () => {
  assert.equal(prefersMarkdown(null), false);
  assert.equal(prefersMarkdown(undefined), false);
  assert.equal(prefersMarkdown(''), false);
});

test('prefersMarkdown: garbage header never throws → false', () => {
  assert.equal(prefersMarkdown(';;;=,,q=;;garbage//'), false);
  assert.equal(prefersMarkdown('text/markdown;q=notanumber'), true); // malformed q → default 1.0
  assert.equal(prefersMarkdown(12345), false); // non-string input
});

test('prefersMarkdown: markdown equal q to html → true (tie goes to markdown)', () => {
  assert.equal(prefersMarkdown('text/html;q=0.8,text/markdown;q=0.8'), true);
});

// ---------------------------------------------------------------------------
// renderSkillMarkdown
// ---------------------------------------------------------------------------

const FULL_RECORD = {
  slug: 'acme/widget-skill',
  name: 'widget-skill',
  description: 'Builds widgets from thin air.',
  repo_full_name: 'acme/skills',
  repo_url: 'https://github.com/acme/skills',
  quality_tier: 'featured',
  quality_score: 97,
  repo_stars: 4321,
  category: 'Code & Development',
  extra: { body_markdown: 'EXTRA-BODY: how to build widgets.' },
  body_markdown: 'LEGACY-BODY: should not win when extra exists.',
};

test('renderSkillMarkdown: contains heading, description, tier/score, repo link, install cmd, category, body from extra', () => {
  const md = renderSkillMarkdown(FULL_RECORD);
  assert.ok(md.includes('# widget-skill'), 'name as # heading');
  assert.ok(md.includes('Builds widgets from thin air.'), 'description');
  assert.ok(/featured/i.test(md), 'quality tier');
  assert.ok(md.includes('97'), 'quality score');
  assert.ok(md.includes('https://github.com/acme/skills'), 'repo_url link');
  assert.ok(md.includes('claude install-skill acme/skills'), 'install command');
  assert.ok(md.includes('Code & Development'), 'category');
  assert.ok(md.includes('EXTRA-BODY: how to build widgets.'), 'extra.body_markdown wins');
  assert.ok(!md.includes('LEGACY-BODY'), 'legacy body must not appear when extra exists');
});

test('renderSkillMarkdown: legacy body_markdown fallback when extra absent', () => {
  const md = renderSkillMarkdown({ ...FULL_RECORD, extra: undefined });
  assert.ok(md.includes('LEGACY-BODY: should not win when extra exists.'));
});

test('renderSkillMarkdown: contains E3 preamble (/agent/index.json + X-ClaudeAtlas-Agent) and Source citation line', () => {
  const md = renderSkillMarkdown(FULL_RECORD);
  assert.ok(md.includes('/agent/index.json'), 'preamble mentions /agent/index.json');
  assert.ok(md.includes('X-ClaudeAtlas-Agent'), 'preamble mentions the echo header');
  assert.ok(
    md.includes('Source: ClaudeAtlas — https://claudeatlas.com'),
    'citation footer line'
  );
});

test('renderSkillMarkdown: record with missing/null fields renders without throwing', () => {
  assert.doesNotThrow(() => renderSkillMarkdown({}));
  assert.doesNotThrow(() =>
    renderSkillMarkdown({
      slug: null,
      name: null,
      description: null,
      repo_full_name: null,
      repo_url: null,
      quality_tier: null,
      quality_score: null,
      repo_stars: null,
      category: null,
      extra: null,
      body_markdown: null,
    })
  );
  const md = renderSkillMarkdown({});
  assert.equal(typeof md, 'string');
  assert.ok(md.length > 0);
});

// ---------------------------------------------------------------------------
// renderSiteIndexMarkdown
// ---------------------------------------------------------------------------

test('renderSiteIndexMarkdown: small index listing all structured endpoints', () => {
  const md = renderSiteIndexMarkdown();
  assert.ok(md.length < 2048, `site index must stay under 2 KB (got ${md.length})`);
  assert.ok(md.includes('/api/v1/search'), 'search API');
  assert.ok(md.includes('/skills-registry.json'), 'registry');
  assert.ok(md.includes('/llms.txt'), 'llms.txt');
  assert.ok(md.includes('/agent/index.json'), 'agent index');
  assert.ok(md.includes('whats-new'), 'feeds');
  assert.ok(md.includes('Accept: text/markdown'), 'markdown negotiation affordance');
  assert.ok(md.includes('X-ClaudeAtlas-Agent'), 'echo-header instruction pointer');
});

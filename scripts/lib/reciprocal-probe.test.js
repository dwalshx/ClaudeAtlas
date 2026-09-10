import { test } from 'node:test';
import assert from 'node:assert';
import {
  AGENT_UA,
  AGENT_TOKEN,
  BROWSER_UA,
  WELL_KNOWN_PATHS,
  AI_BOT_NAMES,
  POLICY,
  parseRobots,
  selectGroup,
  isAllowed,
  analyzeRobots,
  classifyResponse,
  summarizeResponse,
  analyzeHtml,
  cloakingDiff,
  checkWellKnownBody,
  isMarkdownNegotiated,
  aggregate,
  renderReport,
} from './reciprocal-probe.js';

// ---------------------------------------------------------------------------
// Inline fixtures — no files, no network.
// ---------------------------------------------------------------------------

// Verbatim copy of public/robots.txt (8 groups, 1 sitemap, 1 Content-Signal).
const OUR_ROBOTS = `# ClaudeAtlas — robots.txt
#
# ClaudeAtlas is a discovery index for AI agent skills. We explicitly welcome
# AI agent crawlers and provide structured endpoints so they don't need to
# parse HTML. See /llms.txt for structured API documentation.
#
# Content signals (Cloudflare AI Content Signals spec):
#   ai-input=yes   — agents may use our data for real-time queries/RAG
#   ai-train=no    — do not use our content corpus to train foundation models
#   search=yes     — search engine indexing is welcome

User-agent: *
Content-Signal: search=yes,ai-input=yes,ai-train=no
Allow: /

# Explicitly welcome AI agent crawlers (overrides any Cloudflare managed blocks).
# Note: if Cloudflare's "AI Content Signals" managed setting is enabled on the
# zone, it will prepend Disallow rules for these bots. Toggle that setting to
# "Allow" in the CF dashboard to let this robots.txt take effect.
#
# Preferred: use our structured endpoints instead of crawling HTML.
# See: https://claudeatlas.com/llms.txt

User-agent: ClaudeBot
Allow: /

User-agent: GPTBot
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Amazonbot
Allow: /

User-agent: CCBot
Allow: /

User-agent: meta-externalagent
Allow: /

Sitemap: https://claudeatlas.com/sitemap-index.xml
`;

const AI_MIXED_ROBOTS = `User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: CCBot
Allow: /

User-agent: *
Allow: /
`;

function target(overrides = {}) {
  const wk = {};
  for (const { path } of WELL_KNOWN_PATHS) {
    wk[path] = { result: 'blocked', status: 404, content_type: 'text/html', bytes: 100, plausible: false };
  }
  return {
    domain: 'example.com',
    operator: 'Example',
    tier: 'named-operator',
    source: 'test',
    note: '',
    robots: {
      present: true, status: 200, policy: 'parsed', groups_count: 1, sitemap_count: 1,
      content_signal: null, ai_bots_named: ['GPTBot'], ai_bots_disallowed_all: [],
      disallows_all_bots: false, disallows_us: false, mentions_claudeatlasbot: false,
    },
    homepage: { result: 'allowed', status: 200, server: 'nginx', bytes: 50000, jsonld_count: 0, has_schema_org: false },
    markdown: { result: 'allowed', status: 200, content_type: 'text/html', negotiated: false, bytes: 50000 },
    browser: { result: 'allowed', status: 200, bytes: 52000 },
    cloaking: { differs: false, status_differs: false, size_ratio: 0.962, reason: null },
    well_known: wk,
    toll: false,
    signs_requests: false,
    requests_made: 10,
    duration_ms: 30000,
    ...overrides,
  };
}

function controlTarget(llmsOk = true) {
  const t = target({
    domain: 'claudeatlas.com', operator: 'ClaudeAtlas', tier: 'control',
    homepage: { result: 'allowed', status: 200, server: 'cloudflare', bytes: 80000, jsonld_count: 1, has_schema_org: true },
    markdown: { result: 'allowed', status: 200, content_type: 'text/markdown; charset=utf-8', negotiated: true, bytes: 12000 },
  });
  t.well_known['/llms.txt'] = llmsOk
    ? { result: 'allowed', status: 200, content_type: 'text/plain', bytes: 3000, plausible: true }
    : { result: 'blocked', status: 404, content_type: 'text/html', bytes: 100, plausible: false };
  return t;
}

function fourTargets(controlLlmsOk = true) {
  return [
    controlTarget(controlLlmsOk),
    target({ domain: 'blocked.example', tier: 'named-operator',
      homepage: { result: 'blocked', status: 403, server: 'AkamaiGHost', bytes: 1200, jsonld_count: 0, has_schema_org: false },
      markdown: { result: 'blocked', status: 403, content_type: 'text/html', negotiated: false, bytes: 1200 },
      browser: { result: 'allowed', status: 200, bytes: 90000 },
      cloaking: { differs: true, status_differs: true, size_ratio: 0.013, reason: 'status' } }),
    target({ domain: 'challenged.example', tier: 'infrastructure',
      homepage: { result: 'challenged', status: 403, server: 'cloudflare', bytes: 7000, jsonld_count: 0, has_schema_org: false },
      markdown: { result: 'challenged', status: 403, content_type: 'text/html', negotiated: false, bytes: 7000 },
      toll: true }),
    target({ domain: 'down.example', tier: 'seed',
      homepage: { result: 'error', status: null, server: null, bytes: null, jsonld_count: 0, has_schema_org: false },
      markdown: { result: 'error', status: null, content_type: null, negotiated: false, bytes: null },
      browser: { result: 'error', status: null, bytes: null },
      cloaking: { differs: false, status_differs: false, size_ratio: null, reason: 'insufficient' } }),
  ];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test('constants: UA strings, token, probe set, policy', () => {
  assert.equal(AGENT_UA, 'ClaudeAtlasBot/1.0 (+https://claudeatlas.com/bot)');
  assert.equal(AGENT_TOKEN, 'ClaudeAtlasBot');
  assert.ok(BROWSER_UA.startsWith('Mozilla/5.0'));
  assert.equal(WELL_KNOWN_PATHS.length, 6);
  assert.equal(WELL_KNOWN_PATHS[0].path, '/llms.txt');
  assert.ok(WELL_KNOWN_PATHS.some((p) => p.path === '/.well-known/http-message-signatures-directory'));
  assert.ok(AI_BOT_NAMES.includes('GPTBot') && AI_BOT_NAMES.includes('ClaudeBot'));
  assert.equal(POLICY.min_host_spacing_ms, 3000);
  assert.equal(POLICY.concurrency, 3);
  assert.equal(POLICY.timeout_ms, 15000);
  assert.equal(POLICY.max_redirects, 5);
  assert.equal(POLICY.method, 'GET');
});

// ---------------------------------------------------------------------------
// parseRobots
// ---------------------------------------------------------------------------

test('parseRobots: our own robots.txt → 8 groups, 1 sitemap, content-signal, * allows /', () => {
  const r = parseRobots(OUR_ROBOTS);
  assert.equal(r.groups.length, 8);
  assert.equal(r.sitemaps.length, 1);
  assert.equal(r.sitemaps[0], 'https://claudeatlas.com/sitemap-index.xml');
  assert.equal(r.content_signal, 'search=yes,ai-input=yes,ai-train=no');
  const star = r.groups.find((g) => g.agents.includes('*'));
  assert.deepEqual(star.allow, ['/']);
  assert.deepEqual(star.disallow, []);
});

test('parseRobots: CRLF, comments, mixed-case directives, consecutive User-agent lines share a group', () => {
  const text = 'user-AGENT: Foo\r\nUSER-agent: Bar # two agents, one group\r\nDISALLOW: /private # trailing comment\r\nallow: /private/ok\r\n\r\nUser-Agent: Baz\r\nDisallow:\r\n';
  const r = parseRobots(text);
  assert.equal(r.groups.length, 2);
  assert.deepEqual(r.groups[0].agents, ['Foo', 'Bar']);
  assert.deepEqual(r.groups[0].disallow, ['/private']);
  assert.deepEqual(r.groups[0].allow, ['/private/ok']);
  assert.deepEqual(r.groups[1].agents, ['Baz']);
  assert.deepEqual(r.groups[1].disallow, []); // empty Disallow: = allow all
});

test('parseRobots: defensive on null/undefined/non-string', () => {
  for (const v of [null, undefined, 42, {}]) {
    const r = parseRobots(v);
    assert.deepEqual(r, { groups: [], sitemaps: [], content_signal: null });
  }
});

// ---------------------------------------------------------------------------
// selectGroup / isAllowed
// ---------------------------------------------------------------------------

test('selectGroup: specific ClaudeAtlasBot group beats *, case-insensitive; * fallback; neither → null', () => {
  const both = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: claudeatlasbot\nAllow: /\n');
  const g = selectGroup(both);
  assert.deepEqual(g.agents, ['claudeatlasbot']);
  const starOnly = parseRobots('User-agent: *\nDisallow: /x\n');
  assert.deepEqual(selectGroup(starOnly).agents, ['*']);
  const neither = parseRobots('User-agent: GPTBot\nDisallow: /\n');
  assert.equal(selectGroup(neither), null);
  assert.equal(selectGroup(null), null);
});

test('isAllowed: longest-match with Allow winning ties; empty Disallow; no group → true', () => {
  const r = parseRobots('User-agent: *\nDisallow: /\nAllow: /public\n');
  assert.equal(isAllowed(r, '/'), false);
  assert.equal(isAllowed(r, '/public/x'), true);
  assert.equal(isAllowed(r, '/private'), false);
  const empty = parseRobots('User-agent: *\nDisallow:\n');
  assert.equal(isAllowed(empty, '/anything'), true);
  const none = parseRobots('User-agent: GPTBot\nDisallow: /\n');
  assert.equal(isAllowed(none, '/'), true);
  assert.equal(isAllowed(null, '/'), true);
  // Same-length allow/disallow → allow wins.
  const tie = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a\n');
  assert.equal(isAllowed(tie, '/a/b'), true);
});

test('isAllowed: * wildcard and $ end anchor handled', () => {
  const r = parseRobots('User-agent: *\nDisallow: /*.json$\nDisallow: /tmp*\n');
  assert.equal(isAllowed(r, '/data/x.json'), false);
  assert.equal(isAllowed(r, '/data/x.json?v=1'), true); // $ anchors end
  assert.equal(isAllowed(r, '/tmpfiles/a'), false);
  assert.equal(isAllowed(r, '/llms.txt'), true);
});

// ---------------------------------------------------------------------------
// analyzeRobots
// ---------------------------------------------------------------------------

test('analyzeRobots: 200 + AI bot rules → names + disallowed-all subset', () => {
  const a = analyzeRobots({ status: 200, text: AI_MIXED_ROBOTS, error: null });
  assert.equal(a.present, true);
  assert.equal(a.policy, 'parsed');
  assert.equal(a.groups_count, 4);
  for (const n of ['GPTBot', 'ClaudeBot', 'CCBot']) assert.ok(a.ai_bots_named.includes(n), n);
  assert.deepEqual(a.ai_bots_disallowed_all, ['GPTBot', 'ClaudeBot']);
  assert.equal(a.disallows_all_bots, false);
  assert.equal(a.disallows_us, false);
  assert.equal(a.mentions_claudeatlasbot, false);
  assert.ok(a.parsed && Array.isArray(a.parsed.groups));
});

test('analyzeRobots: our robots.txt → content_signal, sitemap, AI bots named, allows us', () => {
  const a = analyzeRobots({ status: 200, text: OUR_ROBOTS });
  assert.equal(a.sitemap_count, 1);
  assert.equal(a.content_signal, 'search=yes,ai-input=yes,ai-train=no');
  assert.ok(a.ai_bots_named.includes('ClaudeBot'));
  assert.ok(a.ai_bots_named.includes('GPTBot'));
  assert.deepEqual(a.ai_bots_disallowed_all, []);
  assert.equal(a.disallows_us, false);
});

test('analyzeRobots: explicit ClaudeAtlasBot disallow → disallows_us + mentions', () => {
  const a = analyzeRobots({ status: 200, text: 'User-agent: *\nAllow: /\n\nUser-agent: ClaudeAtlasBot\nDisallow: /\n' });
  assert.equal(a.disallows_us, true);
  assert.equal(a.mentions_claudeatlasbot, true);
  assert.equal(a.disallows_all_bots, false);
  assert.equal(isAllowed(a.parsed, '/'), false);
});

test('analyzeRobots: * Disallow: / → disallows_all_bots AND disallows_us', () => {
  const a = analyzeRobots({ status: 200, text: 'User-agent: *\nDisallow: /\n' });
  assert.equal(a.disallows_all_bots, true);
  assert.equal(a.disallows_us, true);
});

test('analyzeRobots: 404 → absent, allow_all; parsed allows everything', () => {
  const a = analyzeRobots({ status: 404, text: '<html>nope</html>' });
  assert.equal(a.present, false);
  assert.equal(a.policy, 'allow_all');
  assert.equal(a.disallows_us, false);
  assert.equal(isAllowed(a.parsed, '/llms.txt'), true);
});

test('analyzeRobots: 503 / network error → disallow_all (conservative)', () => {
  const a = analyzeRobots({ status: 503, text: 'Service Unavailable' });
  assert.equal(a.present, false);
  assert.equal(a.policy, 'disallow_all');
  assert.equal(a.disallows_us, true);
  assert.equal(isAllowed(a.parsed, '/'), false);
  const b = analyzeRobots({ status: null, text: null, error: 'timeout' });
  assert.equal(b.policy, 'disallow_all');
  assert.equal(b.disallows_us, true);
  const c = analyzeRobots(null);
  assert.equal(c.policy, 'disallow_all');
});

// ---------------------------------------------------------------------------
// classifyResponse
// ---------------------------------------------------------------------------

test('classifyResponse: every class', () => {
  const c = (status, headers = {}, bodySnippet = '', error = null) =>
    classifyResponse({ status, headers, bodySnippet, error });
  assert.equal(c(200), 'allowed');
  assert.equal(c(204), 'allowed');
  assert.equal(c(403, {}, '<html>Forbidden</html>'), 'blocked');
  assert.equal(c(401), 'blocked');
  assert.equal(c(429), 'blocked');
  assert.equal(c(451), 'blocked');
  assert.equal(c(402), 'toll');
  assert.equal(c(403, {}, '<title>Just a moment...</title>'), 'challenged');
  assert.equal(c(503, { 'cf-mitigated': 'challenge' }, ''), 'challenged');
  assert.equal(c(200, { 'cf-mitigated': 'challenge' }, ''), 'challenged');
  assert.equal(c(403, {}, '<h1>Access Denied</h1><p>You don\'t have permission to access "http://x/" on this server.</p><p>Reference #18.4f1c1002.1700000000.abc</p>'), 'challenged');
  assert.equal(c(500), 'error');
  assert.equal(c(502), 'error');
  assert.equal(c(null, {}, '', 'timeout'), 'error');
  assert.equal(c(301, {}, '', 'redirect_budget'), 'error');
  assert.equal(c(301), 'error');
  assert.equal(classifyResponse(null), 'error');
});

// ---------------------------------------------------------------------------
// summarizeResponse
// ---------------------------------------------------------------------------

test('summarizeResponse: extracts header fields and final_host', () => {
  const s = summarizeResponse({
    status: 200,
    headers: {
      server: 'cloudflare',
      'cf-ray': '8abc-SJC',
      'x-robots-tag': 'noai',
      'content-signal': 'ai-train=no',
      'content-type': 'text/html; charset=utf-8',
    },
    bytes: 12345,
    bytesTruncated: false,
    redirectCount: 1,
    finalUrl: 'https://www.example.com/',
    bodySnippet: '<html></html>',
    error: null,
  });
  assert.equal(s.result, 'allowed');
  assert.equal(s.status, 200);
  assert.equal(s.server, 'cloudflare');
  assert.equal(s.cf_ray, true);
  assert.equal(s.x_robots_tag, 'noai');
  assert.equal(s.content_signal, 'ai-train=no');
  assert.equal(s.content_type, 'text/html; charset=utf-8');
  assert.equal(s.bytes, 12345);
  assert.equal(s.bytes_truncated, false);
  assert.equal(s.redirect_count, 1);
  assert.equal(s.final_url, 'https://www.example.com/');
  assert.equal(s.final_host, 'www.example.com');
  assert.equal(s.error, null);
  // Body text must never leak into the summary.
  assert.ok(!('bodySnippet' in s) && !('body' in s));
});

test('summarizeResponse: error input → result error, nulls everywhere, no throw', () => {
  const s = summarizeResponse({ error: 'ECONNRESET' });
  assert.equal(s.result, 'error');
  assert.equal(s.status, null);
  assert.equal(s.server, null);
  assert.equal(s.cf_ray, false);
  assert.equal(s.final_host, null);
  assert.equal(s.error, 'ECONNRESET');
  assert.equal(summarizeResponse(null).result, 'error');
});

// ---------------------------------------------------------------------------
// analyzeHtml
// ---------------------------------------------------------------------------

test('analyzeHtml: counts JSON-LD blocks in either attribute order / quoting', () => {
  const html = `<html><head>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization"}</script>
    <script async src="/x.js"></script>
    <script id='b' type='application/ld+json'>{"@context":"https://schema.org","@type":"WebSite"}</script>
  </head><body></body></html>`;
  const a = analyzeHtml(html);
  assert.equal(a.jsonld_count, 2);
  assert.equal(a.has_schema_org, true);
  assert.deepEqual(analyzeHtml('<html><body>hi</body></html>'), { jsonld_count: 0, has_schema_org: false });
  assert.deepEqual(analyzeHtml(null), { jsonld_count: 0, has_schema_org: false });
});

// ---------------------------------------------------------------------------
// cloakingDiff
// ---------------------------------------------------------------------------

test('cloakingDiff: size threshold 30%, status difference, insufficient', () => {
  const ok = cloakingDiff({ result: 'allowed', status: 200, bytes: 100000 }, { result: 'allowed', status: 200, bytes: 120000 });
  assert.equal(ok.differs, false);
  assert.equal(ok.status_differs, false);
  assert.equal(ok.reason, null);
  assert.equal(ok.size_ratio, 0.833);

  const size = cloakingDiff({ result: 'allowed', status: 200, bytes: 100000 }, { result: 'allowed', status: 200, bytes: 140000 });
  assert.equal(size.differs, true);
  assert.equal(size.status_differs, false);
  assert.equal(size.reason, 'size');

  const status = cloakingDiff({ result: 'allowed', status: 200, bytes: 100000 }, { result: 'blocked', status: 403, bytes: 1000 });
  assert.equal(status.differs, true);
  assert.equal(status.status_differs, true);
  assert.equal(status.reason, 'status');

  const insufficient = cloakingDiff({ result: 'allowed', status: 200, bytes: 100000 }, { result: 'error', status: null, bytes: null });
  assert.equal(insufficient.differs, false);
  assert.equal(insufficient.reason, 'insufficient');
  assert.equal(insufficient.size_ratio, null);
  assert.equal(cloakingDiff(null, null).reason, 'insufficient');
});

// ---------------------------------------------------------------------------
// checkWellKnownBody / isMarkdownNegotiated
// ---------------------------------------------------------------------------

test('checkWellKnownBody: json vs text plausibility', () => {
  assert.equal(checkWellKnownBody('json', 'application/json', '{"keys":[]}'), true);
  assert.equal(checkWellKnownBody('json', 'text/html', '<!doctype html><html>'), false);
  assert.equal(checkWellKnownBody('json', 'application/json', '{"truncated": [1,2,'), true); // content-type rescue
  assert.equal(checkWellKnownBody('json', 'text/plain', 'not json'), false);
  assert.equal(checkWellKnownBody('text', 'text/plain', '# llms\n\n> site'), true);
  assert.equal(checkWellKnownBody('text', 'text/html', '<html><body>404</body></html>'), false);
  assert.equal(checkWellKnownBody('text', 'text/plain', '   '), false);
  assert.equal(checkWellKnownBody('text', null, null), false);
});

test('isMarkdownNegotiated', () => {
  assert.equal(isMarkdownNegotiated('text/markdown; charset=utf-8'), true);
  assert.equal(isMarkdownNegotiated('TEXT/MARKDOWN'), true);
  assert.equal(isMarkdownNegotiated('text/html'), false);
  assert.equal(isMarkdownNegotiated(null), false);
  assert.equal(isMarkdownNegotiated(undefined), false);
});

// ---------------------------------------------------------------------------
// aggregate
// ---------------------------------------------------------------------------

test('aggregate: four synthetic targets', () => {
  const a = aggregate(fourTargets(true));
  assert.equal(a.targets_total, 4);
  assert.deepEqual(a.by_result, { allowed: 1, blocked: 1, challenged: 1, toll: 0, error: 1, robots_disallowed: 0 });
  assert.equal(a.non_error_count, 3);
  assert.equal(a.requests_total, 40, 'requests_total sums requests_made across all targets');
  assert.equal(a.target_time_ms_sum, 120000, 'target_time_ms_sum sums duration_ms across all targets');
  assert.equal(a.block_rate, 0.667);
  assert.equal(a.allowed_rate, 0.333);
  assert.equal(a.challenged_count, 1);
  assert.equal(a.toll_count, 1);
  assert.equal(a.markdown_negotiation_rate, 0.333);
  assert.equal(a.cloaking_count, 1);
  assert.equal(a.jsonld_present_count, 1);
  assert.equal(a.signers_count, 0);
  assert.equal(a.standards['/llms.txt'].ok_count, 1);
  assert.equal(a.standards['/llms.txt'].rate, 0.333);
  for (const { path } of WELL_KNOWN_PATHS) assert.ok(a.standards[path], path);
  assert.equal(a.robots.present_count, 4);
  assert.equal(a.robots.names_ai_bots_count, 4);
  assert.equal(a.robots.has_sitemap_count, 4);
  assert.equal(a.robots.disallows_us_count, 0);
  // size_bytes over non-null homepage bytes only: 80000, 1200, 7000 → median 7000
  assert.deepEqual(a.size_bytes, { min: 1200, median: 7000, max: 80000 });
  assert.equal(a.by_tier.control.n, 1);
  assert.equal(a.by_tier.control.allowed, 1);
  assert.equal(a.by_tier.control.markdown_negotiated, 1);
  assert.equal(a.by_tier['named-operator'].blocked, 1);
  assert.equal(a.by_tier.infrastructure.challenged, 1);
  assert.equal(a.by_tier.seed.error, 1);
  assert.deepEqual(a.control, { domain: 'claudeatlas.com', allowed: true, markdown_negotiated: true, llms_txt_ok: true });
  assert.equal(a.control_passes, true);
});

test('aggregate: control with llms.txt 404 → control_passes false', () => {
  const a = aggregate(fourTargets(false));
  assert.equal(a.control.llms_txt_ok, false);
  assert.equal(a.control_passes, false);
  assert.equal(a.standards['/llms.txt'].ok_count, 0);
});

test('aggregate: empty / null input does not throw', () => {
  const a = aggregate([]);
  assert.equal(a.targets_total, 0);
  assert.equal(a.non_error_count, 0);
  assert.equal(a.block_rate, null);
  assert.equal(a.control, null);
  assert.equal(a.control_passes, false);
  assert.deepEqual(a.size_bytes, { min: null, median: null, max: null });
  assert.equal(aggregate(null).targets_total, 0);
});

// ---------------------------------------------------------------------------
// renderReport
// ---------------------------------------------------------------------------

test('renderReport: headline, one row per target, standards matrix header', () => {
  const targets = fourTargets(true);
  const pass = {
    schema_version: 1,
    run_at: '2026-09-08T00:00:00.000Z',
    agent: { ua: AGENT_UA, policy: POLICY, probe_paths: WELL_KNOWN_PATHS.map((p) => p.path) },
    targets,
    aggregate: aggregate(targets),
  };
  const md = renderReport(pass);
  assert.equal(typeof md, 'string');
  assert.ok(md.includes('66.7%'), 'headline block rate');
  for (const t of targets) assert.ok(md.includes(`| ${t.domain} |`), `row for ${t.domain}`);
  for (const { path } of WELL_KNOWN_PATHS) assert.ok(md.includes(path), `matrix header ${path}`);
  assert.ok(md.includes(AGENT_UA), 'method section restates UA');
  assert.ok(md.includes('2026-09-08'), 'run_at in title');
  assert.ok(md.includes('control_passes'), 'control line');
  assert.equal(typeof renderReport(null), 'string');
});

test('renderReport: standards matrix distinguishes 404 (✗) from network error / robots-disallowed (—)', () => {
  const t = target({ domain: 'matrix.example' });
  t.well_known['/llms.txt'] = { result: 'allowed', status: 200, content_type: 'text/plain', bytes: 10, plausible: true };
  t.well_known['/llms-full.txt'] = { result: 'error', status: 404, content_type: 'text/html', bytes: 10, plausible: false };
  t.well_known['/.well-known/agents.json'] = { result: 'error', status: null, content_type: null, bytes: null, plausible: false, error: 'timeout' };
  t.well_known['/.well-known/mcp/server-card.json'] = { result: 'robots_disallowed', status: null, content_type: null, bytes: null, plausible: false };
  t.well_known['/.well-known/http-message-signatures-directory'] = { result: 'allowed', status: 200, content_type: 'text/html', bytes: 10, plausible: false };
  t.well_known['/ai.txt'] = { result: 'blocked', status: 403, content_type: null, bytes: 10, plausible: false };
  const md = renderReport({ run_at: 'x', targets: [t] });
  assert.ok(md.includes('| matrix.example | ✓ | ✗ | — | — | ✗ | ✗ |'), md);
});

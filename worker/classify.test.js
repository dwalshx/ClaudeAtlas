/**
 * worker/classify.test.js — classifier v0 unit tests (quick-260806-dn3, E1).
 *
 * classifyRequest takes a plain signals object (never a Request), so these
 * tests run under plain `node --test` with zero Worker runtime. NEVER import
 * worker/index.js here — it uses native JSON imports that esbuild handles
 * but plain Node cannot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyRequest,
  AGENT_UA_PATTERNS,
  CRAWLER_UA_PATTERNS,
  AUTOMATION_UA_PATTERNS,
  DATACENTER_ASNS,
} from './classify.js';

// Convenience: classify a bare UA with no other signals.
function ua(userAgent, extra = {}) {
  return classifyRequest({ userAgent, ...extra });
}

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const COHERENT_SEC_FETCH = {
  secFetchMode: 'navigate',
  secFetchSite: 'none',
  secFetchDest: 'document',
};

// ---------------------------------------------------------------------------
// UA list — crawlers
// ---------------------------------------------------------------------------

test('GPTBot → crawler/openai, confidence 0.9, ua_list', () => {
  const v = ua('GPTBot/1.0');
  assert.deepEqual(v, {
    class: 'crawler',
    operator: 'openai',
    confidence: 0.9,
    method: 'ua_list',
  });
});

test('OAI-SearchBot → crawler/openai', () => {
  const v = ua('OAI-SearchBot/1.0; +https://openai.com/searchbot');
  assert.equal(v.class, 'crawler');
  assert.equal(v.operator, 'openai');
});

test('ClaudeBot → crawler/anthropic', () => {
  const v = ua('Mozilla/5.0 AppleWebKit/537.36; compatible; ClaudeBot/1.0; +claudebot@anthropic.com');
  assert.equal(v.class, 'crawler');
  assert.equal(v.operator, 'anthropic');
});

test('PerplexityBot → crawler/perplexity', () => {
  const v = ua('Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)');
  assert.equal(v.class, 'crawler');
  assert.equal(v.operator, 'perplexity');
});

test('SemrushBot → crawler/semrush', () => {
  const v = ua('Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)');
  assert.equal(v.class, 'crawler');
  assert.equal(v.operator, 'semrush');
  assert.equal(v.method, 'ua_list');
});

test('AhrefsBot → crawler/ahrefs', () => {
  const v = ua('Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)');
  assert.equal(v.class, 'crawler');
  assert.equal(v.operator, 'ahrefs');
});

test('DataForSeoBot → crawler/dataforseo', () => {
  const v = ua('Mozilla/5.0 (compatible; DataForSeoBot/1.0; +https://dataforseo.com/dataforseo-bot)');
  assert.equal(v.class, 'crawler');
  assert.equal(v.operator, 'dataforseo');
});

test('PetalBot → crawler/huawei', () => {
  const v = ua('Mozilla/5.0 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)');
  assert.equal(v.class, 'crawler');
  assert.equal(v.operator, 'huawei');
});

test('Googlebot / bingbot / Bytespider / Amazonbot / Applebot / meta-externalagent → crawler', () => {
  for (const [agent, operator] of [
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'google'],
    ['Mozilla/5.0 AppleWebKit/537.36 (compatible; Google-Extended)', 'google'],
    ['GoogleOther', 'google'],
    ['Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', 'microsoft'],
    ['Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)', 'bytedance'],
    ['Mozilla/5.0 (compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)', 'amazon'],
    ['Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)', 'apple'],
    ['Mozilla/5.0 (compatible; Applebot-Extended/0.1)', 'apple'],
    ['meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)', 'meta'],
  ]) {
    const v = ua(agent);
    assert.equal(v.class, 'crawler', `${agent} should be crawler`);
    assert.equal(v.operator, operator, `${agent} operator`);
  }
});

// ---------------------------------------------------------------------------
// UA list — agents (must win over crawler patterns: Claude-User vs ClaudeBot)
// ---------------------------------------------------------------------------

test('ChatGPT-User → agent/openai', () => {
  const v = ua('Mozilla/5.0 AppleWebKit/537.36; compatible; ChatGPT-User/1.0; +https://openai.com/bot');
  assert.equal(v.class, 'agent');
  assert.equal(v.operator, 'openai');
  assert.equal(v.confidence, 0.9);
  assert.equal(v.method, 'ua_list');
});

test('Claude-User → agent/anthropic (checked before ClaudeBot substring)', () => {
  const v = ua('Mozilla/5.0 AppleWebKit/537.36; compatible; Claude-User/1.0; +Claude-User@anthropic.com');
  assert.equal(v.class, 'agent');
  assert.equal(v.operator, 'anthropic');
});

test('Claude-SearchBot → crawler/anthropic (not confused with Claude-User)', () => {
  const v = ua('Mozilla/5.0 (compatible; Claude-SearchBot/1.0; +claude-searchbot@anthropic.com)');
  assert.equal(v.class, 'crawler');
  assert.equal(v.operator, 'anthropic');
});

test('Perplexity-User → agent/perplexity', () => {
  const v = ua('Mozilla/5.0 (compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)');
  assert.equal(v.class, 'agent');
  assert.equal(v.operator, 'perplexity');
});

test('MistralAI-User → agent/mistral', () => {
  const v = ua('Mozilla/5.0 (compatible; MistralAI-User/1.0)');
  assert.equal(v.class, 'agent');
  assert.equal(v.operator, 'mistral');
});

test('claude-code/ prefix → agent/anthropic-claude-code', () => {
  const v = ua('claude-code/1.0.44 (external)');
  assert.equal(v.class, 'agent');
  assert.equal(v.operator, 'anthropic-claude-code');
  assert.equal(v.confidence, 0.9);
});

// ---------------------------------------------------------------------------
// UA list — generic automation
// ---------------------------------------------------------------------------

test('python-requests → automated_unknown', () => {
  const v = ua('python-requests/2.31');
  assert.equal(v.class, 'automated_unknown');
  assert.equal(v.operator, null);
  assert.equal(v.confidence, 0.8);
  assert.equal(v.method, 'ua_list');
});

test('curl → automated_unknown', () => {
  const v = ua('curl/8.4.0');
  assert.equal(v.class, 'automated_unknown');
});

test('other automation UAs → automated_unknown', () => {
  for (const agent of [
    'python-httpx/0.27.0',
    'aiohttp/3.9.5',
    'axios/1.7.2',
    'node-fetch/2.6.7',
    'undici',
    'Go-http-client/2.0',
    'okhttp/4.12.0',
    'Scrapy/2.11.2 (+https://scrapy.org)',
    'Wget/1.21.4',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36',
  ]) {
    const v = ua(agent);
    assert.equal(v.class, 'automated_unknown', `${agent} should be automated_unknown`);
  }
});

// ---------------------------------------------------------------------------
// Missing UA
// ---------------------------------------------------------------------------

test('empty UA → automated_unknown, method no_ua', () => {
  const v = ua('');
  assert.equal(v.class, 'automated_unknown');
  assert.equal(v.confidence, 0.7);
  assert.equal(v.method, 'no_ua');
});

test('null UA → automated_unknown, method no_ua', () => {
  const v = ua(null);
  assert.equal(v.class, 'automated_unknown');
  assert.equal(v.method, 'no_ua');
});

// ---------------------------------------------------------------------------
// Browser-shaped UAs: coherence + ASN heuristics
// ---------------------------------------------------------------------------

test('Chrome UA + coherent sec-fetch + residential ASN → human 0.7', () => {
  const v = classifyRequest({
    userAgent: CHROME_UA,
    asn: 7922,
    asOrg: 'COMCAST',
    ...COHERENT_SEC_FETCH,
  });
  assert.equal(v.class, 'human');
  assert.equal(v.confidence, 0.7);
  assert.equal(v.method, 'coherence');
});

test('Chrome UA + NO sec-fetch headers → automated_unknown via coherence (never human)', () => {
  const v = classifyRequest({ userAgent: CHROME_UA, asn: 7922, asOrg: 'COMCAST' });
  assert.equal(v.class, 'automated_unknown');
  assert.equal(v.method, 'coherence');
  assert.equal(v.confidence, 0.6);
});

test('Chrome UA + coherent sec-fetch + AWS ASN 16509 → automated_unknown via asn_heuristic', () => {
  const v = classifyRequest({
    userAgent: CHROME_UA,
    asn: 16509,
    asOrg: 'AMAZON-02',
    ...COHERENT_SEC_FETCH,
  });
  assert.equal(v.class, 'automated_unknown');
  assert.equal(v.method, 'asn_heuristic');
  assert.equal(v.confidence, 0.7);
});

test('Chrome UA + Hetzner asOrg → automated_unknown', () => {
  const v = classifyRequest({
    userAgent: CHROME_UA,
    asn: 24940,
    asOrg: 'Hetzner Online GmbH',
    ...COHERENT_SEC_FETCH,
  });
  assert.equal(v.class, 'automated_unknown');
  assert.equal(v.method, 'asn_heuristic');
});

test('Chrome UA + "Google Cloud" asOrg → automated_unknown; plain "Google" org must NOT match', () => {
  const dc = classifyRequest({
    userAgent: CHROME_UA,
    asn: 396982,
    asOrg: 'GOOGLE-CLOUD-PLATFORM',
    ...COHERENT_SEC_FETCH,
  });
  assert.equal(dc.class, 'automated_unknown', 'google cloud org is a datacenter');
  // Googlebot's org is plain GOOGLE — that must not trip the datacenter rule.
  const gb = classifyRequest({
    userAgent: CHROME_UA,
    asn: 15169,
    asOrg: 'GOOGLE',
    ...COHERENT_SEC_FETCH,
  });
  assert.equal(gb.class, 'human', 'plain GOOGLE org + coherent browser UA is not datacenter');
});

test('old browser UA (no sec-fetch expectation) → unknown, never human', () => {
  // Mozilla-prefixed but not Chromium-≥80 claiming: coherence n/a → unknown.
  const v = classifyRequest({
    userAgent: 'Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 6.1)',
    asn: 7922,
    asOrg: 'COMCAST',
  });
  assert.equal(v.class, 'unknown');
  assert.equal(v.method, 'default');
});

// ---------------------------------------------------------------------------
// Fallbacks — nothing silent ever defaults to human
// ---------------------------------------------------------------------------

test('unlisted non-browser UA → unknown, NOT human', () => {
  const v = ua('SomeRandomThing/1.0');
  assert.equal(v.class, 'unknown');
  assert.notEqual(v.class, 'human');
  assert.equal(v.confidence, 0.3);
  assert.equal(v.method, 'default');
});

test('classifyRequest({}) never throws, returns a verdict', () => {
  const v = classifyRequest({});
  assert.ok(v && typeof v.class === 'string');
  assert.notEqual(v.class, 'human');
});

test('all-null input never throws', () => {
  const v = classifyRequest({
    userAgent: null,
    asn: null,
    asOrg: null,
    accept: null,
    secFetchMode: null,
    secFetchSite: null,
    secFetchDest: null,
    secChUa: null,
    signatureAgent: null,
  });
  assert.ok(v && typeof v.class === 'string');
});

test('no arguments at all never throws', () => {
  const v = classifyRequest();
  assert.ok(v && typeof v.class === 'string');
  assert.notEqual(v.class, 'human');
});

// ---------------------------------------------------------------------------
// E3 token echo (quick-260806-ejd) — Tier-1 agent signal, checked BEFORE the
// UA lists: an echoed X-ClaudeAtlas-Agent token proves instruction-following
// regardless of what UA the client sends.
// ---------------------------------------------------------------------------

test('agentToken present → agent 0.95 token_echo, operator null without tool suffix', () => {
  const v = classifyRequest({ userAgent: 'SomeRandomThing/1.0', agentToken: 'ca-abc' });
  assert.deepEqual(v, {
    class: 'agent',
    operator: null,
    confidence: 0.95,
    method: 'token_echo',
  });
});

test('agentToken wins over the UA lists (python-requests UA still class=agent)', () => {
  const v = classifyRequest({ userAgent: 'python-requests/2.31', agentToken: 'ca-abc' });
  assert.equal(v.class, 'agent');
  assert.equal(v.method, 'token_echo');
  // And over crawler UAs too.
  const c = classifyRequest({ userAgent: 'GPTBot/1.0', agentToken: 'ca-abc' });
  assert.equal(c.class, 'agent');
  assert.equal(c.method, 'token_echo');
});

test('agentToken with "; tool=" suffix → operator parsed, trimmed, lowercased', () => {
  const v = classifyRequest({ userAgent: 'x', agentToken: 'ca-abc; tool=My-Agent ' });
  assert.equal(v.class, 'agent');
  assert.equal(v.operator, 'my-agent');
  assert.equal(v.method, 'token_echo');
});

test('empty/whitespace/non-string agentToken → existing verdicts unchanged', () => {
  assert.equal(classifyRequest({ userAgent: 'GPTBot/1.0', agentToken: '' }).class, 'crawler');
  assert.equal(classifyRequest({ userAgent: 'GPTBot/1.0', agentToken: '   ' }).class, 'crawler');
  assert.equal(classifyRequest({ userAgent: 'GPTBot/1.0', agentToken: 42 }).class, 'crawler');
  assert.equal(classifyRequest({ userAgent: 'GPTBot/1.0', agentToken: null }).class, 'crawler');
});

// ---------------------------------------------------------------------------
// Exported tables
// ---------------------------------------------------------------------------

test('pattern tables are exported and non-empty', () => {
  assert.ok(AGENT_UA_PATTERNS.length >= 5);
  assert.ok(CRAWLER_UA_PATTERNS.length >= 15);
  assert.ok(AUTOMATION_UA_PATTERNS.length >= 10);
  assert.ok(DATACENTER_ASNS.has(16509));
  assert.ok(DATACENTER_ASNS.has(24940));
});

// ---------------------------------------------------------------------------
// E4 MCP front door (quick-260806-f00) — rule 0.5: a structurally valid
// JSON-RPC POST to /mcp is definitionally an agent. Sits AFTER token_echo
// (an echoed token is the strongest instruction-following proof) and BEFORE
// the UA lists (a python-requests UA speaking JSON-RPC is still an agent).
// ---------------------------------------------------------------------------

test('mcpValid → agent 0.95 mcp, operator null without mcpClient', () => {
  const v = classifyRequest({ userAgent: 'SomeRandomThing/1.0', mcpValid: true });
  assert.deepEqual(v, {
    class: 'agent',
    operator: null,
    confidence: 0.95,
    method: 'mcp',
  });
});

test('mcpValid with mcpClient → operator trimmed + lowercased', () => {
  const v = classifyRequest({ mcpValid: true, mcpClient: ' Claude-Code/2.1.0 ' });
  assert.equal(v.class, 'agent');
  assert.equal(v.operator, 'claude-code/2.1.0');
  assert.equal(v.method, 'mcp');
  assert.equal(v.confidence, 0.95);
});

test('mcpValid beats a crawler UA (rule sits ahead of the UA lists)', () => {
  const v = classifyRequest({ userAgent: 'GPTBot/1.0', mcpValid: true });
  assert.equal(v.class, 'agent');
  assert.equal(v.method, 'mcp');
});

test('agentToken present AND mcpValid → token_echo still wins (rule 0 unchanged)', () => {
  const v = classifyRequest({
    userAgent: 'x',
    agentToken: 'ca-abc; tool=my-agent',
    mcpValid: true,
    mcpClient: 'claude-code/2.1.0',
  });
  assert.equal(v.method, 'token_echo');
  assert.equal(v.operator, 'my-agent');
});

test('mcpValid absent/false/truthy-non-true → existing verdicts byte-identical', () => {
  assert.deepEqual(
    classifyRequest({ userAgent: 'GPTBot/1.0' }),
    { class: 'crawler', operator: 'openai', confidence: 0.9, method: 'ua_list' },
  );
  assert.deepEqual(
    classifyRequest({ userAgent: 'GPTBot/1.0', mcpValid: false }),
    { class: 'crawler', operator: 'openai', confidence: 0.9, method: 'ua_list' },
  );
  // Strict === true gate: a truthy string must NOT trip the rule.
  assert.deepEqual(
    classifyRequest({ userAgent: 'GPTBot/1.0', mcpValid: '1' }),
    { class: 'crawler', operator: 'openai', confidence: 0.9, method: 'ua_list' },
  );
});

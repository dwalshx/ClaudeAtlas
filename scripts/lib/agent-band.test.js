import { test } from 'node:test';
import assert from 'node:assert';
import { scoreSession } from './agent-band.js';

// A minimal session aggregate with all-zero counters; individual tests override.
function agg(overrides = {}) {
  return {
    total_requests: 1,
    distinct_paths: 1,
    span_ms: 0,
    content_requests: 1,
    asset_requests: 0,
    markdown_accept: 0,
    agent_endpoint: 0,
    sec_fetch_incoherent: 0,
    has_token_echo: 0,
    has_mcp: 0,
    asn_class: 'unknown',
    ...overrides,
  };
}

test('ground truth: token_echo → score 1, agent-shaped, cooperative', () => {
  const r = scoreSession(agg({ has_token_echo: 1, total_requests: 1 }));
  assert.equal(r.score, 1);
  assert.equal(r.band, 'agent-shaped');
  assert.equal(r.method, 'cooperative');
});

test('ground truth: mcp → score 1, agent-shaped, cooperative', () => {
  const r = scoreSession(agg({ has_mcp: 1, total_requests: 1 }));
  assert.equal(r.score, 1);
  assert.equal(r.band, 'agent-shaped');
  assert.equal(r.method, 'cooperative');
});

test('ground truth wins even over a single-request no-tell session', () => {
  // The cap rule must NOT downgrade a cooperative ground-truth session.
  const r = scoreSession(
    agg({ has_mcp: 1, total_requests: 1, markdown_accept: 0, agent_endpoint: 0 }),
  );
  assert.equal(r.band, 'agent-shaped');
});

test('browser-shaped human: high asset_ratio, coherent, residential → human-shaped', () => {
  const r = scoreSession(
    agg({
      total_requests: 10,
      distinct_paths: 2,
      content_requests: 2,
      asset_requests: 8, // assets ≈ content*4
      sec_fetch_incoherent: 0,
      asn_class: 'isp_residential',
    }),
  );
  assert.equal(r.band, 'human-shaped');
  assert.ok(r.score < 0.3, `expected score<0.3, got ${r.score}`);
  assert.equal(r.method, 'session_shape');
});

test('agent via markdown: any text/markdown Accept → not human-shaped, score>=0.3', () => {
  const r = scoreSession(
    agg({
      total_requests: 2,
      distinct_paths: 2,
      content_requests: 2,
      asset_requests: 0,
      markdown_accept: 1,
    }),
  );
  assert.notEqual(r.band, 'human-shaped');
  assert.ok(['agent-shaped', 'uncertain'].includes(r.band));
  assert.ok(r.score >= 0.3, `expected score>=0.3, got ${r.score}`);
});

test('agent via asset_ratio≈0 with content: pages, ~no assets → agent-shaped', () => {
  const r = scoreSession(
    agg({
      total_requests: 4,
      distinct_paths: 4,
      content_requests: 4,
      asset_requests: 0,
    }),
  );
  assert.equal(r.band, 'agent-shaped');
  assert.ok(r.score >= 0.6, `expected score>=0.6, got ${r.score}`);
});

test('single-request no-tell cap: 1 req, no markdown/endpoint → at most uncertain', () => {
  const r = scoreSession(
    agg({
      total_requests: 1,
      distinct_paths: 1,
      content_requests: 1,
      asset_requests: 0,
      markdown_accept: 0,
      agent_endpoint: 0,
    }),
  );
  assert.notEqual(r.band, 'agent-shaped');
  assert.equal(r.band, 'uncertain');
});

test('signals object exposes derived evidence features', () => {
  const r = scoreSession(
    agg({
      total_requests: 4,
      distinct_paths: 3,
      content_requests: 2,
      asset_requests: 2,
      markdown_accept: 1,
      agent_endpoint: 1,
      sec_fetch_incoherent: 1,
    }),
  );
  assert.ok(r.signals, 'signals object present');
  assert.equal(r.signals.asset_ratio, 0.5); // 2/(2+2)
  assert.equal(r.signals.markdown_rate, 0.25); // 1/4
  assert.equal(r.signals.endpoint_rate, 0.25); // 1/4
  assert.equal(r.signals.incoherent_rate, 0.25); // 1/4
  assert.equal(r.signals.distinct_paths, 3);
  assert.equal(r.signals.total_requests, 4);
});

test('single-fetch-no-asset flag: 1 req / 0 assets / no tell → flagged, band uncertain', () => {
  const r = scoreSession(
    agg({
      total_requests: 1,
      distinct_paths: 1,
      content_requests: 1,
      asset_requests: 0,
      markdown_accept: 0,
      agent_endpoint: 0,
    }),
  );
  assert.equal(r.single_fetch_no_asset, true);
  assert.equal(r.band, 'uncertain'); // still scored as uncertain, not agent-shaped
});

test('single-fetch-no-asset flag: NOT set when the lone request is a strong tell', () => {
  // A single markdown-Accept fetch lands agent-shaped → not a no-tell single fetch.
  const r = scoreSession(
    agg({
      total_requests: 1,
      distinct_paths: 1,
      content_requests: 1,
      asset_requests: 0,
      markdown_accept: 1,
    }),
  );
  assert.equal(r.band, 'agent-shaped');
  assert.equal(r.single_fetch_no_asset, false);
});

test('single-fetch-no-asset flag: NOT set for multi-request sessions', () => {
  const r = scoreSession(
    agg({
      total_requests: 4,
      distinct_paths: 4,
      content_requests: 4,
      asset_requests: 0,
    }),
  );
  assert.equal(r.single_fetch_no_asset, false);
});

test('single-fetch-no-asset flag: NOT set when the lone request is an asset', () => {
  const r = scoreSession(
    agg({
      total_requests: 1,
      distinct_paths: 1,
      content_requests: 0,
      asset_requests: 1,
    }),
  );
  assert.equal(r.single_fetch_no_asset, false);
});

test('div0 guard: zero content+asset requests → asset_ratio 0, no NaN', () => {
  const r = scoreSession(
    agg({ total_requests: 1, content_requests: 0, asset_requests: 0 }),
  );
  assert.equal(r.signals.asset_ratio, 0);
  assert.ok(Number.isFinite(r.score));
});

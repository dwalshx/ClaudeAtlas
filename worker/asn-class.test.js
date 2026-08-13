/**
 * worker/asn-class.test.js — pure ASN network module tests
 * (quick-260812-p3b, L1 network-aware classifier).
 *
 * classifyAsn / matchesOperatorNetwork take plain scalars (never a Request),
 * so these run under plain `node --test` with zero Worker runtime and zero
 * network I/O.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyAsn,
  matchesOperatorNetwork,
  OPERATOR_NETWORK_HINTS,
  HOSTING_ASNS,
} from './asn-class.js';

// ---------------------------------------------------------------------------
// classifyAsn → 'hosting' | 'isp_residential' | 'unknown'
// ---------------------------------------------------------------------------

test('classifyAsn: known hosting ASNs → hosting', () => {
  assert.equal(classifyAsn(16509, 'AMAZON-02'), 'hosting');
  assert.equal(classifyAsn(24940, 'Hetzner Online GmbH'), 'hosting');
});

test('classifyAsn: Google Cloud org (AS396982) → hosting', () => {
  assert.equal(classifyAsn(396982, 'GOOGLE-CLOUD-PLATFORM'), 'hosting');
});

test('classifyAsn: Kingsoft Cloud → hosting (the Singapore/Kingsoft farm)', () => {
  assert.equal(classifyAsn(null, 'Kingsoft Cloud'), 'hosting');
});

test('classifyAsn: hosting-keyword orgs → hosting', () => {
  for (const org of [
    'Alibaba (US) Technology Co.',
    'Aliyun Computing Co.',
    'Tencent Cloud Computing',
    'Huawei Cloud Service',
    'DigitalOcean, LLC',
    'Digital Ocean',
    'Vultr Holdings',
    'Linode',
    'OVH SAS',
    'CLOUDFLARENET',
    'Oracle Cloud',
    'SCALEWAY S.A.S.',
  ]) {
    assert.equal(classifyAsn(null, org), 'hosting', `${org} should be hosting`);
  }
});

test('classifyAsn: residential ISPs → isp_residential', () => {
  assert.equal(classifyAsn(7922, 'COMCAST'), 'isp_residential');
  assert.equal(classifyAsn(null, 'China Mobile Communications'), 'isp_residential');
  assert.equal(classifyAsn(null, 'Verizon'), 'isp_residential');
  assert.equal(classifyAsn(null, 'Deutsche Telekom AG'), 'isp_residential');
});

test('classifyAsn: bare GOOGLE org (AS15169) → unknown (must stay non-hosting)', () => {
  assert.equal(classifyAsn(15169, 'GOOGLE'), 'unknown');
});

test('classifyAsn: null/garbage/empty → unknown; never throws', () => {
  assert.equal(classifyAsn(null, null), 'unknown');
  assert.equal(classifyAsn(undefined, undefined), 'unknown');
  assert.equal(classifyAsn(0, ''), 'unknown');
  assert.equal(classifyAsn('nonsense', {}), 'unknown');
  assert.equal(classifyAsn(NaN, '   '), 'unknown');
});

// ---------------------------------------------------------------------------
// matchesOperatorNetwork → true | false | null (no opinion)
// ---------------------------------------------------------------------------

test('matchesOperatorNetwork: OpenAI on Azure → true', () => {
  assert.equal(matchesOperatorNetwork('openai', 8075, 'MICROSOFT-CORP-MSN-AS-BLOCK'), true);
});

test('matchesOperatorNetwork: OpenAI on Google Cloud → false (impersonation case)', () => {
  assert.equal(matchesOperatorNetwork('openai', 396982, 'GOOGLE-CLOUD-PLATFORM'), false);
});

test('matchesOperatorNetwork: Mistral on Cloudflare ASN → false', () => {
  assert.equal(matchesOperatorNetwork('mistral', 13335, 'CLOUDFLARENET'), false);
});

test('matchesOperatorNetwork: Anthropic on GCP → true (must not false-flag real Claude)', () => {
  assert.equal(matchesOperatorNetwork('anthropic', 15169, 'GOOGLE'), true);
});

test('matchesOperatorNetwork: Google on GOOGLE → true', () => {
  assert.equal(matchesOperatorNetwork('google', 15169, 'GOOGLE'), true);
});

test('matchesOperatorNetwork: SEO tool (semrush) → null (no hint set → no opinion)', () => {
  assert.equal(matchesOperatorNetwork('semrush', 16509, 'AMAZON-02'), null);
});

test('matchesOperatorNetwork: unknown operator string → null', () => {
  assert.equal(matchesOperatorNetwork('nope-operator', 16509, 'AMAZON-02'), null);
  assert.equal(matchesOperatorNetwork(null, 16509, 'AMAZON-02'), null);
});

test('matchesOperatorNetwork: known operator with non-string asOrg → false (not null)', () => {
  assert.equal(matchesOperatorNetwork('openai', 8075, null), false);
});

// ---------------------------------------------------------------------------
// Exported surfaces
// ---------------------------------------------------------------------------

test('HOSTING_ASNS is a Set superset of classify.js DATACENTER_ASNS seed', () => {
  assert.ok(HOSTING_ASNS instanceof Set);
  assert.ok(HOSTING_ASNS.has(16509)); // AWS
  assert.ok(HOSTING_ASNS.has(24940)); // Hetzner
  assert.ok(HOSTING_ASNS.has(13335)); // Cloudflare
});

test('OPERATOR_NETWORK_HINTS only carries AI operators (no SEO tools)', () => {
  assert.ok(OPERATOR_NETWORK_HINTS.openai instanceof RegExp);
  assert.ok(OPERATOR_NETWORK_HINTS.anthropic instanceof RegExp);
  assert.equal(OPERATOR_NETWORK_HINTS.semrush, undefined);
  assert.equal(OPERATOR_NETWORK_HINTS.ahrefs, undefined);
});

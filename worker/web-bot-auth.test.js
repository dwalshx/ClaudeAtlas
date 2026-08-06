/**
 * worker/web-bot-auth.test.js — RFC 9421 Web Bot Auth verifier tests
 * (quick-260806-dn3, E5).
 *
 * Runs under plain `node --test` — Node 22 WebCrypto supports Ed25519, so we
 * generate a real keypair, build the real RFC 9421 signature base, sign it,
 * and verify the round trip. NEVER import worker/index.js here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { verifyWebBotAuth, _clearJwksCache } from './web-bot-auth.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function b64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function makeKeypair() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  );
  const jwk = await crypto.subtle.exportKey('jwk', publicKey);
  return { privateKey, jwk };
}

// Build the RFC 9421 §2.5 signature base for ("@authority" "signature-agent").
function buildBase({ authority, signatureAgent, params }) {
  return [
    `"@authority": ${authority}`,
    `"signature-agent": ${signatureAgent}`,
    `"@signature-params": ${params}`,
  ].join('\n');
}

async function sign(privateKey, base) {
  const sig = await crypto.subtle.sign(
    { name: 'Ed25519' },
    privateKey,
    new TextEncoder().encode(base)
  );
  return new Uint8Array(sig);
}

function headersOf(obj) {
  return new Headers(obj);
}

function jwksFetchMock(domainToKeys, calls = []) {
  return async (url) => {
    calls.push(String(url));
    const host = new URL(String(url)).host;
    const keys = domainToKeys[host];
    if (!keys) throw new Error(`no JWKS for ${host}`);
    return { ok: true, json: async () => ({ keys }) };
  };
}

// A full happy-path setup shared by the verified + failed tests.
async function makeSignedRequest(domain) {
  const { privateKey, jwk } = await makeKeypair();
  const created = Math.floor(Date.now() / 1000);
  const params = `("@authority" "signature-agent");created=${created};keyid="k1";alg="ed25519"`;
  const signatureAgent = `"${domain}"`;
  const authority = 'claudeatlas.com';
  const base = buildBase({ authority, signatureAgent, params });
  const sigBytes = await sign(privateKey, base);
  const headers = headersOf({
    host: authority,
    'signature-agent': signatureAgent,
    'signature-input': `sig1=${params}`,
    signature: `sig1=:${b64(sigBytes)}:`,
  });
  const jwks = [{ ...jwk, kid: 'k1' }];
  return { headers, jwks, sigBytes, params, authority, signatureAgent };
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

test('no signature headers → absent, fetch mock never called', async () => {
  _clearJwksCache();
  const calls = [];
  const result = await verifyWebBotAuth(headersOf({ host: 'claudeatlas.com' }), {
    fetchImpl: jwksFetchMock({}, calls),
  });
  assert.deepEqual(result, { status: 'absent', signer: null });
  assert.equal(calls.length, 0);
});

test('Signature-Agent present but JWKS fetch rejects → present_unverified with signer', async () => {
  _clearJwksCache();
  const { headers } = await makeSignedRequest('unfetchable.example');
  const result = await verifyWebBotAuth(headers, {
    fetchImpl: async () => {
      throw new Error('network down');
    },
  });
  assert.equal(result.status, 'present_unverified');
  assert.equal(result.signer, 'unfetchable.example');
});

test('happy path: real Ed25519 round-trip → verified', async () => {
  _clearJwksCache();
  const { headers, jwks } = await makeSignedRequest('signer-ok.example');
  const calls = [];
  const result = await verifyWebBotAuth(headers, {
    fetchImpl: jwksFetchMock({ 'signer-ok.example': jwks }, calls),
  });
  assert.equal(result.status, 'verified');
  assert.equal(result.signer, 'signer-ok.example');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('/.well-known/http-message-signatures-directory'));
});

test('flipped signature byte → failed', async () => {
  _clearJwksCache();
  const { headers, jwks, sigBytes, params } = await makeSignedRequest('signer-bad.example');
  const flipped = Uint8Array.from(sigBytes);
  flipped[0] ^= 0xff;
  const tampered = headersOf({
    host: 'claudeatlas.com',
    'signature-agent': headers.get('signature-agent'),
    'signature-input': `sig1=${params}`,
    signature: `sig1=:${b64(flipped)}:`,
  });
  const result = await verifyWebBotAuth(tampered, {
    fetchImpl: jwksFetchMock({ 'signer-bad.example': jwks }),
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.signer, 'signer-bad.example');
});

test('malformed Signature-Input → present_unverified (graceful degrade)', async () => {
  _clearJwksCache();
  const headers = headersOf({
    host: 'claudeatlas.com',
    'signature-agent': '"malformed.example"',
    'signature-input': 'sig1=this-is-not-an-inner-list',
    signature: 'sig1=:AAAA:',
  });
  const result = await verifyWebBotAuth(headers, {
    fetchImpl: jwksFetchMock({}),
  });
  assert.equal(result.status, 'present_unverified');
  assert.equal(result.signer, 'malformed.example');
});

test('unsupported covered component → present_unverified', async () => {
  _clearJwksCache();
  const headers = headersOf({
    host: 'claudeatlas.com',
    'signature-agent': '"unsupported.example"',
    'signature-input': 'sig1=("@query-param";name="q");created=1;keyid="k1";alg="ed25519"',
    signature: 'sig1=:AAAA:',
  });
  const result = await verifyWebBotAuth(headers, {
    fetchImpl: jwksFetchMock({}),
  });
  assert.equal(result.status, 'present_unverified');
});

test('never throws even on garbage input', async () => {
  _clearJwksCache();
  const result = await verifyWebBotAuth(null);
  assert.equal(result.status, 'absent');
  const result2 = await verifyWebBotAuth({ get: () => { throw new Error('boom'); } });
  assert.ok(['absent', 'present_unverified'].includes(result2.status));
});

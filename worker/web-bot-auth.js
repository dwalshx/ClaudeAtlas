/**
 * worker/web-bot-auth.js — Web Bot Auth verification, LOG-ONLY
 * (quick-260806-dn3, experiment E5).
 *
 * Implements the verification side of the Cloudflare/IETF "Web Bot Auth"
 * proposal: agents sign requests per RFC 9421 (HTTP Message Signatures) and
 * advertise their key directory via a Signature-Agent header. We:
 *
 *   1. Read Signature-Agent / Signature-Input / Signature.
 *   2. Fetch the signer's JWKS from
 *      https://<domain>/.well-known/http-message-signatures-directory
 *   3. Reconstruct the RFC 9421 §2.5 signature base for the covered
 *      components we support and verify the Ed25519 signature via WebCrypto.
 *
 * Outcome is RECORDED, never enforced:
 *   { status: 'verified' | 'failed' | 'present_unverified' | 'absent',
 *     signer: <domain> | null }
 *
 * Contract: this function NEVER throws or rejects, and does zero network
 * I/O when no signature headers are present. It runs exclusively inside
 * ctx.waitUntil (see worker/request-log.js) — never in the response path.
 *
 * Supported covered components: @authority, @path, @method, signature-agent.
 * Anything else (or any parse failure, unfetchable JWKS, unsupported alg)
 * degrades to 'present_unverified' — per the minimum-viable clause we log
 * that a signature was PRESENT even when we can't check it.
 */

// Per-isolate JWKS cache: domain → { at: epochMs, keys: [...] }. Cold
// isolates refetch — acceptable for v0 (the directories are tiny).
const JWKS_CACHE = new Map();
const JWKS_TTL_MS = 60 * 60 * 1000; // ~1h

// Test hook — clears the module-level cache between test cases.
export function _clearJwksCache() {
  JWKS_CACHE.clear();
}

const SUPPORTED_DERIVED = new Set(['@authority', '@path', '@method']);

function stripQuotes(s) {
  return typeof s === 'string' ? s.trim().replace(/^"|"$/g, '') : null;
}

// Extract the signer DOMAIN from a Signature-Agent value. Values are
// structured-field strings — usually a bare domain, sometimes an https URL.
function signerDomain(sigAgentRaw) {
  const unquoted = stripQuotes(sigAgentRaw);
  if (!unquoted) return null;
  if (/^https?:\/\//i.test(unquoted)) {
    try {
      return new URL(unquoted).host;
    } catch {
      return unquoted;
    }
  }
  return unquoted;
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function fetchJwks(domain, fetchImpl, nowMs) {
  const cached = JWKS_CACHE.get(domain);
  if (cached && nowMs - cached.at < JWKS_TTL_MS) return cached.keys;
  const url = `https://${domain}/.well-known/http-message-signatures-directory`;
  const res = await fetchImpl(url, {
    headers: { accept: 'application/http-message-signatures-directory+json, application/json' },
  });
  if (!res || !res.ok) throw new Error(`JWKS fetch failed for ${domain}`);
  const body = await res.json();
  const keys = Array.isArray(body && body.keys) ? body.keys : [];
  JWKS_CACHE.set(domain, { at: nowMs, keys });
  return keys;
}

/**
 * verifyWebBotAuth(headers, { fetchImpl, now, path, method, authority }?)
 *
 * `headers` is any Headers-like object supporting .get(name). `path` /
 * `method` / `authority` let a caller supply derived-component values the
 * headers alone can't provide; when a signature covers @path/@method and
 * the caller didn't supply them, we degrade to present_unverified.
 */
export async function verifyWebBotAuth(headers, opts = {}) {
  let signer = null;
  let sawSignatureHeaders = false;
  try {
    const get = (name) =>
      headers && typeof headers.get === 'function' ? headers.get(name) : null;

    const sigAgentRaw = get('signature-agent');
    const sigInputRaw = get('signature-input');
    const sigRaw = get('signature');

    if (!sigAgentRaw && !sigInputRaw && !sigRaw) {
      return { status: 'absent', signer: null };
    }
    sawSignatureHeaders = true;
    signer = signerDomain(sigAgentRaw);

    // Need all three headers + a signer domain to even attempt verification.
    if (!signer || !sigInputRaw || !sigRaw) {
      return { status: 'present_unverified', signer };
    }

    // --- Parse Signature-Input: label=("comp" "comp");param=v;... ---------
    const inputMatch = sigInputRaw.match(/^\s*([\w-]+)=\((.*?)\)(.*)$/s);
    if (!inputMatch) return { status: 'present_unverified', signer };
    const [, label, innerList, paramsTail] = inputMatch;

    const componentTokens = innerList.split(/\s+/).filter(Boolean);
    const components = [];
    for (const token of componentTokens) {
      const m = token.match(/^"([^"]+)"$/);
      // Inner-list items with parameters (e.g. "@query-param";name="q") or
      // unquoted junk are outside our supported subset.
      if (!m) return { status: 'present_unverified', signer };
      const comp = m[1].toLowerCase();
      if (comp.startsWith('@') && !SUPPORTED_DERIVED.has(comp)) {
        return { status: 'present_unverified', signer };
      }
      components.push(comp);
    }

    // --- Signature params: alg must be ed25519 (when declared) ------------
    const algMatch = paramsTail.match(/;\s*alg="([^"]+)"/);
    if (algMatch && algMatch[1].toLowerCase() !== 'ed25519') {
      return { status: 'present_unverified', signer };
    }
    const keyidMatch = paramsTail.match(/;\s*keyid="([^"]+)"/);
    const keyid = keyidMatch ? keyidMatch[1] : null;

    const nowMs = typeof opts.now === 'function' ? opts.now() : Date.now();
    const expiresMatch = paramsTail.match(/;\s*expires=(\d+)/);
    if (expiresMatch && nowMs / 1000 > Number(expiresMatch[1])) {
      // Expired signature — cryptographically checkable but stale.
      return { status: 'failed', signer };
    }

    // --- Extract this label's signature bytes -----------------------------
    const sigEntryMatch = sigRaw.match(
      new RegExp(`(?:^|,)\\s*${label}=:([A-Za-z0-9+/=]+):`)
    );
    if (!sigEntryMatch) return { status: 'present_unverified', signer };
    let sigBytes;
    try {
      sigBytes = b64ToBytes(sigEntryMatch[1]);
    } catch {
      return { status: 'present_unverified', signer };
    }

    // --- Reconstruct the RFC 9421 §2.5 signature base ----------------------
    const lines = [];
    for (const comp of components) {
      let value = null;
      if (comp === '@authority') {
        value = opts.authority || get('host');
      } else if (comp === '@path') {
        value = opts.path || null;
      } else if (comp === '@method') {
        value = opts.method ? String(opts.method).toUpperCase() : null;
      } else {
        // Plain header field — raw value as sent.
        value = get(comp);
      }
      if (value == null) return { status: 'present_unverified', signer };
      lines.push(`"${comp}": ${value}`);
    }
    // @signature-params value = everything after "label=" in Signature-Input.
    const paramsSerialized = sigInputRaw.slice(sigInputRaw.indexOf('=') + 1).trim();
    lines.push(`"@signature-params": ${paramsSerialized}`);
    const base = lines.join('\n');

    // --- Fetch JWKS + import the Ed25519 key -------------------------------
    const fetchImpl = opts.fetchImpl || globalThis.fetch;
    let keys;
    try {
      keys = await fetchJwks(signer, fetchImpl, nowMs);
    } catch {
      return { status: 'present_unverified', signer };
    }
    const jwk = keys.find(
      (k) =>
        k &&
        k.kty === 'OKP' &&
        k.crv === 'Ed25519' &&
        (!keyid || k.kid === keyid)
    );
    if (!jwk) return { status: 'present_unverified', signer };

    let cryptoKey;
    try {
      cryptoKey = await crypto.subtle.importKey(
        'jwk',
        { kty: jwk.kty, crv: jwk.crv, x: jwk.x },
        { name: 'Ed25519' },
        false,
        ['verify']
      );
    } catch {
      return { status: 'present_unverified', signer };
    }

    // --- Verify -------------------------------------------------------------
    const ok = await crypto.subtle.verify(
      { name: 'Ed25519' },
      cryptoKey,
      sigBytes,
      new TextEncoder().encode(base)
    );
    return { status: ok ? 'verified' : 'failed', signer };
  } catch (err) {
    // NEVER throw — worst case we under-report. If we at least saw
    // signature headers, record their presence.
    try {
      console.error('web-bot-auth error:', err && err.message);
    } catch {
      /* even console must not break the contract */
    }
    return sawSignatureHeaders
      ? { status: 'present_unverified', signer }
      : { status: 'absent', signer: null };
  }
}

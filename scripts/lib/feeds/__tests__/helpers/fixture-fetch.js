/**
 * scripts/lib/feeds/__tests__/helpers/fixture-fetch.js
 *
 * Phase 4.2 Plan 03 (4.2-M04 / 4.2-M07, D-10). Shared fake `fetch` for the
 * harvest-apis and filter-apis integration tests: maps the four real source
 * URLs (and the APIs.guru spec URLs) to the 2026-11-05 fixture bodies so both
 * tests consume one identical, deterministic raw set (33 raw records).
 *
 * Plain ESM helper, not a test file. It lives under `__tests__` so the
 * banned-pattern lint allowlist covers its fixture `readFileSync` calls.
 * Never makes a network call.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const FIX = join(ROOT, 'data', '__fixtures__', 'feeds');
const fixtureText = (name) => readFileSync(join(FIX, name), 'utf-8');

export const LIST_URL = 'https://api.apis.guru/v2/list.json';
export const GOUV_URL = 'https://www.data.gouv.fr/api/1/dataservices/?page_size=200';
export const UK_URL = 'https://raw.githubusercontent.com/co-cddo/api-catalogue/main/data/catalogue.csv';
export const PUB_URL = 'https://raw.githubusercontent.com/marcelscruz/public-apis/main/db/resources.json';
export const LIST_ETAG = '"97dffd21e61d2b6792ba83040ccb38ef"';
const LIST_LAST_MODIFIED = 'Mon, 18 Aug 2025 11:01:06 GMT';

export const GITHUB_MINI_SPEC = {
  openapi: '3.0.3',
  info: { title: 'GitHub v3 REST API', license: { name: 'MIT', url: 'https://spdx.org/licenses/MIT' } },
  servers: [{ url: 'https://api.github.com' }],
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
  security: [{ bearer: [] }],
  paths: {
    '/user': {
      get: {
        operationId: 'users/get-authenticated',
        responses: { 200: { content: { 'application/json': {} } } },
      },
    },
  },
};

const LIST = JSON.parse(fixtureText('apis-guru-list-slice.json'));

/** Preferred-version swaggerUrl for an APIs.guru key in the list slice. */
export function specUrlOf(key) {
  const api = LIST[key];
  return api?.versions?.[api?.preferred]?.swaggerUrl ?? null;
}

const SOURCE_URL = {
  'apis.guru': LIST_URL,
  'data.gouv.fr': GOUV_URL,
  'uk-api-catalogue': UK_URL,
  'public-apis': PUB_URL,
};

function emptyBodyFor(url) {
  if (url === LIST_URL) return '{}';
  if (url === GOUV_URL) return JSON.stringify({ data: [], next_page: null, page: 1, page_size: 200, previous_page: null, total: 0 });
  if (url === UK_URL) return fixtureText('uk-catalogue-10.csv').split('\n')[0] + '\n';
  return JSON.stringify({ count: 0, entries: [] });
}

function streamOf(chunks) {
  const queue = [...chunks];
  return new ReadableStream({
    pull(c) {
      if (queue.length) c.enqueue(queue.shift());
      else c.close();
    },
  });
}

function headerOf(init, name) {
  const h = init?.headers;
  if (!h) return undefined;
  if (typeof h.get === 'function') return h.get(name) ?? undefined;
  const k = Object.keys(h).find((x) => x.toLowerCase() === name.toLowerCase());
  return k === undefined ? undefined : h[k];
}

/**
 * @param {{ listNotModified?: boolean, specOverrides?: Record<string, { status?: number, body?: string, chunks?: Uint8Array[], throws?: boolean }>, failSource?: string | null }} [opts]
 * @returns {{ fetchImpl: (url: string, init?: any) => Promise<Response>, calls: Array<{ url: string, headers: any }> }}
 */
export function makeFixtureFetch(opts = {}) {
  const { listNotModified = false, specOverrides = {}, failSource = null } = opts;
  const calls = [];
  const specRoutes = new Map([
    [specUrlOf('stripe.com'), () => fixtureText('openapi3-stripe-trimmed.json')],
    [specUrlOf('data.gov'), () => fixtureText('swagger2-datagov.json')],
    [specUrlOf('github.com'), () => JSON.stringify(GITHUB_MINI_SPEC)],
  ]);
  const failUrl = failSource ? SOURCE_URL[failSource] : null;

  async function fetchImpl(url, init = {}) {
    calls.push({ url, headers: init?.headers ?? {} });

    if (Object.prototype.hasOwnProperty.call(specOverrides, url)) {
      const o = specOverrides[url];
      if (o.throws) throw new TypeError('fetch failed');
      const status = o.status ?? 200;
      const body = o.chunks ? streamOf(o.chunks) : (o.body ?? '');
      return new Response(status === 304 ? null : body, { status });
    }

    if (failUrl && url === failUrl) {
      return new Response(emptyBodyFor(url), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (url === LIST_URL) {
      if (listNotModified && headerOf(init, 'If-None-Match') === LIST_ETAG) {
        return new Response(null, { status: 304, headers: { etag: LIST_ETAG } });
      }
      return new Response(fixtureText('apis-guru-list-slice.json'), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: LIST_ETAG, 'last-modified': LIST_LAST_MODIFIED },
      });
    }
    if (url === GOUV_URL) {
      // Mirrors production: data.gouv.fr sends neither ETag nor Last-Modified.
      return new Response(fixtureText('data-gouv-page.json'), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === UK_URL) {
      return new Response(fixtureText('uk-catalogue-10.csv'), {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8', etag: '"uk-catalogue-10"' },
      });
    }
    if (url === PUB_URL) {
      return new Response(fixtureText('public-apis-10.json'), {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8', etag: '"public-apis-10"' },
      });
    }
    if (specRoutes.has(url)) {
      return new Response(specRoutes.get(url)(), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: `W/"${Buffer.from(url).toString('base64url').slice(-16)}"` },
      });
    }
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }

  return { fetchImpl, calls };
}

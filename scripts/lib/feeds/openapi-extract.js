/**
 * scripts/lib/feeds/openapi-extract.js
 *
 * Phase 4.2 (D-02, 4.2-M02). Pure: takes a parsed OpenAPI/Swagger document,
 * returns a small extract, never retains the document. Handles OAS 3.x
 * (`servers[]`, `components.securitySchemes`, `responses[*].content`) and
 * Swagger 2 (`host` + `basePath` + `schemes`, `securityDefinitions`,
 * `produces`). Media types are returned RAW (api-access.js whitelists them).
 */

export const METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

const SUMMARY_LIMIT = 10;
const SUMMARY_MAX_CHARS = 80;

function fillServerVars(s) {
  let u = typeof s?.url === 'string' ? s.url : '';
  for (const [k, v] of Object.entries(s?.variables || {})) {
    u = u.replaceAll(`{${k}}`, v?.default != null ? String(v.default) : '');
  }
  return u || null;
}

/**
 * @param {any} spec  parsed OpenAPI 3.x or Swagger 2 document
 * @returns {null | {
 *   spec_version: string | null, base_urls: string[], endpoint_count: number,
 *   security: { schemes: Record<string, any>, requirements: any[] },
 *   media_types: string[], license: any, terms: string | null, external_docs_url: string | null,
 *   transport: 'rest' | 'graphql', endpoint_summaries: string[],
 *   info_title: string | null, info_description: string | null }}
 */
export function extractOpenApi(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
  const isV2 = typeof spec.swagger === 'string';

  let base_urls;
  if (isV2) {
    const scheme = (Array.isArray(spec.schemes) && spec.schemes[0]) || 'https';
    base_urls = spec.host ? [`${scheme}://${spec.host}${spec.basePath || ''}`] : [];
  } else {
    base_urls = Array.isArray(spec.servers) ? spec.servers.map(fillServerVars).filter(Boolean) : [];
  }

  const schemes = (isV2 ? spec.securityDefinitions : spec.components?.securitySchemes) || {};

  const media = [];
  const seen = new Set();
  const add = (mt) => {
    if (typeof mt === 'string' && !seen.has(mt)) {
      seen.add(mt);
      media.push(mt);
    }
  };

  const summaries = [];
  let ops = 0;
  let hasGraphql = false;
  const paths = spec.paths && typeof spec.paths === 'object' ? spec.paths : {};
  for (const [p, item] of Object.entries(paths)) {
    if (/\/graphql\b/i.test(p)) hasGraphql = true;
    if (!item || typeof item !== 'object') continue;
    for (const [m, op] of Object.entries(item)) {
      if (!METHODS.has(m)) continue;
      ops++;
      if (summaries.length < SUMMARY_LIMIT) {
        summaries.push(`${m.toUpperCase()} ${p} ${op?.summary || op?.operationId || ''}`.trim().slice(0, SUMMARY_MAX_CHARS));
      }
      for (const r of Object.values(op?.responses || {})) {
        for (const mt of Object.keys(r?.content || {})) add(mt);
      }
      if (Array.isArray(op?.produces)) for (const mt of op.produces) add(mt);
    }
  }
  if (Array.isArray(spec.produces)) for (const mt of spec.produces) add(mt);

  return {
    spec_version: spec.openapi || spec.swagger || null,
    base_urls,
    endpoint_count: ops,
    security: { schemes, requirements: Array.isArray(spec.security) ? spec.security : [] },
    media_types: media,
    license: spec.info?.license ?? null,
    terms: spec.info?.termsOfService ?? null,
    external_docs_url: spec.externalDocs?.url ?? null,
    transport: hasGraphql ? 'graphql' : 'rest',
    endpoint_summaries: summaries,
    info_title: spec.info?.title ?? null,
    info_description: spec.info?.description ?? null,
  };
}

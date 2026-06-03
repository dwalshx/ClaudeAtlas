/**
 * scripts/lib/scorers/mcp.scorer.js — Phase 3.2 scorer for
 * entity_type='mcp_server' (D-03).
 *
 * Identical to the plugin scorer EXCEPT the Manifest-Completeness signal
 * is MCP-shaped: description >= 50 chars + transport declared + >= 1 tool
 * (three equally-weighted checks).
 *
 * SIDE-EFFECT: writes `record.extra.manifest_completeness` (0-1 float).
 */

import {
  scoreStars,
  scoreRecency,
  scoreIssues,
  scoreLicense,
  scoreDescription,
} from '../../score.js';
import { scoreReadmeDocs } from './plugin.scorer.js';

const WEIGHTS = {
  stars: 0.20,
  recency: 0.20,
  manifest: 0.20,
  docs: 0.15,
  issues: 0.10,
  license: 0.10,
  description: 0.05,
};

/**
 * MCP manifest completeness, 0-1. Three equally-weighted checks:
 *   description >= 50 chars, transport declared (non-null), >= 1 tool.
 *
 * @param {any} record  v2 EntityRecord<McpExtra>.
 * @returns {number} 0-1
 */
export function mcpManifestCompleteness(record) {
  const extra = record?.extra || {};
  let hits = 0;
  if ((record?.description || '').trim().length >= 50) hits += 1;
  if (extra.transport !== null && extra.transport !== undefined) hits += 1;
  if (Array.isArray(extra.tools) && extra.tools.length >= 1) hits += 1;
  return hits / 3;
}

/**
 * Score an mcp_server EntityRecord. Mutates extra.manifest_completeness.
 *
 * @param {any} record  v2 EntityRecord<McpExtra>.
 * @returns {number} 0-100 integer.
 */
export function scoreMcp(record) {
  const completeness = mcpManifestCompleteness(record);
  if (record?.extra) record.extra.manifest_completeness = completeness;

  const scores = {
    stars: scoreStars(record.repo_stars),
    recency: scoreRecency(record.repo_pushed_at),
    manifest: completeness * 100,
    docs: scoreReadmeDocs(record),
    issues: scoreIssues(record),
    license: scoreLicense(record.repo_license),
    description: scoreDescription(record.repo_description),
  };

  let total = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    total += scores[key] * weight;
  }
  return Math.round(Math.min(100, Math.max(0, total)));
}

/**
 * scripts/lib/filter-rules/mcp.rules.js — Phase 3.2 mcp_server gates.
 *
 * Per-entity-type gates that apply only to mcp_server records. Common gates
 * run upstream in index.js's dispatcher.
 *
 * Gates (Phase 3.2 D-05):
 *   - HAS_TRANSPORT_DECLARED — reject if extra.transport === null.
 *   - tools.length >= 1 — reject if the server exposes no tools.
 *   - MIN_DESCRIPTION_LENGTH — reject if description < 50 chars.
 */

import { hasShortDescription } from './common.rules.js';

/** Per Phase 3.2 D-05. */
const MIN_DESCRIPTION_LENGTH = 50;

/**
 * MCP-specific slop gate.
 *
 * @param {any} record  v2 EntityRecord<McpExtra>.
 * @returns {boolean} true if the record should be REJECTED.
 */
export function isMcpSlop(record) {
  // Defense in depth — no-op if mis-dispatched against a non-mcp_server.
  if (record?.entity_type && record.entity_type !== 'mcp_server') return false;

  if (hasShortDescription(record, MIN_DESCRIPTION_LENGTH)) return true;

  const extra = record?.extra || {};

  // HAS_TRANSPORT_DECLARED
  if (extra.transport === null || extra.transport === undefined) return true;

  // Must expose at least one tool.
  if (!Array.isArray(extra.tools) || extra.tools.length < 1) return true;

  return false;
}

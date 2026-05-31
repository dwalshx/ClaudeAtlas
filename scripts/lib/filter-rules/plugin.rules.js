/**
 * scripts/lib/filter-rules/plugin.rules.js — Phase 3.2 plugin-specific gates.
 *
 * Per-entity-type gates that apply only to plugin records. Common gates
 * (template names, placeholder descriptions, biz-slop names) live in
 * common.rules.js and run upstream in index.js's dispatcher.
 *
 * Gates (Phase 3.2 D-05):
 *   - MIN_DESCRIPTION_LENGTH — reject if description < 50 chars.
 *   - HAS_MANIFEST_OR_LISTING — reject if neither plugin.json manifest is
 *     populated NOR the plugin appears in >= 1 marketplace listing.
 *   - COMPONENT_FLOOR — reject if the plugin bundles < 1 component across
 *     commands + hooks + bundled_skills + bundled_agents + bundled_mcp_servers.
 *
 * NO MIN_STARS gate (Phase 3.1 precedent — embedding dedup is the gate).
 */

import { hasShortDescription } from './common.rules.js';

/** Per Phase 3.2 D-05. */
const MIN_DESCRIPTION_LENGTH = 50;
/** Per Phase 3.2 D-05. */
const COMPONENT_FLOOR = 1;

/**
 * Plugin-specific slop gate.
 *
 * @param {any} record  v2 EntityRecord<PluginExtra>.
 * @returns {boolean} true if the record should be REJECTED.
 */
export function isPluginSlop(record) {
  // Defense in depth — no-op if mis-dispatched against a non-plugin.
  if (record?.entity_type && record.entity_type !== 'plugin') return false;

  if (hasShortDescription(record, MIN_DESCRIPTION_LENGTH)) return true;

  const extra = record?.extra || {};

  // HAS_MANIFEST_OR_LISTING: a populated manifest OR >= 1 marketplace listing.
  const hasManifest = !!extra.manifest && Object.keys(extra.manifest).length > 0;
  const hasListing = Array.isArray(extra.marketplace_listings) && extra.marketplace_listings.length >= 1;
  if (!hasManifest && !hasListing) return true;

  // COMPONENT_FLOOR: must bundle at least one component.
  const componentCount =
    (extra.commands?.length || 0) +
    (extra.hooks?.length || 0) +
    (extra.bundled_skills?.length || 0) +
    (extra.bundled_agents?.length || 0) +
    (extra.bundled_mcp_servers?.length || 0);
  if (componentCount < COMPONENT_FLOOR) return true;

  return false;
}

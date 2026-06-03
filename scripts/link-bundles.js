#!/usr/bin/env node

/**
 * scripts/link-bundles.js — Phase 3.2 Task 8 (D-02) orchestrator.
 *
 * Cross-entity bundle-graph populator. Runs AFTER both filters in the cron:
 *   filter.js → filter-plugins.js → filter-mcps.js → link-bundles.js → embed
 *
 * Reads data/skills.ndjson, data/plugins.ndjson, data/mcp-servers.ndjson,
 * calls the pure linkBundles() populator, and atomically rewrites
 * skills.ndjson + plugins.ndjson via writeNdjsonStreaming (tmp+rename — see
 * scripts/lib/ndjson.js). mcp-servers.ndjson is read-only here (MCPs are
 * referenced by plugins but carry no inverse field in 3.2).
 *
 * F-3 atomicity: writeNdjsonStreaming writes to `<path>.tmp` then renameSync
 * over the final path, so a mid-write crash leaves the prior file intact.
 *
 * F-3 PRESERVED_FIELDS coupling: filter.js preserves `bundled_in_plugins`
 * across re-runs so a later partial filter.js run does not reset the
 * inverse-bundle field this script populates.
 *
 * Graceful: if plugins.ndjson is missing (no plugins discovered yet), exits
 * 0 without touching skills.ndjson.
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readNdjsonRecords, writeNdjsonStreaming } from './lib/ndjson.js';
import { buildHeader } from './lib/entity-version.js';
import { linkBundles } from './lib/bundled-links.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SKILLS_PATH = join(ROOT, 'data', 'skills.ndjson');
const PLUGINS_PATH = join(ROOT, 'data', 'plugins.ndjson');
const MCP_PATH = join(ROOT, 'data', 'mcp-servers.ndjson');

function readRecords(path) {
  return [...readNdjsonRecords(path, { keyFn: (r) => r.id }).values()];
}

function main() {
  if (!existsSync(PLUGINS_PATH)) {
    console.warn(`[link-bundles] WARN: ${PLUGINS_PATH} missing; no plugins to link. Exiting 0.`);
    process.exit(0);
  }
  console.log('=== ClaudeAtlas Bundle Linker ===');

  const skills = existsSync(SKILLS_PATH) ? readRecords(SKILLS_PATH) : [];
  const plugins = readRecords(PLUGINS_PATH);
  const mcpServers = existsSync(MCP_PATH) ? readRecords(MCP_PATH) : [];

  console.log(`Loaded ${skills.length} skills, ${plugins.length} plugins, ${mcpServers.length} mcp_servers.`);

  linkBundles(plugins, skills, { mcpServers });

  const linkedSkills = skills.filter((s) => (s.bundled_in_plugins || []).length > 0).length;
  const linkedPlugins = plugins.filter(
    (p) => (p.extra?.bundled_skills || []).length > 0
      || (p.extra?.bundled_mcp_servers || []).length > 0,
  ).length;
  console.log(`Linked: ${linkedPlugins} plugins carry bundles; ${linkedSkills} skills bundled into a plugin.`);

  // Atomic rewrites (tmp+rename inside writeNdjsonStreaming).
  if (skills.length > 0) {
    writeNdjsonStreaming(SKILLS_PATH, skills, { header: buildHeader('skill') });
    console.log(`Rewrote ${SKILLS_PATH} (skill).`);
  }
  writeNdjsonStreaming(PLUGINS_PATH, plugins, { header: buildHeader('plugin') });
  console.log(`Rewrote ${PLUGINS_PATH} (plugin).`);
}

const invokedAsScript = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (invokedAsScript) main();

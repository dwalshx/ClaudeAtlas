/**
 * scripts/lib/bundled-links.js — Phase 3.2 Task 8 (D-02).
 *
 * Bidirectional skill <-> plugin <-> mcp_server bundle graph populator.
 *
 * A "plugin bundles X" relationship holds when X lives in the SAME repo as
 * the plugin AND under the plugin's directory. For a repo-root plugin
 * (`.claude-plugin/plugin.json`) the plugin directory is the repo root, so
 * every colocated skill/mcp counts. For a nested plugin
 * (`packages/foo/.claude-plugin/plugin.json`) only components under
 * `packages/foo/` count.
 *
 * This is a PURE, IDEMPOTENT function: it mutates the records in place but
 * always resets the derived arrays first, so re-running on the same input
 * yields byte-identical output. Ordering is deterministic (ids sorted
 * ascending) so the on-disk NDJSON is stable across runs.
 *
 * Display rendering is deferred to Phase 3.3 (D-02) — this is data only.
 */

/** The directory that a `.../X/.claude-plugin/plugin.json` lives under. */
function pluginDir(plugin) {
  const path = plugin?.extra?.plugin_path || '';
  // Strip the trailing `.claude-plugin/plugin.json` (or any filename) to get
  // the plugin's root directory within the repo. '' === repo root.
  const marker = '.claude-plugin/';
  const idx = path.indexOf(marker);
  if (idx >= 0) return path.slice(0, idx).replace(/\/+$/, '');
  // Fallback: directory of the manifest file.
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(0, slash) : '';
}

/** The skill_path of a skill record (nested or legacy flat). */
function skillPath(skill) {
  return skill?.extra?.skill_path || skill?.skill_path || '';
}

/** True if `childPath` is at or under `dir` (dir='' === repo root match). */
function isUnder(childPath, dir) {
  if (!dir) return true; // repo-root plugin bundles everything in the repo
  return childPath === dir || childPath.startsWith(dir + '/');
}

function uniqSorted(arr) {
  return [...new Set(arr)].sort();
}

/**
 * Populate the bundle graph across the three entity lists, in place.
 *
 * @param {any[]} plugins      plugin EntityRecords (mutated)
 * @param {any[]} skills       skill EntityRecords (mutated: bundled_in_plugins)
 * @param {{ mcpServers?: any[] }} [opts]
 * @returns {{ plugins: any[], skills: any[], mcpServers: any[] }}
 */
export function linkBundles(plugins = [], skills = [], opts = {}) {
  const mcpServers = Array.isArray(opts.mcpServers) ? opts.mcpServers : [];

  // 1. Reset inverse field on every skill (idempotency).
  for (const s of skills) s.bundled_in_plugins = [];

  // Index skills + mcps by repo for O(plugins * repoComponents) linking.
  const skillsByRepo = new Map();
  for (const s of skills) {
    const repo = s.repo_full_name || '';
    if (!skillsByRepo.has(repo)) skillsByRepo.set(repo, []);
    skillsByRepo.get(repo).push(s);
  }
  const mcpsByRepo = new Map();
  for (const m of mcpServers) {
    const repo = m.repo_full_name || '';
    if (!mcpsByRepo.has(repo)) mcpsByRepo.set(repo, []);
    mcpsByRepo.get(repo).push(m);
  }

  // Stable plugin order so the inverse field accumulates deterministically.
  const orderedPlugins = [...plugins].sort((a, b) =>
    String(a.id).localeCompare(String(b.id)));

  for (const plugin of orderedPlugins) {
    if (!plugin.extra) plugin.extra = {};
    const repo = plugin.repo_full_name || '';
    const dir = pluginDir(plugin);

    // bundled_skills: colocated skills under the plugin dir.
    const repoSkills = skillsByRepo.get(repo) || [];
    const bundledSkills = repoSkills.filter((s) => isUnder(skillPath(s), dir));
    plugin.extra.bundled_skills = uniqSorted(bundledSkills.map((s) => s.id));

    // Inverse: each bundled skill records this plugin (sorted ascending).
    for (const s of bundledSkills) {
      if (!Array.isArray(s.bundled_in_plugins)) s.bundled_in_plugins = [];
      if (!s.bundled_in_plugins.includes(plugin.id)) {
        s.bundled_in_plugins.push(plugin.id);
      }
    }

    // bundled_mcp_servers: colocated mcp_server entities.
    const repoMcps = mcpsByRepo.get(repo) || [];
    plugin.extra.bundled_mcp_servers = uniqSorted(repoMcps.map((m) => m.id));

    // bundled_commands / bundled_hooks: mechanical from component name lists.
    plugin.extra.bundled_commands = uniqSorted(
      Array.isArray(plugin.extra.commands) ? plugin.extra.commands : [],
    );
    plugin.extra.bundled_hooks = uniqSorted(
      Array.isArray(plugin.extra.hooks) ? plugin.extra.hooks : [],
    );

    // bundled_agents: from existing component list OR manifest.agents.
    const manifestAgents = Array.isArray(plugin.extra?.manifest?.agents)
      ? plugin.extra.manifest.agents : [];
    const existingAgents = Array.isArray(plugin.extra.bundled_agents)
      ? plugin.extra.bundled_agents : [];
    plugin.extra.bundled_agents = uniqSorted(existingAgents.concat(manifestAgents));
  }

  // Final pass: sort each skill's inverse list for stable output.
  for (const s of skills) {
    s.bundled_in_plugins = uniqSorted(s.bundled_in_plugins);
  }

  return { plugins, skills, mcpServers };
}

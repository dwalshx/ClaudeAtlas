/**
 * scripts/lib/embedding-input/mcp.js — Phase 3.2 (D-09).
 *
 * MCP embedding-input builder:
 * `${name} | ${description} | transport=${transport} | tools: ${tools}`,
 * trimmed to ~200 chars. Well-formed even when transport is null.
 */

/**
 * @param {any} rec  v2 EntityRecord<McpExtra>.
 * @returns {string}
 */
export function buildMcpEmbeddingInput(rec) {
  const transport = rec?.extra?.transport ?? null;
  const tools = (rec?.extra?.tools || []).join(', ');
  const parts = [
    rec?.name || '',
    rec?.description || '',
    `transport=${transport}`,
    `tools: ${tools}`,
  ];
  return parts.join(' | ').slice(0, 200);
}

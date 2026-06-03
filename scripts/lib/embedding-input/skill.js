/**
 * scripts/lib/embedding-input/skill.js — Phase 3.2 (D-09).
 *
 * The skill embedding-input builder. Extracted VERBATIM from the inline
 * `buildEmbeddingInput` block in scripts/embed-skills.js so the registry
 * produces byte-identical input for skills (B-2 parity guard enforces
 * this against __tests__/legacy-skill-builder.js).
 */

function readBodyMarkdown(skill) {
  if (skill && skill.extra && typeof skill.extra.body_markdown === 'string') {
    return skill.extra.body_markdown;
  }
  return skill?.body_markdown || '';
}

/**
 * @param {any} skill  v2 EntityRecord<SkillExtra> (or legacy flat skill).
 * @returns {string} text sent to the embedding model.
 */
export function buildSkillEmbeddingInput(skill) {
  const parts = [
    skill.name,
    skill.description || '',
    skill.category || '',
    readBodyMarkdown(skill).slice(0, 1500),
  ].filter(Boolean);
  return parts.join('\n\n').slice(0, 6000);
}

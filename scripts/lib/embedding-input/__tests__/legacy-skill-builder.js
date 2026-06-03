/**
 * scripts/lib/embedding-input/__tests__/legacy-skill-builder.js
 *
 * DO NOT EDIT — frozen 2026-05-30 as the parity oracle for Task 4 /
 * Phase 3.2 Rev 2 (B-2). Editing this file invalidates the regression
 * guard that protects against silently re-embedding the 35k catalog
 * (~$0.22 + tier-1 rate-limit cost) on every refactor.
 *
 * This is a VERBATIM copy of the inline embedding-input construction
 * block in scripts/embed-skills.js as it stood on 2026-05-30 (the
 * `buildEmbeddingInput(skill)` + `readBodyMarkdown(skill)` functions).
 */

function readBodyMarkdown(skill) {
  if (skill && skill.extra && typeof skill.extra.body_markdown === 'string') {
    return skill.extra.body_markdown;
  }
  return skill?.body_markdown || '';
}

export function buildSkillEmbeddingInputLegacy(skill) {
  const parts = [
    skill.name,
    skill.description || '',
    skill.category || '',
    readBodyMarkdown(skill).slice(0, 1500),
  ].filter(Boolean);
  return parts.join('\n\n').slice(0, 6000);
}

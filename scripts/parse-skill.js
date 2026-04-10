/**
 * SKILL.md Parser
 *
 * Parses YAML frontmatter + markdown body from SKILL.md files.
 * Handles malformed frontmatter gracefully.
 */

import matter from 'gray-matter';

export function parseSkill(rawContent, filePath = '') {
  if (!rawContent || typeof rawContent !== 'string') {
    return null;
  }

  try {
    const { data: frontmatter, content: body } = matter(rawContent);

    // Extract name: from frontmatter, or from the file path
    const name = frontmatter.name
      || frontmatter.title
      || extractNameFromPath(filePath)
      || 'unknown-skill';

    // Extract description: from frontmatter, or from first paragraph of body
    const description = frontmatter.description
      || frontmatter.desc
      || extractFirstParagraph(body)
      || '';

    return {
      name: cleanName(name),
      description: cleanDescription(description),
      frontmatter,
      body: body.trim(),
    };
  } catch (err) {
    // Frontmatter parsing failed — try to extract what we can
    try {
      // Strip any broken frontmatter and treat entire content as body
      const strippedBody = rawContent.replace(/^---[\s\S]*?---\n?/, '');
      const name = extractNameFromPath(filePath) || 'unknown-skill';
      const description = extractFirstParagraph(strippedBody) || '';

      return {
        name: cleanName(name),
        description: cleanDescription(description),
        frontmatter: {},
        body: strippedBody.trim(),
      };
    } catch {
      return null;
    }
  }
}

function extractNameFromPath(filePath) {
  if (!filePath) return null;
  const parts = filePath.split('/');
  // "skills/my-skill/SKILL.md" -> "my-skill"
  if (parts.length >= 2) {
    const dir = parts[parts.length - 2];
    if (dir !== '.' && dir !== 'skills' && dir !== 'src') {
      return dir;
    }
  }
  return null;
}

function extractFirstParagraph(body) {
  if (!body) return '';
  // Skip headings, find first paragraph-like content
  const lines = body.split('\n');
  const textLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (textLines.length > 0) break;
      continue;
    }
    if (trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('```')) break;
    if (trimmed.startsWith('---')) continue;
    if (trimmed.startsWith('|')) continue;
    textLines.push(trimmed);
  }

  return textLines.join(' ').substring(0, 500);
}

function cleanName(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_.]/g, '')
    .substring(0, 64);
}

function cleanDescription(desc) {
  return String(desc)
    .trim()
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .substring(0, 1024);
}

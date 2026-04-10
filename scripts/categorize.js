/**
 * Category Assignment — Keyword-based mapping
 *
 * 8 categories matching the plan's taxonomy.
 * Input: skill name + description + repo topics
 * Fallback: "Productivity & Other"
 */

const CATEGORIES = {
  'Code & Development': [
    'debug', 'refactor', 'code-review', 'lint', 'format', 'git', 'commit',
    'merge', 'diff', 'snippet', 'ide', 'editor', 'coding', 'developer',
    'compile', 'syntax', 'clean-code', 'code-quality', 'review',
  ],
  'Web & Frontend': [
    'react', 'vue', 'svelte', 'angular', 'css', 'html', 'tailwind',
    'nextjs', 'next', 'nuxt', 'astro', 'component', 'ui', 'ux',
    'design', 'landing-page', 'frontend', 'web', 'responsive', 'sass',
    'styled', 'animation', 'layout', 'dom', 'browser',
  ],
  'Testing & QA': [
    'test', 'testing', 'jest', 'vitest', 'mocha', 'cypress', 'playwright',
    'e2e', 'unit-test', 'coverage', 'qa', 'assert', 'spec', 'tdd', 'bdd',
    'mock', 'fixture', 'snapshot', 'benchmark',
  ],
  'Data & Documents': [
    'pdf', 'xlsx', 'docx', 'csv', 'json', 'xml', 'yaml', 'data',
    'parse', 'transform', 'etl', 'pipeline', 'spreadsheet', 'document',
    'excel', 'word', 'powerpoint', 'pptx', 'markdown', 'md', 'file',
    'convert', 'extract', 'report', 'template',
  ],
  'DevOps & Infrastructure': [
    'docker', 'kubernetes', 'k8s', 'terraform', 'aws', 'gcp', 'azure',
    'cloud', 'ci', 'cd', 'deploy', 'devops', 'infrastructure', 'infra',
    'nginx', 'linux', 'server', 'monitoring', 'logging', 'helm',
    'ansible', 'vagrant', 'container', 'serverless', 'lambda',
  ],
  'API & Backend': [
    'api', 'rest', 'graphql', 'grpc', 'server', 'database', 'sql',
    'postgres', 'mysql', 'mongo', 'redis', 'backend', 'endpoint',
    'schema', 'migration', 'orm', 'prisma', 'supabase', 'firebase',
    'auth', 'middleware', 'route', 'express', 'fastify',
  ],
  'AI & Automation': [
    'llm', 'ai', 'claude', 'gpt', 'openai', 'anthropic', 'prompt',
    'agent', 'mcp', 'model', 'embedding', 'vector', 'rag', 'chain',
    'automation', 'workflow', 'bot', 'copilot', 'assistant', 'chat',
    'langchain', 'llama', 'transformer', 'fine-tune', 'train',
  ],
};

const DEFAULT_CATEGORY = 'Productivity & Other';

export function categorizeSkill(skill) {
  // Build search text from name + description + topics
  const searchText = [
    skill.name || '',
    skill.description || '',
    ...(skill.repo_topics || []),
    ...(skill.tags || []),
    skill.skill_path || '',
  ].join(' ').toLowerCase();

  // Score each category by keyword matches
  let bestCategory = DEFAULT_CATEGORY;
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORIES)) {
    let score = 0;
    for (const keyword of keywords) {
      if (searchText.includes(keyword)) {
        score++;
        // Bonus for name match (stronger signal)
        if ((skill.name || '').toLowerCase().includes(keyword)) {
          score += 2;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

export function getAllCategories() {
  return [...Object.keys(CATEGORIES), DEFAULT_CATEGORY];
}

export function getCategorySlug(category) {
  return category
    .toLowerCase()
    .replace(/[&]/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

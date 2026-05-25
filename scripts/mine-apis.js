#!/usr/bin/env node

/**
 * ClaudeAtlas API/Service Mining
 *
 * Scans every skill's name, description, body_markdown, repo_description,
 * and repo_topics for references to known APIs, services, and platforms.
 * Produces a bipartite graph: skills ↔ services.
 *
 * Approach: curated dictionary of ~120 well-known services with multiple
 * name variants per service (e.g., "openai" matches "openai", "open ai",
 * "gpt-4", "chatgpt", "dall-e"). Each match is scored by confidence
 * (exact name match > URL match > keyword-in-prose).
 *
 * Output: data/api-graph.json
 *   {
 *     "generated_at": "ISO 8601",
 *     "service_count": 45,
 *     "skill_count": 1078,
 *     "skills_with_integrations": 312,
 *     "services": {
 *       "openai": {
 *         "name": "OpenAI",
 *         "category": "AI",
 *         "url": "https://openai.com",
 *         "skill_count": 87,
 *         "skills": ["slug1", "slug2", ...]
 *       },
 *       ...
 *     },
 *     "skill_integrations": {
 *       "author/skill-slug": ["openai", "github", "slack"],
 *       ...
 *     }
 *   }
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadSkillsArray } from './lib/skills-stream.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
// T5: NDJSON. Reads use loadSkillsArray() (handles legacy fallback).
const SKILLS_PATH = join(ROOT, 'data', 'skills.ndjson');
const OUTPUT_PATH = join(ROOT, 'data', 'api-graph.json');

function log(msg) {
  console.log(`[api-mine] ${msg}`);
}

// --- Service dictionary ---
// Each entry: { id, name, category, url, patterns: string[] }
// patterns are matched case-insensitively against the combined text.
// To avoid false positives, short patterns (≤4 chars) require word boundaries.

const SERVICES = [
  // AI / ML
  { id: 'openai', name: 'OpenAI', category: 'AI', url: 'https://openai.com', patterns: ['openai', 'gpt-4', 'gpt-3', 'gpt4', 'chatgpt', 'dall-e', 'dall·e', 'whisper api', 'text-embedding'] },
  { id: 'anthropic', name: 'Anthropic', category: 'AI', url: 'https://anthropic.com', patterns: ['anthropic', 'claude api', 'claude-api', 'claude sdk'] },
  { id: 'huggingface', name: 'Hugging Face', category: 'AI', url: 'https://huggingface.co', patterns: ['hugging face', 'huggingface', 'transformers library'] },
  { id: 'replicate', name: 'Replicate', category: 'AI', url: 'https://replicate.com', patterns: ['replicate.com', 'replicate api'] },
  { id: 'stability-ai', name: 'Stability AI', category: 'AI', url: 'https://stability.ai', patterns: ['stability ai', 'stable diffusion', 'stability.ai'] },
  { id: 'cohere', name: 'Cohere', category: 'AI', url: 'https://cohere.com', patterns: ['cohere.com', 'cohere api', 'cohere embed'] },
  { id: 'langchain', name: 'LangChain', category: 'AI', url: 'https://langchain.com', patterns: ['langchain', 'langgraph'] },
  { id: 'ollama', name: 'Ollama', category: 'AI', url: 'https://ollama.com', patterns: ['ollama'] },
  { id: 'groq', name: 'Groq', category: 'AI', url: 'https://groq.com', patterns: ['groq.com', 'groq api'] },

  // Cloud platforms
  { id: 'aws', name: 'AWS', category: 'Cloud', url: 'https://aws.amazon.com', patterns: ['amazon web services', 'aws lambda', 'aws s3', 'aws ec2', 'aws sqs', 'aws sns', 'aws cloudformation', 'aws cdk', 'dynamodb', 'aws bedrock', 'amazon bedrock'] },
  { id: 'gcp', name: 'Google Cloud', category: 'Cloud', url: 'https://cloud.google.com', patterns: ['google cloud', 'gcp ', 'bigquery', 'cloud functions', 'cloud run', 'google vertex', 'vertex ai'] },
  { id: 'azure', name: 'Azure', category: 'Cloud', url: 'https://azure.microsoft.com', patterns: ['microsoft azure', 'azure ', 'azure devops', 'azure functions', 'azure openai'] },
  { id: 'cloudflare', name: 'Cloudflare', category: 'Cloud', url: 'https://cloudflare.com', patterns: ['cloudflare', 'workers ai', 'cloudflare d1', 'cloudflare r2'] },
  { id: 'vercel', name: 'Vercel', category: 'Cloud', url: 'https://vercel.com', patterns: ['vercel', 'vercel deploy', 'next.js deploy'] },
  { id: 'netlify', name: 'Netlify', category: 'Cloud', url: 'https://netlify.com', patterns: ['netlify'] },
  { id: 'supabase', name: 'Supabase', category: 'Cloud', url: 'https://supabase.com', patterns: ['supabase'] },
  { id: 'firebase', name: 'Firebase', category: 'Cloud', url: 'https://firebase.google.com', patterns: ['firebase', 'firestore', 'firebase auth'] },
  { id: 'heroku', name: 'Heroku', category: 'Cloud', url: 'https://heroku.com', patterns: ['heroku'] },
  { id: 'digitalocean', name: 'DigitalOcean', category: 'Cloud', url: 'https://digitalocean.com', patterns: ['digitalocean', 'digital ocean'] },
  { id: 'fly-io', name: 'Fly.io', category: 'Cloud', url: 'https://fly.io', patterns: ['fly.io', 'flyctl'] },
  { id: 'railway', name: 'Railway', category: 'Cloud', url: 'https://railway.app', patterns: ['railway.app', 'railway deploy'] },
  { id: 'render', name: 'Render', category: 'Cloud', url: 'https://render.com', patterns: ['render.com'] },
  { id: 'convex', name: 'Convex', category: 'Cloud', url: 'https://convex.dev', patterns: ['convex.dev', 'convex database', '@convex'] },
  { id: 'neon', name: 'Neon', category: 'Cloud', url: 'https://neon.tech', patterns: ['neon.tech', 'neon postgres', 'neondb'] },

  // Version control & CI/CD
  { id: 'github', name: 'GitHub', category: 'DevTools', url: 'https://github.com', patterns: ['github api', 'github actions', 'github issues', 'github pr', 'pull request', 'github repo', 'octokit'] },
  { id: 'gitlab', name: 'GitLab', category: 'DevTools', url: 'https://gitlab.com', patterns: ['gitlab'] },
  { id: 'bitbucket', name: 'Bitbucket', category: 'DevTools', url: 'https://bitbucket.org', patterns: ['bitbucket'] },
  { id: 'circleci', name: 'CircleCI', category: 'DevTools', url: 'https://circleci.com', patterns: ['circleci', 'circle ci'] },
  { id: 'jenkins', name: 'Jenkins', category: 'DevTools', url: 'https://jenkins.io', patterns: ['jenkins'] },

  // Communication
  { id: 'slack', name: 'Slack', category: 'Communication', url: 'https://slack.com', patterns: ['slack api', 'slack bot', 'slack webhook', 'slack integration'] },
  { id: 'discord', name: 'Discord', category: 'Communication', url: 'https://discord.com', patterns: ['discord bot', 'discord api', 'discord webhook'] },
  { id: 'telegram', name: 'Telegram', category: 'Communication', url: 'https://telegram.org', patterns: ['telegram bot', 'telegram api'] },
  { id: 'twilio', name: 'Twilio', category: 'Communication', url: 'https://twilio.com', patterns: ['twilio', 'sendgrid'] },
  { id: 'resend', name: 'Resend', category: 'Communication', url: 'https://resend.com', patterns: ['resend.com', 'resend api', 'resend email'] },

  // Payments & Commerce
  { id: 'stripe', name: 'Stripe', category: 'Payments', url: 'https://stripe.com', patterns: ['stripe api', 'stripe payment', 'stripe.com', 'stripe sdk'] },
  { id: 'shopify', name: 'Shopify', category: 'Commerce', url: 'https://shopify.com', patterns: ['shopify', 'shopify api', 'shopify liquid'] },

  // Databases
  { id: 'postgres', name: 'PostgreSQL', category: 'Database', url: 'https://postgresql.org', patterns: ['postgresql', 'postgres', 'psql', 'pg_'] },
  { id: 'mongodb', name: 'MongoDB', category: 'Database', url: 'https://mongodb.com', patterns: ['mongodb', 'mongoose', 'mongo atlas'] },
  { id: 'redis', name: 'Redis', category: 'Database', url: 'https://redis.io', patterns: ['redis', 'redis cache', 'redis pub'] },
  { id: 'mysql', name: 'MySQL', category: 'Database', url: 'https://mysql.com', patterns: ['mysql'] },
  { id: 'sqlite', name: 'SQLite', category: 'Database', url: 'https://sqlite.org', patterns: ['sqlite'] },
  { id: 'elasticsearch', name: 'Elasticsearch', category: 'Database', url: 'https://elastic.co', patterns: ['elasticsearch', 'elastic search', 'kibana'] },
  { id: 'pinecone', name: 'Pinecone', category: 'Database', url: 'https://pinecone.io', patterns: ['pinecone', 'pinecone.io'] },
  { id: 'weaviate', name: 'Weaviate', category: 'Database', url: 'https://weaviate.io', patterns: ['weaviate'] },
  { id: 'qdrant', name: 'Qdrant', category: 'Database', url: 'https://qdrant.tech', patterns: ['qdrant'] },
  { id: 'chromadb', name: 'ChromaDB', category: 'Database', url: 'https://trychroma.com', patterns: ['chromadb', 'chroma db', 'trychroma'] },

  // Monitoring & observability
  { id: 'datadog', name: 'Datadog', category: 'Monitoring', url: 'https://datadoghq.com', patterns: ['datadog', 'datadoghq'] },
  { id: 'sentry', name: 'Sentry', category: 'Monitoring', url: 'https://sentry.io', patterns: ['sentry.io', 'sentry error', 'sentry sdk'] },
  { id: 'grafana', name: 'Grafana', category: 'Monitoring', url: 'https://grafana.com', patterns: ['grafana', 'grafana dashboard'] },
  { id: 'posthog', name: 'PostHog', category: 'Analytics', url: 'https://posthog.com', patterns: ['posthog'] },

  // Containers & orchestration
  { id: 'docker', name: 'Docker', category: 'Infrastructure', url: 'https://docker.com', patterns: ['dockerfile', 'docker compose', 'docker build', 'docker image', 'containerize'] },
  { id: 'kubernetes', name: 'Kubernetes', category: 'Infrastructure', url: 'https://kubernetes.io', patterns: ['kubernetes', 'kubectl', 'k8s ', 'helm chart'] },
  { id: 'terraform', name: 'Terraform', category: 'Infrastructure', url: 'https://terraform.io', patterns: ['terraform', 'hashicorp terraform'] },

  // Frontend frameworks (as "services" the skill integrates with)
  { id: 'react', name: 'React', category: 'Frontend', url: 'https://react.dev', patterns: ['react component', 'react hook', 'react app', 'reactjs', 'react.js', 'jsx ', 'tsx '] },
  { id: 'nextjs', name: 'Next.js', category: 'Frontend', url: 'https://nextjs.org', patterns: ['next.js', 'nextjs', 'next app router', 'next/image'] },
  { id: 'vue', name: 'Vue.js', category: 'Frontend', url: 'https://vuejs.org', patterns: ['vue.js', 'vuejs', 'vue component', 'nuxt'] },
  { id: 'svelte', name: 'Svelte', category: 'Frontend', url: 'https://svelte.dev', patterns: ['svelte', 'sveltekit'] },
  { id: 'angular', name: 'Angular', category: 'Frontend', url: 'https://angular.dev', patterns: ['angular component', 'angular module', 'angular.dev', '@angular'] },
  { id: 'tailwindcss', name: 'Tailwind CSS', category: 'Frontend', url: 'https://tailwindcss.com', patterns: ['tailwind css', 'tailwindcss', 'tailwind classes'] },

  // Backend frameworks
  { id: 'fastapi', name: 'FastAPI', category: 'Backend', url: 'https://fastapi.tiangolo.com', patterns: ['fastapi', 'fast api'] },
  { id: 'express', name: 'Express.js', category: 'Backend', url: 'https://expressjs.com', patterns: ['express.js', 'expressjs', 'express server', 'express middleware'] },
  { id: 'django', name: 'Django', category: 'Backend', url: 'https://djangoproject.com', patterns: ['django', 'djangorestframework'] },
  { id: 'flask', name: 'Flask', category: 'Backend', url: 'https://flask.palletsprojects.com', patterns: ['flask app', 'flask api', 'flask server'] },
  { id: 'rails', name: 'Ruby on Rails', category: 'Backend', url: 'https://rubyonrails.org', patterns: ['ruby on rails', 'rails app', 'rails api'] },
  { id: 'spring', name: 'Spring', category: 'Backend', url: 'https://spring.io', patterns: ['spring boot', 'spring framework', 'spring mvc'] },
  { id: 'laravel', name: 'Laravel', category: 'Backend', url: 'https://laravel.com', patterns: ['laravel', 'laravel artisan'] },

  // Testing
  { id: 'jest', name: 'Jest', category: 'Testing', url: 'https://jestjs.io', patterns: ['jest test', 'jest.config', 'jest mock', 'jest setup'] },
  { id: 'vitest', name: 'Vitest', category: 'Testing', url: 'https://vitest.dev', patterns: ['vitest', 'vitest config'] },
  { id: 'playwright', name: 'Playwright', category: 'Testing', url: 'https://playwright.dev', patterns: ['playwright', 'playwright test'] },
  { id: 'cypress', name: 'Cypress', category: 'Testing', url: 'https://cypress.io', patterns: ['cypress.io', 'cypress test', 'cypress e2e'] },
  { id: 'pytest', name: 'pytest', category: 'Testing', url: 'https://docs.pytest.org', patterns: ['pytest', 'py.test'] },

  // Data & analytics
  { id: 'notion', name: 'Notion', category: 'Productivity', url: 'https://notion.so', patterns: ['notion api', 'notion.so', 'notion database', 'notion page'] },
  { id: 'airtable', name: 'Airtable', category: 'Productivity', url: 'https://airtable.com', patterns: ['airtable'] },
  { id: 'linear', name: 'Linear', category: 'Productivity', url: 'https://linear.app', patterns: ['linear.app', 'linear api', 'linear issue'] },
  { id: 'jira', name: 'Jira', category: 'Productivity', url: 'https://atlassian.com/jira', patterns: ['jira ', 'jira api', 'jira issue', 'atlassian jira'] },

  // CMS
  { id: 'wordpress', name: 'WordPress', category: 'CMS', url: 'https://wordpress.org', patterns: ['wordpress', 'wp-admin', 'wp_'] },
  { id: 'sanity', name: 'Sanity', category: 'CMS', url: 'https://sanity.io', patterns: ['sanity.io', 'sanity cms', 'sanity studio'] },
  { id: 'contentful', name: 'Contentful', category: 'CMS', url: 'https://contentful.com', patterns: ['contentful'] },

  // Auth
  { id: 'auth0', name: 'Auth0', category: 'Auth', url: 'https://auth0.com', patterns: ['auth0'] },
  { id: 'clerk', name: 'Clerk', category: 'Auth', url: 'https://clerk.com', patterns: ['clerk.com', 'clerk auth', '@clerk'] },
  { id: 'oauth', name: 'OAuth', category: 'Auth', url: 'https://oauth.net', patterns: ['oauth 2', 'oauth2', 'oauth token', 'openid connect'] },

  // MCP
  { id: 'mcp', name: 'Model Context Protocol', category: 'AI', url: 'https://modelcontextprotocol.io', patterns: ['mcp server', 'mcp tool', 'model context protocol', 'mcp integration'] },

  // Other services
  { id: 'npm', name: 'npm', category: 'DevTools', url: 'https://npmjs.com', patterns: ['npm publish', 'npm package', 'npm install', 'npmjs'] },
  { id: 'graphql', name: 'GraphQL', category: 'API', url: 'https://graphql.org', patterns: ['graphql', 'graphql query', 'graphql schema', 'graphql mutation'] },
  { id: 'rest-api', name: 'REST API', category: 'API', url: '', patterns: ['rest api', 'restful api', 'rest endpoint'] },
  { id: 'websocket', name: 'WebSocket', category: 'API', url: '', patterns: ['websocket', 'web socket', 'socket.io'] },
  { id: 'grpc', name: 'gRPC', category: 'API', url: 'https://grpc.io', patterns: ['grpc', 'protocol buffers', 'protobuf'] },
];

// --- Matching ---

function buildSearchText(skill) {
  const parts = [
    skill.name || '',
    skill.description || '',
    skill.body_markdown || '',
    skill.repo_description || '',
    (skill.repo_topics || []).join(' '),
  ];
  return parts.join(' ').toLowerCase();
}

function findIntegrations(searchText) {
  const found = new Set();
  for (const service of SERVICES) {
    for (const pattern of service.patterns) {
      const pat = pattern.toLowerCase();
      // For very short patterns (≤4 chars), require word boundary
      if (pat.length <= 4) {
        const regex = new RegExp(`\\b${pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (regex.test(searchText)) {
          found.add(service.id);
          break;
        }
      } else {
        if (searchText.includes(pat)) {
          found.add(service.id);
          break;
        }
      }
    }
  }
  return [...found];
}

// --- Main ---

function main() {
  log('=== API mining start ===');

  // T5: loadSkillsArray() handles NDJSON + legacy fallback.
  let skills;
  try {
    skills = loadSkillsArray();
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
  log(`loaded ${skills.length} skills`);

  const serviceSkillMap = {}; // service_id → Set<slug>
  const skillIntegrations = {}; // slug → [service_ids]
  let skillsWithIntegrations = 0;

  for (const skill of skills) {
    if (!skill.slug) continue;
    const text = buildSearchText(skill);
    const integrations = findIntegrations(text);

    if (integrations.length > 0) {
      skillsWithIntegrations++;
      skillIntegrations[skill.slug] = integrations;

      for (const serviceId of integrations) {
        if (!serviceSkillMap[serviceId]) serviceSkillMap[serviceId] = new Set();
        serviceSkillMap[serviceId].add(skill.slug);
      }
    }
  }

  // Build service summaries
  const services = {};
  for (const svc of SERVICES) {
    const skillSet = serviceSkillMap[svc.id];
    if (!skillSet || skillSet.size === 0) continue;
    services[svc.id] = {
      name: svc.name,
      id: svc.id,
      category: svc.category,
      url: svc.url,
      skill_count: skillSet.size,
      skills: [...skillSet].sort(),
    };
  }

  // Sort services by skill_count descending
  const sortedServices = Object.values(services).sort((a, b) => b.skill_count - a.skill_count);

  const output = {
    generated_at: new Date().toISOString(),
    service_count: Object.keys(services).length,
    skill_count: skills.length,
    skills_with_integrations: skillsWithIntegrations,
    integration_rate: Math.round((skillsWithIntegrations / skills.length) * 100),
    services,
    skill_integrations: skillIntegrations,
    top_services: sortedServices.slice(0, 20).map(s => ({ id: s.id, name: s.name, category: s.category, skill_count: s.skill_count })),
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
  log(`wrote ${OUTPUT_PATH}`);
  log(`${Object.keys(services).length} services detected across ${skillsWithIntegrations} skills (${output.integration_rate}%)`);
  log('');
  log('top 20 services:');
  for (const s of sortedServices.slice(0, 20)) {
    log(`  ${s.skill_count.toString().padStart(4)} × ${s.name} (${s.category})`);
  }
  log('=== API mining complete ===');
}

main();

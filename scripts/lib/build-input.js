/**
 * Resolves the NDJSON data file path for build-time consumers.
 *
 * Order of precedence:
 *   1. SKILLS_NDJSON_OVERRIDE env var (test/smoke escape hatch — T2, T11)
 *   2. CI: expect data/skills.ndjson, throw if missing (workflow's Restore step is responsible)
 *   3. Local dev: prefer data/skills.ndjson, fall back to legacy data/skills.json during transition
 *
 * After T5 ships, the legacy JSON fallback is dropped (T5 cleanup commit).
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

export function resolveSkillsNdjsonPath() {
  // 1. Override
  if (process.env.SKILLS_NDJSON_OVERRIDE) {
    return process.env.SKILLS_NDJSON_OVERRIDE;
  }

  const ndjson = join(REPO_ROOT, 'data', 'skills.ndjson');

  // 2. CI: NDJSON must be restored from workflow cache/release before build runs
  if (process.env.CI === 'true') {
    if (!existsSync(ndjson)) {
      throw new Error(
        `[build-input] CI mode but ${ndjson} missing. The workflow's "Restore skill-vectors cache" or "Fetch skills-latest release asset" step must run before build.`
      );
    }
    return ndjson;
  }

  // 3. Local dev — prefer NDJSON, fall back to legacy JSON during transition
  if (existsSync(ndjson)) return ndjson;

  const legacyJson = join(REPO_ROOT, 'data', 'skills.json');
  if (existsSync(legacyJson)) {
    console.warn(
      `[build-input] ${ndjson} not found; falling back to legacy ${legacyJson}. This fallback is dropped in T5 cleanup.`
    );
    return legacyJson;
  }

  throw new Error(
    `[build-input] Neither ${ndjson} nor ${legacyJson} found. Run \`npm run filter\` to generate skills data.`
  );
}

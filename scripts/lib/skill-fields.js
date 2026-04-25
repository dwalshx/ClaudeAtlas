/**
 * ClaudeAtlas — canonical skill field lists.
 *
 * TRACK1_FRESHNESS_FIELDS: fields refreshed daily by Track 1 (Star Pulse)
 * via GET /repos/{owner}/{name}. Filter.js prefers these from the existing
 * skills.json over whatever skills-raw.json contains, then re-scores.
 *
 * Per C11 of 3.0.0-PLAN-CHECK: expanded from 6 to 11 fields. Same API
 * response, zero extra cost. Closes a freshness gap on
 * topics/license/language/description/default_branch.
 */
export const TRACK1_FRESHNESS_FIELDS = [
  'repo_stars',
  'repo_forks',
  'repo_open_issues',
  'repo_pushed_at',
  'repo_updated_at',
  'repo_archived',
  'repo_topics',
  'repo_license',
  'repo_language',
  'repo_description',
  'repo_default_branch',
];

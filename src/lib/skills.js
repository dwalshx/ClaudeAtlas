/**
 * LEGACY SHIM — F2 cutover window (D+0 → D+7), DELETED in cutover commit.
 *
 * Phase 3.1.2 — Polymorphic Entity Envelope.
 *
 * src/lib/entities.js is the source of truth from F2 onward. This shim
 * re-exports every helper from entities.js so unmigrated consumers
 * (those still importing from '../lib/skills.js') keep working through
 * the cutover window. New code MUST import from '../lib/entities.js'.
 *
 * Imports that route through this shim are caught by
 * scripts/lint-no-legacy-skill-shape.js (warning today, error on D+7).
 */

export {
  // Polymorphic API
  loadEntities,
  getEntitiesByType,
  getEntityById,
  getTopEntities,
  getEntitiesByTag,
  getAllTags,

  // Skill-scoped (back-compat)
  allSkills,
  getSkills,
  getSkillBySlug,
  getFeaturedSkills,
  capPerRepo,
  getSkillsByCategory,
  getAllCategories,
  getCategorySlug,
  getCategoryFromSlug,
  getStats,
  getPipelineStats,
  getCreators,
  getCreatorByUsername,
  getCreatorLeaderboards,
  getCreatorsForBrowse,
  getRelatedSkills,
  getApiGraph,
  getAllServices,
  getServiceById,
  getSkillIntegrations,
  getSimilarSkills,
  timeAgo,
  tierColor,
  categoryColor,
} from './entities.js';

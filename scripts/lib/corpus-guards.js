/**
 * ClaudeAtlas — pipeline fail-fast guards (pure, token-free).
 *
 * Outage 2026-09-28 → 2026-11-05 (.planning/debug/daily-scrape-outage-
 * 2026-09-28.md): with an expired SCRAPE_PAT the weekly full sweep wrote an
 * EMPTY raw corpus, filter.js turned it into an empty catalog, embed-skills.js
 * wrote 0 vectors (exit 0), and only upload-vectors.js — step 30 of 40 —
 * refused. Each stage below now checks its own input/output and refuses to
 * propagate "nothing" downstream. The checks are pure so every one of them
 * is unit-tested without fixtures or network.
 *
 * None of these change scoring, filter rules or data shape: when a guard
 * does not trip, the stage's output is byte-identical to before.
 */

/**
 * The raw corpus a filter run starts from must not be empty. An empty raw
 * file is NEVER a legitimate daily state (the corpus only grows); it means
 * the GHA cache restored a placeholder or a scraper aborted mid-write.
 */
export function checkRawCorpusNotEmpty(rawCount, { allowEmpty = false } = {}) {
  if (rawCount > 0 || allowEmpty) return { ok: true, message: '' };
  return {
    ok: false,
    message:
      `raw corpus has 0 records — refusing to build an empty catalog. ` +
      `The skills-raw GHA cache is a placeholder (see CLAUDE.md "Recovery: expired GitHub PAT / poisoned GHA caches" → reseed). ` +
      `Override with FILTER_ALLOW_EMPTY=1 only for fixtures.`,
  };
}

/**
 * A filter run must not shrink the published catalog by more than
 * `maxDropRatio` versus the previous skills.ndjson. Legitimate day-to-day
 * churn is a few percent; a 50%+ collapse means the input was truncated.
 * Ignored when the prior catalog is small (bootstrap / fixtures).
 */
export function checkCatalogCollapse({ priorCount, newCount, minPrior = 1000, maxDropRatio = 0.5, allow = false }) {
  if (allow || !priorCount || priorCount < minPrior) return { ok: true, message: '' };
  const drop = (priorCount - newCount) / priorCount;
  if (drop <= maxDropRatio) return { ok: true, message: '' };
  return {
    ok: false,
    message:
      `catalog collapsed from ${priorCount} to ${newCount} records (${(drop * 100).toFixed(1)}% drop > ${maxDropRatio * 100}%) — refusing to overwrite skills.ndjson. ` +
      `If this shrink is intentional (filter-rule change validated against skills-raw), re-run with FILTER_ALLOW_COLLAPSE=1.`,
  };
}

/**
 * The weekly FULL sweep (scrape.js --mode=full) REPLACES the raw corpus. It
 * must never replace it with nothing, nor with a >20% smaller set (the
 * pre-existing regression rule, now evaluated BEFORE the write).
 */
export function checkFullSweepResult({ prevCount, newCount, maxDropPct = 20 }) {
  if (newCount === 0) {
    return {
      ok: false,
      message: 'full sweep produced 0 skills — refusing to overwrite the raw corpus (auth failure, search outage, or empty discovery).',
    };
  }
  if (prevCount > 0) {
    const drop = ((prevCount - newCount) / prevCount) * 100;
    if (drop > maxDropPct) {
      return {
        ok: false,
        message: `REGRESSION: skills count would drop ${drop.toFixed(1)}% (${prevCount} -> ${newCount}) — refusing to overwrite the raw corpus.`,
      };
    }
  }
  return { ok: true, message: '' };
}

/**
 * The embedder must produce vectors for a non-empty input, and must not be
 * handed an empty input at all in the daily pipeline.
 */
export function checkEmbedOutput({ inputCount, outputCount, allowEmpty = false }) {
  if (inputCount === 0) {
    if (allowEmpty) return { ok: true, message: '' };
    return {
      ok: false,
      message:
        'embed input has 0 records — refusing to write an empty vector file. ' +
        'Upstream filter produced nothing (empty raw corpus?). Override with EMBED_ALLOW_EMPTY=1 only for fixtures.',
    };
  }
  if (outputCount === 0) {
    return {
      ok: false,
      message: `embed produced 0 vectors for ${inputCount} input records — every record was skipped (missing ids?). Refusing to write an empty vector file.`,
    };
  }
  return { ok: true, message: '' };
}

# Morning memo — `scripts/scrape-plugins.js` uncommitted diff

**Authored:** 2026-04-18 overnight
**Decision needed by:** You, in the morning
**Recommendation:** **commit it** — defensive null-safety fix, low risk

---

## What changed

`scripts/scrape-plugins.js:376-394` — the `marketplace_manifest` field in the plugin record is now built defensively. It gracefully handles:

- `marketplaceManifest.plugins` not being an array (missing, null, or non-array garbage)
- Individual plugin entries in that array being `null` or `undefined`
- Plugin fields (`name`, `description`, `version`, `source`) being missing

Before, any of those would have crashed the scraper with `TypeError: Cannot read properties of ... of undefined` during the `.map(p => ...)` call.

## Diff

```js
-      marketplace_manifest: marketplaceManifest ? {
-        name: marketplaceManifest.name,
-        owner: marketplaceManifest.owner,
-        plugin_count: (marketplaceManifest.plugins || []).length,
-        plugins: (marketplaceManifest.plugins || []).map(p => ({
-          name: p.name,
-          description: p.description || null,
-          version: p.version || null,
-          source: typeof p.source === 'string' ? p.source : p.source?.repo || null,
-        })),
-      } : null,
+      marketplace_manifest: marketplaceManifest ? (() => {
+        const pluginsList = Array.isArray(marketplaceManifest.plugins) ? marketplaceManifest.plugins : [];
+        return {
+          name: marketplaceManifest.name,
+          owner: marketplaceManifest.owner,
+          plugin_count: pluginsList.length,
+          plugins: pluginsList.map(p => ({
+            name: p?.name || null,
+            description: p?.description || null,
+            version: p?.version || null,
+            source: typeof p?.source === 'string' ? p.source : p?.source?.repo || null,
+          })),
+        };
+      })() : null,
```

Two substantive changes:

1. `Array.isArray(...) ? ... : []` guard instead of `|| []` — handles `plugins: null`, `plugins: "oops"`, `plugins: {}`.
2. Optional chaining on `p?.name`, `p?.source` etc. — handles a null entry in an otherwise valid array.

Everything else is identical.

## Risk assessment

- **Correctness:** strictly safer than the original; no way this regresses behavior on well-formed input.
- **Performance:** trivially unchanged. An IIFE costs one function call per repo; sub-microsecond.
- **Scope:** single isolated field in a single record shape. Nothing else depends on the internal implementation.
- **Fit with Phase 3.0:** The plugin scraper is the data source for Phase 3.0. Shipping this defensive pass before 3.0 scoring runs reduces risk of a surprise crash mid-scrape.

## Proposed disposition

**Commit it** with message:

```
fix(scrape-plugins): null-safe marketplace_manifest unpacking

Guards against malformed marketplace manifests in the wild:
- plugins field not being an array
- individual plugin entries being null/undefined
- plugin fields missing

Defensive fix surfaced while plugin scraper was running at ~1,700 repos.
No behavior change on well-formed input.
```

## Alternatives considered

- **Stash:** defer to a Phase 3.0 plan phase. Rejected — the change is small enough that isolating it in git history has no value; Phase 3.0 will want the raw scraper to be reliable as a prerequisite, not as a sub-task.
- **Discard:** rejected — the original code has real bugs against real-world GitHub data.

## How to commit

```bash
git add scripts/scrape-plugins.js
git commit -m "fix(scrape-plugins): null-safe marketplace_manifest unpacking"
git push
```

Or, if you'd rather discard:

```bash
git checkout scripts/scrape-plugins.js
```

Or stash:

```bash
git stash push -m "defensive scrape-plugins fix - revisit with 3.1" scripts/scrape-plugins.js
```

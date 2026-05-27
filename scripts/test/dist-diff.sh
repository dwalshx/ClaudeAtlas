#!/usr/bin/env bash
# scripts/test/dist-diff.sh — F2 T11 Smoke C
#
# Builds the site twice (pre + post current branch state), diffs dist/.
# Acceptable noise: whitespace, sitemap last-mod timestamps, data-tags attribute
# additions, file-content-hash filename suffixes for assets.
#
# Usage:
#   bash scripts/test/dist-diff.sh
#
# Pre-condition: working tree is on the F2 branch with all changes committed.
# The script checks out a "before" reference (defaults to main) into a worktree,
# builds it, comes back, builds the current ref, diffs.

set -euo pipefail

BEFORE_REF="${BEFORE_REF:-main}"
ROOT="$(pwd)"
WORK_BEFORE="$ROOT/.dist-diff-before"
WORK_AFTER="$ROOT/.dist-diff-after"

cleanup() {
  git worktree remove --force "$WORK_BEFORE" 2>/dev/null || true
  rm -rf "$WORK_AFTER"
}
trap cleanup EXIT

echo "[dist-diff] Building BEFORE ref ($BEFORE_REF) in worktree..."
rm -rf "$WORK_BEFORE"
git worktree add --detach "$WORK_BEFORE" "$BEFORE_REF" >/dev/null
(
  cd "$WORK_BEFORE"
  if [[ -f package.json ]]; then
    npm install --no-audit --no-fund --silent
    npm run build --silent
  fi
)
mv "$WORK_BEFORE/dist" "$WORK_AFTER.before" || { echo "[dist-diff] BEFORE build produced no dist/"; exit 1; }

echo "[dist-diff] Building AFTER ref (current HEAD)..."
rm -rf dist
npm run build --silent
mv dist "$WORK_AFTER.after"

echo "[dist-diff] Diffing dist (excluding hashed assets + sitemap timestamps)..."
DIFF_OUT=$(diff -ruN \
  --exclude='_astro' \
  --exclude='*.map' \
  --exclude='sitemap-*.xml' \
  --exclude='sitemap-index.xml' \
  "$WORK_AFTER.before" "$WORK_AFTER.after" \
  | grep -vE '^(Only in .*_astro|---|\+\+\+|@@)' \
  | grep -E '^[+-]' \
  | grep -vE '^[+-]\s*<!-- ' \
  | grep -vE 'data-tags=' \
  || true)

PRE_COUNT=$(find "$WORK_AFTER.before" -type f | wc -l)
POST_COUNT=$(find "$WORK_AFTER.after"  -type f | wc -l)
echo "[dist-diff] file count: before=$PRE_COUNT  after=$POST_COUNT"
awk -v p=$PRE_COUNT -v q=$POST_COUNT 'BEGIN{
  if (p == 0) { print "[dist-diff] ERROR: empty BEFORE dist"; exit 2 }
  d=(q-p)/p; if (d<0) d=-d;
  printf "[dist-diff] file count delta: %.3f%%\n", d*100;
  if (d > 0.01) { print "[dist-diff] FAIL: file count delta exceeds ±1% (F4 sub-assertion)"; exit 1 }
}'

if [[ -z "$DIFF_OUT" ]]; then
  echo "[dist-diff] PASS: dist diff is empty modulo documented attributes."
  exit 0
else
  echo "[dist-diff] DIFF DETECTED:"
  echo "$DIFF_OUT" | head -50
  echo "[dist-diff] (first 50 lines shown — see WORK_AFTER paths for full diff)"
  exit 1
fi

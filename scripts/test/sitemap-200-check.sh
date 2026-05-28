#!/usr/bin/env bash
# scripts/test/sitemap-200-check.sh — F2 T11 Smoke G / B5 / DOD-9.
#
# Picks 100 random URLs from data/regression-sitemap-urls.txt, swaps the
# host to $PREVIEW_URL (passed as $1), curls each, asserts HTTP 200.
#
# Usage:
#   bash scripts/test/sitemap-200-check.sh https://claudeatlas-preview.danthedub.workers.dev

set -euo pipefail

PREVIEW="${1:-}"
if [[ -z "$PREVIEW" ]]; then
  echo "Usage: $0 <preview-base-url>"
  exit 2
fi
PREVIEW="${PREVIEW%/}"

BASELINE="data/regression-sitemap-urls.txt"
if [[ ! -f "$BASELINE" ]]; then
  echo "[200-check] FAIL: missing $BASELINE"
  exit 2
fi

SAMPLE=$(shuf -n 100 "$BASELINE")
N=$(echo "$SAMPLE" | wc -l)
PASS=0
FAIL_LIST=""
echo "[200-check] Sweeping $N URLs against $PREVIEW ..."

while IFS= read -r ORIG; do
  [[ -z "$ORIG" ]] && continue
  # Replace scheme+host with $PREVIEW, preserve path+query.
  PATH_AND_QUERY=$(echo "$ORIG" | sed -E 's@^https?://[^/]+@@')
  TARGET="${PREVIEW}${PATH_AND_QUERY}"
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -L "$TARGET" || echo "ERR")
  if [[ "$CODE" == "200" ]]; then
    PASS=$((PASS + 1))
  else
    FAIL_LIST="${FAIL_LIST}\n  $CODE  $TARGET"
  fi
done <<< "$SAMPLE"

echo "[200-check] $PASS/$N returned HTTP 200"
if [[ "$PASS" -eq "$N" ]]; then
  echo "[200-check] PASS"
  exit 0
else
  echo -e "[200-check] FAIL — non-200 responses:${FAIL_LIST}" | head -30
  exit 1
fi

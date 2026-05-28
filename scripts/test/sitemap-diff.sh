#!/usr/bin/env bash
# scripts/test/sitemap-diff.sh — F2 T11 Smoke F / B5 / DOD-9.
#
# Extracts <loc> URLs from dist/sitemap-0.xml after a build and asserts:
#   every URL in data/regression-sitemap-urls.txt also appears in the
#   post-F2 sitemap. Additions are OK; removals are FAIL.
#
# Usage:
#   bash scripts/test/sitemap-diff.sh
#
# Pre-condition: `npm run build` has produced dist/sitemap-0.xml AND
# data/regression-sitemap-urls.txt exists (captured by T2).

set -euo pipefail

BASELINE="data/regression-sitemap-urls.txt"
POST="dist/sitemap-0.xml"

if [[ ! -f "$BASELINE" ]]; then
  echo "[sitemap-diff] FAIL: missing baseline $BASELINE — run capture-regression-fixtures.js first."
  exit 2
fi
if [[ ! -f "$POST" ]]; then
  echo "[sitemap-diff] FAIL: missing $POST — run \`npm run build\` first."
  exit 2
fi

POST_URLS=$(mktemp)
trap 'rm -f "$POST_URLS"' EXIT

node -e "
const fs = require('node:fs');
const xml = fs.readFileSync('$POST', 'utf8');
const urls = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map(m => m[1].trim());
process.stdout.write([...new Set(urls)].sort().join('\n') + '\n');
" > "$POST_URLS"

MISSING=$(comm -23 <(sort -u "$BASELINE") <(sort -u "$POST_URLS"))

if [[ -z "$MISSING" ]]; then
  BASELINE_N=$(wc -l < "$BASELINE")
  POST_N=$(wc -l < "$POST_URLS")
  echo "[sitemap-diff] PASS: every baseline URL present (baseline=$BASELINE_N, post=$POST_N)."
  exit 0
else
  N=$(echo "$MISSING" | wc -l)
  echo "[sitemap-diff] FAIL: $N URL(s) in baseline are missing from post-F2 sitemap."
  echo "$MISSING" | head -20
  exit 1
fi

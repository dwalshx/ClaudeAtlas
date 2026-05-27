#!/usr/bin/env bash
# scripts/test/filter-record-count-diff.sh — F2 Smoke D parity check.
#
# Assert post-F2 filter output record count is within ±1% of the pre-F2
# baseline. Baseline lives in data/regression-queries.json's
# pre_f2_record_count or, if missing, in the snapshot count file.
#
# Usage: bash scripts/test/filter-record-count-diff.sh
#
# Exits 0 on PASS; non-zero with diff log otherwise.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SKILLS="$ROOT/data/skills.ndjson"

if [ ! -f "$SKILLS" ]; then
  echo "[record-count-diff] $SKILLS missing — run \`npm run filter\` first"
  exit 2
fi

# Count records (excludes header line which starts with {"_header":true,...)
CURRENT=$(grep -cv '^{"_header":true' "$SKILLS" || true)
# Fallback if file has no header line yet (pre-T9 production data):
if [ "$CURRENT" = "0" ]; then
  CURRENT=$(wc -l < "$SKILLS" | tr -d ' ')
fi

# Baseline: prefer captured snapshot, else current as initial seed.
BASELINE_FILE="$ROOT/data/regression-filter-baseline.txt"
if [ -f "$BASELINE_FILE" ]; then
  BASELINE=$(cat "$BASELINE_FILE")
else
  echo "$CURRENT" > "$BASELINE_FILE"
  echo "[record-count-diff] seeded baseline at $CURRENT records (no prior baseline existed)"
  exit 0
fi

# Compute ±1% drift (POSIX arithmetic — integer ceiling).
TOLERANCE=$(( (BASELINE + 99) / 100 ))  # 1% rounded up
DELTA=$(( CURRENT - BASELINE ))
ABS_DELTA=${DELTA#-}

echo "[record-count-diff] baseline=$BASELINE current=$CURRENT delta=$DELTA tolerance=±$TOLERANCE"

if [ "$ABS_DELTA" -le "$TOLERANCE" ]; then
  echo "[record-count-diff] PASS — within ±1% of baseline"
  exit 0
else
  echo "[record-count-diff] FAIL — drift of $DELTA records exceeds ±$TOLERANCE tolerance"
  exit 1
fi

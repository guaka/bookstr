#!/usr/bin/env bash
set -euo pipefail

count=${1:-}
if [[ $# -ne 1 || ! "$count" =~ ^[1-9][0-9]?$ ]]; then
  echo 'Usage: combine-shard-coverage.sh <shard-count: 1-99>' >&2
  exit 2
fi
coverage_dir=android/app/build/coverage
rm -f "$coverage_dir/full.ec"
for ((index=0; index<count; index++)); do
  for input in "$coverage_dir/shard-$index/full.ec" \
    "$coverage_dir/shard-$index/native/native-coverage-collected.marker" \
    "android/e2e-results/shard-$index/instrumentation.xml"; do
    if [[ ! -s "$input" ]]; then
      echo "Missing Android shard input: $input" >&2
      exit 1
    fi
  done
done
if ! find android/e2e-screenshots -type f -name '*.png' -print -quit | grep -q .; then
  echo 'Android shards produced no screenshots' >&2
  exit 1
fi
# JaCoCo accepts concatenated execution-data streams and merges matching classes.
# Keep all native profiles under shard-specific paths to avoid PID/name collisions.
temporary=$(mktemp "$coverage_dir/full.ec.XXXXXX")
trap 'rm -f "$temporary"' EXIT
for ((index=0; index<count; index++)); do
  cat "$coverage_dir/shard-$index/full.ec" >> "$temporary"
done
mv "$temporary" "$coverage_dir/full.ec"

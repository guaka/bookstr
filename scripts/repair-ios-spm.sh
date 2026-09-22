#!/bin/bash
# Repair corrupted Xcode SourcePackages checkouts that break package resolution.
# Safe to run before xcodebuild when SPM fails with "not a git repository" or
# similar cache corruption under DerivedData/SourcePackages.
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
derived=${1:-${DERIVED_DATA_PATH:-$repo/ios/.derivedData-device}}
packages="$derived/SourcePackages"

if [ ! -d "$packages" ]; then
  echo "No SourcePackages at $packages — nothing to repair."
  exit 0
fi

repaired=0
# Broken clone directories under repositories/ often lose .git and poison resolve.
if [ -d "$packages/repositories" ]; then
  while IFS= read -r dir; do
    [ -d "$dir" ] || continue
    if [ ! -d "$dir/.git" ] && [ ! -f "$dir/HEAD" ]; then
      echo "Removing broken package checkout: $dir"
      rm -rf "$dir"
      repaired=$((repaired + 1))
    fi
  done < <(find "$packages/repositories" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)
fi

# Stale workspace-state can keep pointing at deleted checkouts.
if [ "$repaired" -gt 0 ]; then
  rm -f "$packages/workspace-state.json"
  echo "Repaired $repaired SourcePackages checkout(s)."
else
  echo "SourcePackages checkouts look intact."
fi

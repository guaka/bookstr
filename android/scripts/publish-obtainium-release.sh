#!/usr/bin/env bash
set -euo pipefail

: "${RUN_NUMBER:?RUN_NUMBER is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

version="0.0.3-ci.$RUN_NUMBER"
tag="v$version"
apk="android/bookstr-$version.apk"
asset_name="bookstr-$version.apk"

if [[ ! -s "$apk" ]]; then
  echo "Release APK is missing or empty: $apk" >&2
  exit 1
fi

release_assets() {
  gh release view "$tag" --json assets --jq '.assets[] | [.name, .size] | @tsv'
}

asset_size() {
  awk -F '\t' -v expected="$asset_name" '$1 == expected { print $2; exit }' <<<"$1"
}

if assets="$(release_assets 2>/dev/null)"; then
  size="$(asset_size "$assets")"
  if [[ "$size" =~ ^[0-9]+$ ]] && (( size > 0 )); then
    echo "Release $tag already has a nonempty $asset_name asset."
    exit 0
  fi

  if [[ -n "$size" ]]; then
    echo "Replacing empty $asset_name asset on release $tag."
    gh release upload "$tag" "$apk" --clobber
  else
    echo "Adding missing $asset_name asset to release $tag."
    gh release upload "$tag" "$apk"
  fi
else
  gh release create "$tag" "$apk" \
    --target "$GITHUB_SHA" --title "Bookstr Android $version" --latest \
    --notes "Automatic Android build from $GITHUB_SHA. Add https://github.com/$GITHUB_REPOSITORY to Obtainium to receive updates."
fi

if ! assets="$(release_assets)"; then
  echo "Could not verify release $tag after publishing." >&2
  exit 1
fi
size="$(asset_size "$assets")"
if [[ ! "$size" =~ ^[0-9]+$ ]] || (( size == 0 )); then
  echo "Release $tag does not contain a nonempty $asset_name asset." >&2
  exit 1
fi

echo "Verified $asset_name on release $tag ($size bytes)."

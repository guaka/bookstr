#!/usr/bin/env bash
set -euo pipefail

: "${RUN_NUMBER:?RUN_NUMBER is required}"
: "${RUN_ID:?RUN_ID is required}"
: "${RELEASE_VERSION:?RELEASE_VERSION is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
version="$RELEASE_VERSION"
version_code=$((1000000000 + RUN_NUMBER))
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

set_latest_option() {
  local latest_android_run_number
  latest_android_run_number="$(
    gh api --paginate "repos/$GITHUB_REPOSITORY/releases?per_page=100" \
      --jq '[.[] | select(.draft == false and .prerelease == false) | {tagName: .tag_name, body}]' \
      | jq -s 'add // []' \
      | node --input-type=module -e '
        import { readFileSync } from "node:fs";
        const { latestPublishedAndroidRunNumber } = await import(process.argv[1]);
        process.stdout.write(String(latestPublishedAndroidRunNumber(JSON.parse(readFileSync(0, "utf8")))));
      ' "$script_directory/android-release-version.mjs"
  )"
  if (( RUN_NUMBER > latest_android_run_number )); then
    latest_option=--latest
  else
    latest_option=--latest=false
  fi
}

draft=false
if assets="$(release_assets 2>/dev/null)"; then
  release_state="$(gh release view "$tag" --json isDraft,body --jq 'if .isDraft then "draft\n" + .body else "published" end')"
  if [[ "$release_state" != published ]]; then
    if ! grep -Fxq "Bookstr Android workflow run ID: $RUN_ID" <<<"$release_state"; then
      echo "Refusing to publish a draft owned by another run: $tag" >&2
      exit 1
    fi
    draft=true
  fi
  size="$(asset_size "$assets")"
  if [[ "$size" =~ ^[0-9]+$ ]] && (( size > 0 )); then
    echo "Release $tag already has a nonempty $asset_name asset."
    if [[ "$draft" == false ]]; then exit 0; fi
  elif [[ -n "$size" ]]; then
    echo "Replacing empty $asset_name asset on release $tag."
    gh release upload "$tag" "$apk" --clobber
  else
    echo "Adding missing $asset_name asset to release $tag."
    gh release upload "$tag" "$apk"
  fi
else
  set_latest_option
  gh release create "$tag" "$apk" \
    --target "$GITHUB_SHA" --title "Bookstr Android $version" "$latest_option" \
    --notes "Automatic Android build from $GITHUB_SHA. Add https://github.com/$GITHUB_REPOSITORY to Obtainium to receive updates.
Bookstr Android workflow run ID: $RUN_ID
Bookstr Android run number: $RUN_NUMBER
Bookstr Android version code: $version_code"
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

if [[ "$draft" == true ]]; then
  set_latest_option
  gh release edit "$tag" --draft=false "$latest_option"
fi

echo "Verified $asset_name on release $tag ($size bytes)."

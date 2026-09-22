#!/bin/bash
# Ensure ios/TorrentEngine/TorrentEngine.xcframework is present and usable.
# The XCFramework is gitignored and built locally/CI; device builds must not
# depend on SwiftPM resolving a missing local binaryTarget.
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
fw="$repo/ios/TorrentEngine/TorrentEngine.xcframework"

torrent_framework_ok() {
  [ -f "$fw/Info.plist" ] \
    && [ -f "$fw/ios-arm64/TorrentEngine.framework/TorrentEngine" ] \
    && [ -f "$fw/ios-arm64/TorrentEngine.framework/Modules/module.modulemap" ] \
    && [ -f "$fw/ios-arm64_x86_64-simulator/TorrentEngine.framework/TorrentEngine" ] \
    && [ -f "$fw/ios-arm64_x86_64-simulator/TorrentEngine.framework/Modules/module.modulemap" ]
}

if torrent_framework_ok; then
  echo "TorrentEngine.xcframework is ready."
  exit 0
fi

echo "TorrentEngine.xcframework missing or incomplete — building…"
if [ -d "$fw" ]; then
  rm -rf "$fw"
fi

export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
if [ -z "${BOOST_ROOT:-}" ] && command -v brew >/dev/null 2>&1; then
  BOOST_ROOT="$(brew --prefix boost 2>/dev/null || true)"
  export BOOST_ROOT
fi
if [ -z "${BOOST_ROOT:-}" ] || [ ! -d "${BOOST_ROOT}/include" ]; then
  echo "BOOST_ROOT is required to build TorrentEngine (brew install boost)." >&2
  exit 1
fi

"$repo/scripts/build-ios-torrent.sh"

if ! torrent_framework_ok; then
  echo "build-ios-torrent.sh finished but TorrentEngine.xcframework is still incomplete." >&2
  exit 1
fi

echo "TorrentEngine.xcframework built."

#!/bin/bash
# Build BookstrIOS (Debug) and install+launch on a physical device.
#
# Usage:
#   scripts/install-ios-ip2.sh            # device name "ip2"
#   scripts/install-ios-ip2.sh awu2       # another device name
#   DEVICE_UDID=00008130-... scripts/install-ios-ip2.sh
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
ios="$repo/ios"
device_name=${1:-${DEVICE_NAME:-ip2}}
team=${DEVELOPMENT_TEAM:-SUJ594N47C}
bundle_id=${BUNDLE_ID:-app.bookstr.ios}
derived="${DERIVED_DATA_PATH:-$ios/.derivedData-device}"
app="$derived/Build/Products/Debug-iphoneos/BookstrIOS.app"

export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}

if [ ! -d "$DEVELOPER_DIR" ]; then
  echo "Xcode not found at $DEVELOPER_DIR" >&2
  exit 1
fi

"$repo/scripts/ensure-ios-torrent.sh"
"$repo/scripts/repair-ios-spm.sh" "$derived"

cd "$ios"

build_bookstr() {
  xcodebuild -skipPackagePluginValidation \
    -project BookstrIOS.xcodeproj \
    -scheme BookstrIOS \
    -destination "platform=iOS,name=$device_name" \
    -configuration Debug \
    -derivedDataPath "$derived" \
    DEVELOPMENT_TEAM="$team" \
    CODE_SIGN_STYLE=Automatic \
    build
}

echo "==> Building BookstrIOS for $device_name"
if ! build_bookstr; then
  echo "==> Build failed — repairing SourcePackages and retrying once"
  "$repo/scripts/repair-ios-spm.sh" "$derived"
  # Drop only corrupted repository checkouts; keep compiled artifacts when possible.
  rm -rf "$derived/SourcePackages/repositories"
  rm -f "$derived/SourcePackages/workspace-state.json"
  build_bookstr
fi

if [ ! -d "$app" ]; then
  echo "Build finished but app not found at $app" >&2
  exit 1
fi

device_arg=${DEVICE_UDID:-$device_name}

echo "==> Installing on $device_arg"
xcrun devicectl device install app --device "$device_arg" "$app"

echo "==> Launching $bundle_id"
xcrun devicectl device process launch --device "$device_arg" "$bundle_id" --terminate-existing

echo "Done."

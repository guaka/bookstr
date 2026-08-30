#!/usr/bin/env bash

set -uo pipefail

readonly device_screenshot_dir='/sdcard/e2e-screenshots'
readonly host_screenshot_dir='android/e2e-screenshots'

mkdir -p "$host_screenshot_dir"

set +e
(
  cd android
  ./gradlew --no-daemon connectedDebugAndroidTest
)
status=$?
set -e

adb pull "$device_screenshot_dir/." "$host_screenshot_dir" || true
if ! find "$host_screenshot_dir" -type f -name '*.png' -print -quit | grep -q .; then
  echo 'Android e2e tests produced no screenshots' >&2
  status=1
fi

exit "$status"

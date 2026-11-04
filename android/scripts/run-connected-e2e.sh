#!/usr/bin/env bash

set -uo pipefail

readonly device_screenshot_dir='/sdcard/e2e-screenshots'
readonly host_screenshot_dir='android/e2e-screenshots'
readonly results_dir='android/e2e-results'

usage() {
  echo 'Usage: run-connected-e2e.sh [--prebuilt APP_APK TEST_APK]' >&2
}

prebuilt=false
if [[ "${1:-}" == '--prebuilt' ]]; then
  if [[ $# -ne 3 ]]; then usage; exit 2; fi
  prebuilt=true
  app_apk=$2
  test_apk=$3
elif [[ $# -ne 0 ]]; then
  usage
  exit 2
fi

mkdir -p "$host_screenshot_dir" "$results_dir"
# Remove results from an earlier local invocation so artifacts always describe
# this run. The device screenshot directory is cleared only after the emulator
# check below.
rm -f "$results_dir/instrumentation.log" "$results_dir/instrumentation.xml" "$results_dir/instrumentation.started"
find "$host_screenshot_dir" -type f -name '*.png' -delete
readonly adb_path="${ANDROID_HOME:+$ANDROID_HOME/platform-tools/}adb"

# This check must happen before install: instrumentation can modify app-local data.
bash "$(dirname "$0")/require-emulator.sh" "$adb_path" || exit $?

status=0
instrument_status=0
parser_status=0
if $prebuilt; then
  if [[ ! -f "$app_apk" || ! -f "$test_apk" ]]; then
    echo 'Both prebuilt app and instrumentation APKs must exist.' >&2
    status=1
  elif ! "$adb_path" install -r "$app_apk"; then
    echo 'Could not install prebuilt app APK.' >&2
    status=1
  elif ! "$adb_path" install -r "$test_apk"; then
    echo 'Could not install prebuilt instrumentation APK.' >&2
    status=1
  fi
  if [[ $status -eq 0 ]]; then
    "$adb_path" shell rm -rf "$device_screenshot_dir" || status=1
  fi
  if [[ $status -eq 0 ]]; then
    log_file="$results_dir/instrumentation.log"
    junit_file="$results_dir/instrumentation.xml"
    : > "$results_dir/instrumentation.started"
    set +e
    "$adb_path" shell am instrument -w -r app.bookstr.test/androidx.test.runner.AndroidJUnitRunner 2>&1 | tee "$log_file"
    instrument_status=${PIPESTATUS[0]}
    node "$(dirname "$0")/instrumentation-results.mjs" "$log_file" "$junit_file"
    parser_status=$?
    set -e
    if [[ $instrument_status -ne 0 || $parser_status -ne 0 ]]; then status=1; fi
  fi
else
  set +e
  (cd android && ./gradlew --no-daemon connectedDebugAndroidTest)
  status=$?
  set -e
fi

# Pull screenshots on passing and failing runs, even when installation or
# instrumentation fails. Screenshot errors must not hide the original status.
"$adb_path" pull "$device_screenshot_dir/." "$host_screenshot_dir" || true
if ! find "$host_screenshot_dir" -type f -name '*.png' -print -quit | grep -q .; then
  echo 'Android e2e tests produced no screenshots' >&2
  status=1
fi

exit "$status"

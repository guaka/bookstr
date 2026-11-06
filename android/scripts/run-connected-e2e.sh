#!/usr/bin/env bash

set -uo pipefail

readonly device_screenshot_dir='/sdcard/e2e-screenshots'
readonly host_screenshot_dir='android/e2e-screenshots'
readonly results_dir='android/e2e-results'
readonly device_coverage_file='/data/user/0/app.bookstr/files/bookstr-coverage.ec'

usage() {
  echo 'Usage: run-connected-e2e.sh [--prebuilt APP_APK TEST_APK]' >&2
  echo 'Set BOOKSTR_COVERAGE_FILE to save fresh emulator coverage from prebuilt mode.' >&2
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
coverage_file="${BOOKSTR_COVERAGE_FILE:-}"
if [[ -n "$coverage_file" && "$prebuilt" != true ]]; then
  echo 'BOOKSTR_COVERAGE_FILE requires --prebuilt APP_APK TEST_APK.' >&2
  exit 2
fi
if [[ -n "$coverage_file" ]]; then
  # A previous report at this caller-selected destination must never be
  # mistaken for output from the current invocation when validation or pull fails.
  if ! rm -f -- "$coverage_file"; then
    echo "Could not clear previous coverage output: $coverage_file" >&2
    exit 1
  fi
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
coverage_tmp=''
coverage_prepared=false
coverage_instrument_attempted=false
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
  if [[ $status -eq 0 && -n "$coverage_file" ]]; then
    coverage_dir=$(dirname -- "$coverage_file")
    if ! mkdir -p "$coverage_dir"; then
      echo "Could not create coverage output directory: $coverage_dir" >&2
      status=1
    else
      coverage_tmp=$(mktemp "${coverage_file}.tmp.XXXXXX") || status=1
      if [[ $status -eq 0 ]]; then
        if "$adb_path" shell run-as app.bookstr rm -f files/bookstr-coverage.ec; then
          coverage_prepared=true
        else
          echo 'Could not clear old emulator coverage data.' >&2
          status=1
        fi
      fi
    fi
  fi
  if [[ $status -eq 0 ]]; then
    log_file="$results_dir/instrumentation.log"
    junit_file="$results_dir/instrumentation.xml"
    : > "$results_dir/instrumentation.started"
    set +e
    if [[ -n "$coverage_file" ]]; then
      coverage_instrument_attempted=true
      "$adb_path" shell am instrument -w -r -e coverage true -e coverageFile "$device_coverage_file" app.bookstr.test/app.bookstr.BookstrTestRunner 2>&1 | tee "$log_file"
    else
      "$adb_path" shell am instrument -w -r app.bookstr.test/app.bookstr.BookstrTestRunner 2>&1 | tee "$log_file"
    fi
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

# The device copy was removed after safety validation and APK installation. Pull
# even after test/parser failures so partial coverage is retained, while keeping
# those failures in status and rejecting failed or empty pulls.
if [[ -n "$coverage_file" && "$coverage_prepared" == true && "$coverage_instrument_attempted" == true ]]; then
  coverage_pull_status=0
  set +e
  "$adb_path" exec-out run-as app.bookstr cat files/bookstr-coverage.ec > "$coverage_tmp"
  coverage_pull_status=$?
  set -e
  if [[ $coverage_pull_status -ne 0 ]]; then
    echo 'Could not pull fresh emulator coverage data.' >&2
    status=1
  elif [[ ! -s "$coverage_tmp" ]]; then
    echo 'Emulator produced an empty coverage file.' >&2
    status=1
  elif ! mv -f -- "$coverage_tmp" "$coverage_file"; then
    echo "Could not atomically save emulator coverage to $coverage_file." >&2
    status=1
  fi
  rm -f -- "$coverage_tmp"
fi

# Pull screenshots on passing and failing runs, even when installation or
# instrumentation fails. Screenshot errors must not hide the original status.
"$adb_path" pull "$device_screenshot_dir/." "$host_screenshot_dir" || true
if ! find "$host_screenshot_dir" -type f -name '*.png' -print -quit | grep -q .; then
  echo 'Android e2e tests produced no screenshots' >&2
  status=1
fi

exit "$status"

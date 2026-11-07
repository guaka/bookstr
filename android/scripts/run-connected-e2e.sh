#!/usr/bin/env bash

set -uo pipefail

readonly device_screenshot_dir='/sdcard/e2e-screenshots'
readonly device_coverage_file='/data/user/0/app.bookstr/files/bookstr-coverage.ec'

usage() {
  echo 'Usage: run-connected-e2e.sh [--prebuilt APP_APK TEST_APK]' >&2
  echo 'Set BOOKSTR_COVERAGE_FILE and/or BOOKSTR_NATIVE_PROFILE_OUTPUT to save fresh emulator coverage from prebuilt mode.' >&2
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
# AndroidJUnitRunner partitions the discovered suite, including newly added tests.
shard_args=()
shard_suffix=''
native_collection_args=()
if [[ -n "${BOOKSTR_SHARD_INDEX:-}${BOOKSTR_SHARD_COUNT:-}" ]]; then
  if [[ "$prebuilt" != true || ! "${BOOKSTR_SHARD_COUNT:-}" =~ ^[1-9][0-9]?$ || ! "${BOOKSTR_SHARD_INDEX:-}" =~ ^(0|[1-9][0-9]?)$ ]] || (( BOOKSTR_SHARD_INDEX >= BOOKSTR_SHARD_COUNT )); then
    echo 'Sharding requires prebuilt mode, a count from 1 to 99, and an index from 0 to count-1.' >&2
    exit 2
  fi
  shard_args=(-e numShards "$BOOKSTR_SHARD_COUNT" -e shardIndex "$BOOKSTR_SHARD_INDEX")
  shard_suffix="/shard-$BOOKSTR_SHARD_INDEX"
  # Some shards never load the JNI library. The aggregate report still requires profiles.
  native_collection_args=(--allow-empty)
fi
readonly host_screenshot_dir="android/e2e-screenshots$shard_suffix"
readonly results_dir="android/e2e-results$shard_suffix"
coverage_file="${BOOKSTR_COVERAGE_FILE:-}"
if [[ -n "$coverage_file" && "$prebuilt" != true ]]; then
  echo 'BOOKSTR_COVERAGE_FILE requires --prebuilt APP_APK TEST_APK.' >&2
  exit 2
fi
native_profile_output="${BOOKSTR_NATIVE_PROFILE_OUTPUT:-}"
if [[ -n "$native_profile_output" && "$prebuilt" != true ]]; then
  echo 'BOOKSTR_NATIVE_PROFILE_OUTPUT requires --prebuilt APP_APK TEST_APK.' >&2
  exit 2
fi
native_profile_marker=''
if [[ -n "$native_profile_output" ]]; then
  if ! mkdir -p -- "$native_profile_output"; then
    echo "Could not create native profile output directory: $native_profile_output" >&2
    exit 1
  fi
  native_profile_marker="$native_profile_output/native-coverage-collected.marker"
  if ! rm -f -- "$native_profile_marker"; then
    echo "Could not clear native coverage collection marker: $native_profile_marker" >&2
    exit 1
  fi
  if [[ -e "$native_profile_output/raw" ]]; then
    echo "Refusing to overwrite existing native profiles: $native_profile_output/raw" >&2
    exit 1
  fi
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
rm -f "$results_dir/instrumentation.log" "$results_dir/instrumentation.xml" "$results_dir/instrumentation.started" "$results_dir/current-test.txt" "$results_dir/discovery.log" "$results_dir/test-selection.txt" "$results_dir/test-selection.txt.json"
find "$host_screenshot_dir" -type f -name '*.png' -delete
readonly adb_path="${ANDROID_HOME:+$ANDROID_HOME/platform-tools/}adb"

# This check must happen before install: instrumentation can modify app-local data.
bash "$(dirname "$0")/require-emulator.sh" "$adb_path" || exit $?

# These are bounded diagnostics from an emulator already checked by require-emulator.
collect_failure_diagnostics() {
  local result=$?
  if [[ $result -ne 0 ]]; then
    node "$(dirname "$0")/ci-instrumentation.mjs" diagnostics "$adb_path" "$results_dir" || true
  fi
  return "$result"
}
native_device_serial=''
if [[ -n "$native_profile_output" ]]; then
  if [[ -n "${ANDROID_SERIAL:-}" ]]; then
    native_device_serial=$ANDROID_SERIAL
  else
    native_device_serial=$("$adb_path" get-serialno)
  fi
  if [[ "$native_device_serial" != emulator-* ]]; then
    echo "Native coverage requires the selected Android emulator; refusing serial: ${native_device_serial:-unknown}" >&2
    exit 1
  fi
fi

trap collect_failure_diagnostics EXIT
trap 'exit 143' TERM

status=0
instrument_status=0
parser_status=0
coverage_tmp=''
coverage_prepared=false
coverage_instrument_attempted=false
native_coverage_prepared=false
native_coverage_instrument_attempted=false
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
  if [[ $status -eq 0 && -n "$native_profile_output" ]]; then
    if ! bash "$(dirname "$0")/prepare-native-coverage.sh" "$adb_path" "$native_device_serial" app.bookstr; then
      status=1
    else
      native_coverage_prepared=true
    fi
  fi
  if [[ $status -eq 0 && -n "${BOOKSTR_SHARD_TIMINGS:-}" ]]; then
    if [[ -z "$shard_suffix" ]]; then
      echo 'Duration-based selection requires BOOKSTR_SHARD_COUNT and BOOKSTR_SHARD_INDEX.' >&2
      status=1
    elif ! "$adb_path" shell am instrument -w -r -e log true app.bookstr.test/app.bookstr.BookstrTestRunner > "$results_dir/discovery.log" 2>&1; then
      status=1
    elif ! node "$(dirname "$0")/ci-instrumentation.mjs" plan "$results_dir/discovery.log" "$BOOKSTR_SHARD_TIMINGS" "$BOOKSTR_SHARD_INDEX" "$BOOKSTR_SHARD_COUNT" "$results_dir/test-selection.txt"; then
      status=1
    else
      # adb shell parses its arguments again on the device. Preserve nested-class '$'.
      shard_args=(-e class "'$(cat "$results_dir/test-selection.txt")'")
    fi
  fi
  if [[ $status -eq 0 ]]; then
    log_file="$results_dir/instrumentation.log"
    junit_file="$results_dir/instrumentation.xml"
    : > "$results_dir/instrumentation.started"
    set +e
    if [[ -n "$native_profile_output" ]]; then native_coverage_instrument_attempted=true; fi
    if [[ -n "$coverage_file" ]]; then
      coverage_instrument_attempted=true
      "$adb_path" shell am instrument -w -r -e coverage true -e coverageFile "$device_coverage_file" ${shard_args[@]+"${shard_args[@]}"} app.bookstr.test/app.bookstr.BookstrTestRunner 2>&1 | node "$(dirname "$0")/ci-instrumentation.mjs" stream "$results_dir/current-test.txt" | tee "$log_file"
    else
      "$adb_path" shell am instrument -w -r ${shard_args[@]+"${shard_args[@]}"} app.bookstr.test/app.bookstr.BookstrTestRunner 2>&1 | node "$(dirname "$0")/ci-instrumentation.mjs" stream "$results_dir/current-test.txt" | tee "$log_file"
    fi
    pipeline_status=("${PIPESTATUS[@]}")
    for code in "${pipeline_status[@]}"; do
      if [[ $code -ne 0 ]]; then instrument_status=1; fi
    done
    node "$(dirname "$0")/instrumentation-results.mjs" "$log_file" "$junit_file"
    parser_status=$?
    if [[ -n "${BOOKSTR_SHARD_TIMINGS:-}" ]] && ! node "$(dirname "$0")/ci-instrumentation.mjs" verify "$log_file" "$results_dir/test-selection.txt"; then
      status=1
    fi
    set -e
    if [[ $instrument_status -ne 0 || $parser_status -ne 0 ]]; then status=1; fi
  fi
else
  set +e
  (cd android && ./gradlew --no-daemon connectedDebugAndroidTest)
  status=$?
  set -e
fi

if [[ -n "$native_profile_output" && "$native_coverage_prepared" == true && "$native_coverage_instrument_attempted" == true ]]; then
  if ! bash "$(dirname "$0")/collect-native-coverage.sh" "$adb_path" "$native_device_serial" app.bookstr "$native_profile_output" ${native_collection_args[@]+"${native_collection_args[@]}"}; then
    echo 'Could not collect fresh native coverage profiles.' >&2
    status=1
  else
    marker_status=0
    marker_tmp=''
    marker_tmp=$(mktemp "$native_profile_marker.tmp.XXXXXX") || marker_status=1
    if [[ $marker_status -eq 0 ]] && printf 'collected\n' > "$marker_tmp" && mv -f -- "$marker_tmp" "$native_profile_marker"; then
      :
    else
      echo 'Could not publish native coverage collection marker.' >&2
      [[ -z "$marker_tmp" ]] || rm -f -- "$marker_tmp"
      status=1
    fi
  fi
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
if [[ -z "$shard_suffix" ]] && ! find "$host_screenshot_dir" -type f -name '*.png' -print -quit | grep -q .; then
  echo 'Android e2e tests produced no screenshots' >&2
  status=1
fi

exit "$status"

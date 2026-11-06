#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
fake_app=$temporary/app
mkdir -p "$fake_app/cache" "$fake_app/files/torrent-downloads"
printf 'cache-profile' > "$fake_app/cache/bookstr-native-coverage-123.profraw"
printf 'download-profile' > "$fake_app/files/torrent-downloads/bookstr-native-coverage-123.profraw"
printf 'unrelated-data' > "$fake_app/files/torrent-downloads/book.torrent"
printf 'unrelated-profile' > "$fake_app/files/torrent-downloads/default.profraw"

fake_adb=$temporary/adb
cat > "$fake_adb" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == -s ]] || exit 2
serial=$2
shift 2
case "$1" in
    get-state)
        [[ "$serial" == emulator-* ]] && echo device
        ;;
    shell)
        shift
        [[ "$1" == run-as && "$2" == app.bookstr && "$3" == find ]] || exit 3
        remote_dir=$4
        if [[ "${FAKE_FAIL_FIND:-}" == "$remote_dir" ]]; then
            find "$FAKE_APP/$remote_dir" -type f -name "$8" 2>/dev/null | sed "s#^$FAKE_APP/##" || true
            exit 7
        fi
        find "$FAKE_APP/$remote_dir" -type f -name "$8" 2>/dev/null | sed "s#^$FAKE_APP/##" || true
        ;;
    exec-out)
        shift
        [[ "$1" == run-as && "$2" == app.bookstr && "$3" == cat ]] || exit 4
        if [[ "${FAKE_FAIL_PULL:-}" == "$4" ]]; then
            head -c 4 "$FAKE_APP/$4"
            exit 8
        fi
        cat "$FAKE_APP/$4"
        ;;
    *) exit 5 ;;
esac
EOF
chmod +x "$fake_adb"

output=$temporary/collected
FAKE_APP=$fake_app bash "$script_dir/collect-native-coverage.sh" "$fake_adb" emulator-5554 app.bookstr "$output"
[[ "$(cat "$output/raw/cache/bookstr-native-coverage-123.profraw")" == cache-profile ]]
[[ "$(cat "$output/raw/files/torrent-downloads/bookstr-native-coverage-123.profraw")" == download-profile ]]
[[ ! -e "$output/raw/files/torrent-downloads/book.torrent" ]]
[[ ! -e "$output/raw/files/torrent-downloads/default.profraw" ]]

if FAKE_APP=$fake_app bash "$script_dir/collect-native-coverage.sh" "$fake_adb" physical-device app.bookstr "$temporary/physical" >/dev/null 2>&1; then
    echo 'Physical device was not rejected' >&2
    exit 1
fi

if FAKE_APP=$fake_app bash "$script_dir/collect-native-coverage.sh" "$fake_adb" emulator-5554 app.bookstr "$output" >/dev/null 2>&1; then
    echo 'Existing raw profile directory was not protected' >&2
    exit 1
fi

empty=$temporary/empty-app
mkdir -p "$empty/cache" "$empty/files/torrent-downloads"
if FAKE_APP=$empty bash "$script_dir/collect-native-coverage.sh" "$fake_adb" emulator-5554 app.bookstr "$temporary/empty-output" >/dev/null 2>&1; then
    echo 'Missing native profiles were accepted' >&2
    exit 1
fi
[[ ! -e "$temporary/empty-output/raw" ]]

failed_find=$temporary/failed-find-output
if FAKE_APP=$fake_app FAKE_FAIL_FIND=files/torrent-downloads bash "$script_dir/collect-native-coverage.sh" "$fake_adb" emulator-5554 app.bookstr "$failed_find" >/dev/null 2>&1; then
    echo 'A failed profile listing was accepted' >&2
    exit 1
fi
[[ ! -e "$failed_find/raw" ]]
[[ -z "$(find "$failed_find" -maxdepth 1 -name '.raw-staging.*' -print -quit)" ]]

failed_pull=$temporary/failed-pull-output
if FAKE_APP=$fake_app FAKE_FAIL_PULL=files/torrent-downloads/bookstr-native-coverage-123.profraw bash "$script_dir/collect-native-coverage.sh" "$fake_adb" emulator-5554 app.bookstr "$failed_pull" >/dev/null 2>&1; then
    echo 'A partial profile pull was accepted' >&2
    exit 1
fi
[[ ! -e "$failed_pull/raw" ]]
[[ -z "$(find "$failed_pull" -maxdepth 1 -name '.raw-staging.*' -print -quit)" ]]

# A shard with no JNI tests may be empty; the combined native report is mandatory.
FAKE_APP=$empty bash "$script_dir/collect-native-coverage.sh" "$fake_adb" emulator-5554 app.bookstr "$temporary/empty-shard" --allow-empty
[[ -d "$temporary/empty-shard/raw" ]]
if FAKE_APP=$fake_app FAKE_FAIL_FIND=cache bash "$script_dir/collect-native-coverage.sh" "$fake_adb" emulator-5554 app.bookstr "$temporary/broken-empty-shard" --allow-empty; then
    echo 'An empty shard must not hide failed adb operations' >&2
    exit 1
fi
if bash "$script_dir/collect-native-coverage.sh" "$fake_adb" emulator-5554 app.bookstr "$temporary/invalid" --typo; then
    echo 'Unknown collection options must fail' >&2
    exit 1
fi

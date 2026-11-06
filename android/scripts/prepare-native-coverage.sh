#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
    echo "Usage: $0 <adb> <emulator-serial> <application-id>" >&2
    exit 2
fi

adb_path=$1
serial=$2
package=$3
if [[ "$serial" != emulator-* ]]; then
    echo "Refusing native profile cleanup on non-emulator device: $serial" >&2
    exit 1
fi
if [[ ! "$package" =~ ^[A-Za-z0-9_.]+$ ]]; then
    echo "Invalid Android application id: $package" >&2
    exit 2
fi
state=$("$adb_path" -s "$serial" get-state)
if [[ "$state" != device ]]; then
    echo "Android emulator is not ready: $serial ($state)" >&2
    exit 1
fi

profiles=()
for remote_dir in cache files/torrent-downloads; do
    if ! remote_paths=$("$adb_path" -s "$serial" shell run-as "$package" find "$remote_dir" -type f -name 'bookstr-native-coverage-*.profraw'); then
        echo "Could not list old native profiles under $remote_dir on $serial" >&2
        exit 1
    fi
    while IFS= read -r remote_path; do
        [[ -z "$remote_path" ]] && continue
        case "$remote_path" in
            cache/*|files/torrent-downloads/*) ;;
            *) echo "Unexpected app-private profile path: $remote_path" >&2; exit 1 ;;
        esac
        case "/$remote_path/" in
            *"/../"*|*"/./"*) echo "Unsafe app-private profile path: $remote_path" >&2; exit 1 ;;
        esac
        if [[ "${remote_path##*/}" != bookstr-native-coverage-*.profraw ]]; then
            echo "Refusing to remove a non-coverage file: $remote_path" >&2
            exit 1
        fi
        profiles+=("$remote_path")
    done <<< "$remote_paths"
done

for remote_path in "${profiles[@]}"; do
    "$adb_path" -s "$serial" shell run-as "$package" rm "$remote_path"
done

for remote_dir in cache files/torrent-downloads; do
    if ! leftovers=$("$adb_path" -s "$serial" shell run-as "$package" find "$remote_dir" -type f -name 'bookstr-native-coverage-*.profraw'); then
        echo "Could not verify native profile cleanup under $remote_dir on $serial" >&2
        exit 1
    fi
    if [[ -n "${leftovers//$'\r'/}" ]]; then
        echo "Native profiles remain under $remote_dir on $serial: $leftovers" >&2
        exit 1
    fi
done

echo "Cleared ${#profiles[@]} stale native profile(s) on $serial"

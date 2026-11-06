#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 && ( $# -ne 5 || "${5:-}" != --allow-empty ) ]]; then
    echo "Usage: $0 <adb> <emulator-serial> <application-id> <empty-output-directory> [--allow-empty]" >&2
    exit 2
fi

adb_path=$1
serial=$2
package=$3
output_dir=$4

if [[ "$serial" != emulator-* ]]; then
    echo "Refusing native profile collection from non-emulator device: $serial" >&2
    exit 1
fi
if [[ ! "$package" =~ ^[A-Za-z0-9_.]+$ ]]; then
    echo "Invalid Android application id: $package" >&2
    exit 2
fi
if [[ -e "$output_dir/raw" ]]; then
    echo "Refusing to overwrite existing native profiles: $output_dir/raw" >&2
    exit 1
fi

state=$("$adb_path" -s "$serial" get-state)
if [[ "$state" != device ]]; then
    echo "Android emulator is not ready: $serial ($state)" >&2
    exit 1
fi

mkdir -p "$output_dir"
staging_dir=$(mktemp -d "$output_dir/.raw-staging.XXXXXX")
cleanup() { rm -rf "$staging_dir"; }
trap cleanup EXIT
count=0
for remote_dir in cache files/torrent-downloads; do
    if ! remote_paths=$("$adb_path" -s "$serial" shell run-as "$package" find "$remote_dir" -type f -name 'bookstr-native-coverage-*.profraw' | tr -d '\r'); then
        echo "Could not list native profiles under $remote_dir on $serial" >&2
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
        local_path="$staging_dir/$remote_path"
        mkdir -p "$(dirname "$local_path")"
        if ! "$adb_path" -s "$serial" exec-out run-as "$package" cat "$remote_path" > "$local_path"; then
            rm -f "$local_path"
            echo "Could not pull native profile: $remote_path" >&2
            exit 1
        fi
        if [[ ! -s "$local_path" ]]; then
            echo "Collected native profile is empty: $remote_path" >&2
            exit 1
        fi
        count=$((count + 1))
    done <<< "$remote_paths"
done

if [[ $count -eq 0 && "${5:-}" != --allow-empty ]]; then
    echo "No Bookstr native profiles found for $package on $serial" >&2
    exit 1
fi

mv "$staging_dir" "$output_dir/raw"
echo "Collected $count native profile(s) into $output_dir/raw"

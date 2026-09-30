#!/usr/bin/env bash
set -euo pipefail

adb_path=${1:?Pass the Android SDK adb path}
serials=$("$adb_path" devices -l | awk 'NR > 1 && NF > 0 { print $1 }')

if [[ -z "$serials" ]]; then
    echo 'Connected Android tests require a disposable emulator; no device was found.' >&2
    exit 1
fi

while IFS= read -r serial; do
    if [[ "$serial" != emulator-* ]]; then
        echo "Refusing connected Android tests: $serial is not an emulator and app data could be erased." >&2
        exit 1
    fi
done <<< "$serials"

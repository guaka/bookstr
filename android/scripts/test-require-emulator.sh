#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
fake_adb=$(mktemp)
trap 'rm -f "$fake_adb"' EXIT
cat > "$fake_adb" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$ADB_TEST_DEVICES"
EOF
chmod +x "$fake_adb"

ADB_TEST_DEVICES=$'List of devices attached\nemulator-5554 device' \
    bash "$script_dir/require-emulator.sh" "$fake_adb"

if ADB_TEST_DEVICES=$'List of devices attached\nHA249NL6 device' \
    bash "$script_dir/require-emulator.sh" "$fake_adb" >/dev/null 2>&1; then
    echo 'Physical device was not rejected' >&2
    exit 1
fi

if ADB_TEST_DEVICES=$'List of devices attached\nemulator-5554 device\nHA249NL6 device' \
    bash "$script_dir/require-emulator.sh" "$fake_adb" >/dev/null 2>&1; then
    echo 'Mixed emulator and physical devices were not rejected' >&2
    exit 1
fi

if ADB_TEST_DEVICES='List of devices attached' \
    bash "$script_dir/require-emulator.sh" "$fake_adb" >/dev/null 2>&1; then
    echo 'No-device state was not rejected' >&2
    exit 1
fi

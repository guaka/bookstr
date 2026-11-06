#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
mkdir -p "$root/bin" "$root/device/cache" "$root/device/files/torrent-downloads"
cat >"$root/bin/adb" <<'FAKE_ADB'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == -s ]] || exit 90
serial=$2
shift 2
if [[ "$1" == get-state ]]; then
  [[ "$serial" == emulator-* ]] || exit 91
  printf 'device\n'
  exit 0
fi
[[ "$1" == shell && "$2" == run-as && "$3" == app.bookstr ]] || exit 92
shift 3
command=$1
shift
case "$command" in
  find)
    directory=$1
    [[ -d "$DEVICE_ROOT/$directory" ]] || exit 0
    if [[ "${FAIL_FIND_DIR:-}" == "$directory" ]]; then
      printf 'simulated listing failure\n' >&2
      exit 1
    fi
    find "$DEVICE_ROOT/$directory" -type f -name 'bookstr-native-coverage-*.profraw' -print | sed "s#^$DEVICE_ROOT/##"
    ;;
  rm)
    [[ "$#" == 1 ]] || exit 93
    [[ "$1" == cache/* || "$1" == files/torrent-downloads/* ]] || exit 94
    rm -f "$DEVICE_ROOT/$1"
    ;;
  *) exit 95 ;;
esac
FAKE_ADB
chmod +x "$root/bin/adb"
export DEVICE_ROOT="$root/device"

touch "$root/device/cache/bookstr-native-coverage-1.profraw"
touch "$root/device/files/torrent-downloads/bookstr-native-coverage-2.profraw"
touch "$root/device/cache/default.profraw"
touch "$root/device/files/torrent-downloads/book.epub"
"$script_dir/prepare-native-coverage.sh" "$root/bin/adb" emulator-5554 app.bookstr
[[ ! -e "$root/device/cache/bookstr-native-coverage-1.profraw" ]]
[[ ! -e "$root/device/files/torrent-downloads/bookstr-native-coverage-2.profraw" ]]
[[ -e "$root/device/cache/default.profraw" ]]
[[ -e "$root/device/files/torrent-downloads/book.epub" ]]

touch "$root/device/cache/bookstr-native-coverage-3.profraw"
if "$script_dir/prepare-native-coverage.sh" "$root/bin/adb" device-serial app.bookstr 2>/dev/null; then
  echo 'physical device was accepted for profile cleanup' >&2
  exit 1
fi
[[ -e "$root/device/cache/bookstr-native-coverage-3.profraw" ]]

if FAIL_FIND_DIR=files/torrent-downloads "$script_dir/prepare-native-coverage.sh" "$root/bin/adb" emulator-5554 app.bookstr 2>/dev/null; then
  echo 'profile listing failure was accepted' >&2
  exit 1
fi
[[ -e "$root/device/cache/bookstr-native-coverage-3.profraw" ]]

echo 'Native coverage preparation contract passed.'

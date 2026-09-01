#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")" && pwd)"

node "$root_dir/web/webtorrent-dev-bridge.mjs" &
bridge_pid=$!

cleanup() {
  kill "$bridge_pid" 2>/dev/null || true
  wait "$bridge_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

python3 "$root_dir/webdev.py"

#!/usr/bin/env bash
set -euo pipefail

# Convenience launcher for use from the Bookstr directory. The actual release
# script resolves its own location, so it can safely be called from any directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/scripts/release-android-apk.sh" "$@"

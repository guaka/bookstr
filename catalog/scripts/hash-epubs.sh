#!/usr/bin/env bash
# Hash staged EPUBs into catalog/books/{sha256}.epub and print JSON fragments.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGING="${ROOT}/staging"
BOOKS="${ROOT}/books"
mkdir -p "$STAGING" "$BOOKS"

shopt -s nullglob
for f in "$STAGING"/*.epub; do
  hash=$(sha256sum "$f" | awk '{print $1}')
  dest="${BOOKS}/${hash}.epub"
  cp -f "$f" "$dest"
  echo "${hash}  $(basename "$f") -> books/${hash}.epub"
done

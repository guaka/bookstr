#!/usr/bin/env bash
# Copy catalog.json + hashed seed EPUBs into web/public for Vite / GitHub Pages.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
DEST="${REPO}/web/public/catalog"
BOOKS_SRC="${ROOT}/books"
BOOKS_DEST="${DEST}/books"

mkdir -p "$BOOKS_DEST"
cp -f "${ROOT}/catalog.json" "${DEST}/catalog.json"
find "$BOOKS_DEST" -maxdepth 1 -type f -name '*.epub' -delete

shopt -s nullglob
count=0
for f in "$BOOKS_SRC"/*.epub; do
  cp -f "$f" "$BOOKS_DEST/"
  count=$((count + 1))
done

echo "Synced catalog.json + ${count} EPUB(s) -> web/public/catalog/"

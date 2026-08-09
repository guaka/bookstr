#!/usr/bin/env bash
# Optional: fetch public-domain / CC seed EPUBs into staging, then hash into books/.
# EPUB binaries are gitignored — run this locally or on your book server.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGING="${ROOT}/staging"
mkdir -p "$STAGING"

fetch() {
  local out="$1" url="$2"
  echo "Fetching $out"
  curl -fsSL -L -o "${STAGING}/${out}" "$url"
}

fetch little-brother.epub "https://www.gutenberg.org/ebooks/30142.epub.images"
fetch down-and-out.epub "https://www.gutenberg.org/ebooks/8086.epub.images"
fetch da-terra-a-lua.epub "https://www.gutenberg.org/ebooks/28341.epub.images"
fetch time-machine.epub "https://www.gutenberg.org/ebooks/35.epub.images"
fetch banqueiro-anarquista.epub "https://projectoadamastor.org/download/o-banqueiro-anarquista-fernando-pessoa/?wpdmdl=1786"

"${ROOT}/scripts/hash-epubs.sh"
echo "Done. Drop additional private EPUBs into staging/ and re-run hash-epubs.sh; update catalog.json ids."

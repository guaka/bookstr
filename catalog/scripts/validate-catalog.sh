#!/usr/bin/env bash
# Validate catalog.json shape (no EPUB binaries required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CATALOG="${1:-$ROOT/catalog.json}"

python3 - "$CATALOG" <<'PY'
import json, re, sys
path = sys.argv[1]
sha = re.compile(r"^[a-f0-9]{64}$")
with open(path, encoding="utf-8") as f:
    data = json.load(f)
assert data.get("version") == 1, "version must be 1"
books = data.get("books")
assert isinstance(books, list), "books must be an array"
ids = []
for i, book in enumerate(books):
    for key in ("id", "title", "author", "epubUrl"):
        assert isinstance(book.get(key), str) and book[key].strip(), f"book[{i}].{key} required"
    assert sha.match(book["id"]), f"book[{i}].id must be lowercase sha256 hex"
    ids.append(book["id"])
assert len(ids) == len(set(ids)), "duplicate book ids"
print(f"OK: {len(books)} books in {path}")
PY

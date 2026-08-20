#!/usr/bin/env bash
set -euo pipefail

readonly PORT=11111
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "${SCRIPT_DIR}" && pwd)"
readonly BOOKSTR_WEB_DIR="${REPO_ROOT}/web"
readonly BOOKSTR_DIST_DIR="${REPO_ROOT}/bookstr-dist"
readonly SERVER_SCRIPT="$(mktemp)"

if [[ -f "${BOOKSTR_WEB_DIR}/index.html" ]]; then
  readonly SERVE_DIR="${BOOKSTR_WEB_DIR}"
elif [[ -d "${BOOKSTR_DIST_DIR}" && -f "${BOOKSTR_DIST_DIR}/index.html" ]]; then
  readonly SERVE_DIR="${BOOKSTR_DIST_DIR}"
elif [[ -d "${SCRIPT_DIR}/dist" ]]; then
  readonly SERVE_DIR="${SCRIPT_DIR}/dist"
elif [[ -d "${SCRIPT_DIR}/web/dist" ]]; then
  readonly SERVE_DIR="${SCRIPT_DIR}/web/dist"
else
  readonly SERVE_DIR="${SCRIPT_DIR}"
fi

cleanup() {
  rm -f "${SERVER_SCRIPT}"
}
trap cleanup EXIT

cat > "${SERVER_SCRIPT}" <<'PY'
#!/usr/bin/env python3
import http.server
import json
import mimetypes
import os
import socketserver
from pathlib import Path

SERVE_DIR = Path(os.environ["BOOKSTR_SERVE_DIR"]).resolve()


class BookstrDevHandler(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        ctype, enc = mimetypes.guess_type(path)
        if ctype is None:
            return "application/octet-stream"
        return ctype

    def do_GET(self):  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path == "/favicon.ico" or path.endswith("/favicon.ico"):
            ico_path = SERVE_DIR / "favicon.ico"
            svg_path = SERVE_DIR / "favicon.svg"
            public_ico_path = SERVE_DIR / "public" / "favicon.ico"
            public_svg_path = SERVE_DIR / "public" / "favicon.svg"
            source_path = None
            if ico_path.exists():
                source_path = ico_path
            elif public_ico_path.exists():
                source_path = public_ico_path
            elif svg_path.exists():
                source_path = svg_path
            elif public_svg_path.exists():
                source_path = public_svg_path
            if not source_path.exists():
                self.send_error(404, "Favicon not found")
                return
            try:
                data = source_path.read_bytes()
            except OSError:
                self.send_error(404, "Unable to read favicon")
                return
            content_type = "image/svg+xml"
            if source_path.suffix.lower() == ".ico":
                content_type = "image/x-icon"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(data)
            return

        if path == "/favicon.svg" or path.endswith("/favicon.svg"):
            svg_path = SERVE_DIR / "favicon.svg"
            public_svg_path = SERVE_DIR / "public" / "favicon.svg"
            source_path = svg_path if svg_path.exists() else public_svg_path
            if not source_path.exists():
                self.send_error(404, "Favicon not found")
                return
            try:
                data = source_path.read_bytes()
            except OSError:
                self.send_error(404, "Unable to read favicon")
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/svg+xml")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(data)
            return

        if path == "/" or path.endswith("/") or path.endswith(".html"):
            self.serve_html(path)
            return
        return super().do_GET()

    def serve_html(self, path):
        if path in ("/", ""):
            path = "/index.html"
        local_path = (SERVE_DIR / path.lstrip("/")).resolve()
        if local_path.is_dir():
            local_path = local_path / "index.html"
        if not local_path.exists():
            self.send_error(404, "File not found")
            return
        try:
            body = local_path.read_bytes()
        except OSError:
            self.send_error(404, "Unable to read file")
            return
        content_type = self.guess_type(str(local_path))
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8" if content_type.startswith("text/") else content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)


PORT = int(os.environ["BOOKSTR_PORT"])


def main():
    class ReusableTCPServer(socketserver.TCPServer):
        allow_reuse_address = True

    with ReusableTCPServer(("", PORT), BookstrDevHandler) as httpd:
        print(f"Serving Bookstr frontend from: {SERVE_DIR}")
        print(f"Open: http://localhost:{PORT}")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
PY

if command -v python3 >/dev/null 2>&1; then
  export BOOKSTR_SERVE_DIR="${SERVE_DIR}"
  export BOOKSTR_PORT="${PORT}"
  cd "${SERVE_DIR}"
  python3 "${SERVER_SCRIPT}"
elif command -v python >/dev/null 2>&1; then
  echo "Serving Bookstr frontend from:"
  echo "  ${SERVE_DIR}"
  echo "Open: http://localhost:${PORT}"
  cd "${SERVE_DIR}"
  python -m SimpleHTTPServer "${PORT}"
else
  echo "No Python found. Install Python 3 or provide an equivalent static server."
  exit 1
fi

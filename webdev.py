#!/usr/bin/env python3
import http.server
import os
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import time
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent / "web"
WEBTORRENT_BUNDLE = Path(__file__).resolve().parent / "desktop/node_modules/webtorrent/dist/webtorrent.min.js"
UPSTREAM = "https://all.books.party"
LIBGEN_TORRENT_BASE = "https://annas-archive.gl/dyn/small_file/torrents/external/libgen_rs_non_fic"
WEBTORRENT_BRIDGE = "http://127.0.0.1:11112/join"
WEBTORRENT_DOWNLOAD_BRIDGE = "http://127.0.0.1:11112/download"


def libgen_torrent(md5, libgen_id):
    if libgen_id <= 0:
        raise ValueError("libgen_id must be a positive integer")
    if len(md5) != 32 or any(character not in "0123456789abcdef" for character in md5):
        raise ValueError("md5 must be a 32-character hexadecimal digest")
    batch = libgen_id // 1000 * 1000
    upstream_url = f"{LIBGEN_TORRENT_BASE}/r_{batch}.torrent"
    response = subprocess.run(
        ["curl", "--fail", "--silent", "--show-error", "--location", "--max-time", "20", upstream_url],
        check=False,
        capture_output=True,
    )
    if response.returncode != 0:
        detail = response.stderr.decode("utf-8", errors="replace").strip()
        raise FileNotFoundError(f"repository torrent not found: {detail}")
    return response.stdout


def start_webtorrent_bridge(body, md5):
    if not md5 or len(md5) != 32 or any(character not in "0123456789abcdef" for character in md5):
        return
    url = f"{WEBTORRENT_BRIDGE}?file={urllib.parse.quote(md5)}"
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/x-bittorrent"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=5):
                return
        except Exception as error:
            if attempt == 2:
                print(f"WebTorrent development bridge unavailable: {error}")
            else:
                time.sleep(0.1)


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if self.path == "/__webdev__/webtorrent.min.js":
            if not WEBTORRENT_BUNDLE.is_file():
                return self.send_error(503, "Run npm install in desktop/ to enable browser WebTorrent")
            body = WEBTORRENT_BUNDLE.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=UTF-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return

        if not self.path.startswith("/api/"):
            return super().do_GET()

        try:
            parsed = urllib.parse.urlsplit(self.path)
            if parsed.path in ("/api/libgen-torrent", "/api/libgen-file"):
                values = urllib.parse.parse_qs(parsed.query).get("libgen_id", [])
                libgen_id = int(values[0]) if len(values) == 1 else 0
                md5_values = urllib.parse.parse_qs(parsed.query).get("md5", [])
                md5 = md5_values[0].strip().lower() if len(md5_values) == 1 else ""
                try:
                    body = libgen_torrent(md5, libgen_id)
                except ValueError as error:
                    return self.send_error(400, str(error))
                except FileNotFoundError as error:
                    return self.send_error(404, str(error))
                if parsed.path == "/api/libgen-file":
                    bridge_url = f"{WEBTORRENT_DOWNLOAD_BRIDGE}?file={urllib.parse.quote(md5)}"
                    bridge_request = urllib.request.Request(
                        bridge_url,
                        data=body,
                        method="POST",
                        headers={"Content-Type": "application/x-bittorrent"},
                    )
                    with urllib.request.urlopen(bridge_request, timeout=1800) as response:
                        book = response.read()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/octet-stream")
                    self.send_header("Content-Length", str(len(book)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(book)
                    return
                start_webtorrent_bridge(body, md5)
                self.send_response(200)
                self.send_header("Content-Type", "application/x-bittorrent")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
            else:
                upstream_url = f"{UPSTREAM}{self.path}"
            request = urllib.request.Request(upstream_url)
            with urllib.request.urlopen(request, timeout=20) as response:
                body = response.read()
                self.send_response(response.status)
                self.send_header(
                    "Content-Type",
                    response.headers.get("Content-Type", "application/octet-stream"),
                )
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as error:
            self.send_error(error.code, error.reason)
        except Exception as error:
            self.send_error(502, f"all.books.party unavailable: {error}")


os.chdir(WEB_DIR)
http.server.ThreadingHTTPServer(("", 11111), Handler).serve_forever()

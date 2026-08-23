#!/usr/bin/env python3
import http.server
import os
import urllib.error
import urllib.request
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent / "web"
UPSTREAM = "https://all.books.party"


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if not self.path.startswith("/api/"):
            return super().do_GET()

        try:
            request = urllib.request.Request(f"{UPSTREAM}{self.path}")
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

#!/usr/bin/env python3
"""Tiny static server for Blackout Arena. Works with any Python 3.7+ on any OS."""
import http.server, os, sys, socket, threading, webbrowser, functools

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css'}

    def end_headers(self):
        # never serve a stale module while you are editing
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


class Server(http.server.ThreadingHTTPServer):
    # Threaded, so one browser holding a keep-alive connection can't stall every other request.
    daemon_threads = True
    allow_reuse_address = True


class Server6(Server):
    address_family = socket.AF_INET6


handler = functools.partial(Handler, directory=ROOT)
# Loopback only. Listen on IPv4 and IPv6 so "localhost" works whichever one it resolves to.
httpd = Server(("127.0.0.1", PORT), handler)
try:
    httpd6 = Server6(("::1", PORT), handler)
    threading.Thread(target=httpd6.serve_forever, daemon=True).start()
except OSError:
    pass  # no IPv6 loopback on this machine

url = f"http://localhost:{PORT}/"
print(f"BLACKOUT ARENA serving at {url}\nPress Ctrl+C to stop.", flush=True)
try:
    webbrowser.open(url)
except Exception:
    pass
try:
    httpd.serve_forever()
except KeyboardInterrupt:
    print("\nstopped.")

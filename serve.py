#!/usr/bin/env python3
"""Tiny static server for the scene (disables caching so edits show up on reload).
Usage: python3 serve.py [port]   — if the port is busy, the next free one is used."""
import errno, http.server, os, sys

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass  # keep the terminal quiet

os.chdir(os.path.dirname(os.path.abspath(__file__)))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 5178
for p in range(port, port + 20):
    try:
        server = http.server.ThreadingHTTPServer(('', p), Handler)
    except OSError as e:
        if e.errno == errno.EADDRINUSE:
            print(f'Port {p} is busy, trying {p + 1}…')
            continue
        raise
    print(f'Serving on http://localhost:{p}  (Ctrl+C to stop)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    break
else:
    sys.exit(f'No free port found in {port}-{port + 19}')

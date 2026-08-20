#!/usr/bin/env python3
"""shaderBoi dev/kiosk server.

Serves the app with cache-safe asset URLs: index.html is rewritten on the fly so
every local js/css reference carries its file's mtime as a version query
(src="js/app.js?v=173..."). Any edit changes the URL, so browsers can never
serve a stale script or stylesheet, even with aggressive caching.
"""
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8402
ROOT = os.path.dirname(os.path.abspath(__file__))


def stamped_index():
    with open(os.path.join(ROOT, 'index.html'), 'rb') as f:
        html = f.read().decode('utf-8')

    def stamp(m):
        prefix, rel, suffix = m.group(1), m.group(2), m.group(3)
        path = os.path.join(ROOT, rel)
        try:
            v = int(os.path.getmtime(path))
        except OSError:
            v = 0
        return f'{prefix}{rel}?v={v}{suffix}'

    html = re.sub(r'(src=")([^":?]+\.js)(")', stamp, html)
    html = re.sub(r'(href=")([^":?]+\.css)(")', stamp, html)
    return html.encode('utf-8')


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_GET(self):
        if self.path.split('?')[0] in ('/', '/index.html'):
            data = stamped_index()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def log_message(self, *args):
        pass


print(f'shaderBoi serving {ROOT} on http://localhost:{PORT}')
ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()

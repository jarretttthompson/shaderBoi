#!/usr/bin/env python3
"""shaderBoi dev/kiosk server.

Serves the app with cache-safe asset URLs: index.html is rewritten on the fly so
every local js/css reference carries its file's mtime as a version query
(src="js/app.js?v=173..."). Any edit changes the URL, so browsers can never
serve a stale script or stylesheet, even with aggressive caching.
"""
import json
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8402
ROOT = os.path.dirname(os.path.abspath(__file__))
PRESETS_DIR = os.path.join(ROOT, 'presets')
INDEX_PATH = os.path.join(PRESETS_DIR, 'index.json')


# ---- preset API (local server only; the hosted site is static and falls back to download) ----

def read_index():
    try:
        with open(INDEX_PATH, encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def write_index(entries):
    with open(INDEX_PATH, 'w', encoding='utf-8') as f:
        json.dump(entries, f, indent=2)
        f.write('\n')


def slugify(name):
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return slug or 'preset'


def save_preset(name, scene):
    """Write presets/<slug>.json and (re)register it in index.json. Returns the index."""
    os.makedirs(PRESETS_DIR, exist_ok=True)
    fname = slugify(name) + '.json'
    with open(os.path.join(PRESETS_DIR, fname), 'w', encoding='utf-8') as f:
        json.dump(scene, f, indent=2)
        f.write('\n')
    entries = [e for e in read_index() if e.get('file') != fname]
    entries.append({'name': name, 'file': fname})
    write_index(entries)
    return entries


def delete_preset(fname):
    fname = os.path.basename(fname)
    if not fname.endswith('.json'):
        raise ValueError('not a preset file')
    path = os.path.join(PRESETS_DIR, fname)
    if os.path.isfile(path):
        os.remove(path)
    entries = [e for e in read_index() if e.get('file') != fname]
    write_index(entries)
    return entries


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
        if self.path.split('?')[0] == '/api/presets':
            self._json(200, {'ok': True, 'presets': read_index(), 'writable': True})
            return
        super().do_GET()

    def do_POST(self):
        path = self.path.split('?')[0]
        try:
            length = int(self.headers.get('Content-Length') or 0)
            body = json.loads(self.rfile.read(length).decode('utf-8') or '{}')
        except (ValueError, UnicodeDecodeError):
            self._json(400, {'ok': False, 'error': 'bad json'})
            return
        try:
            if path == '/api/presets':
                name = str(body.get('name', '')).strip()[:80]
                scene = body.get('scene')
                if not name or not isinstance(scene, dict) or scene.get('app') != 'shaderdeck-scene':
                    self._json(400, {'ok': False, 'error': 'need a name and a shaderBoi scene'})
                    return
                self._json(200, {'ok': True, 'presets': save_preset(name, scene), 'file': slugify(name) + '.json'})
            elif path == '/api/presets/delete':
                self._json(200, {'ok': True, 'presets': delete_preset(str(body.get('file', '')))})
            else:
                self._json(404, {'ok': False, 'error': 'unknown endpoint'})
        except (OSError, ValueError) as err:
            self._json(500, {'ok': False, 'error': str(err)})

    def _json(self, code, obj):
        data = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


print(f'shaderBoi serving {ROOT} on http://localhost:{PORT}')
ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()

#!/usr/bin/env python3
"""TorrServer compatibility shim on port 8092.

- /stream/... requests (raw AC3/DTS) are redirected to TorrServer's GStreamer
  HLS endpoint, where non-AAC audio is transcoded to AAC for Chrome.
- every other request is transparently proxied to TorrServer on 8090, so the
  room app's health checks (/echo, /torrents, /gst/...) keep working.

No media is proxied here: the 302 sends the browser straight to 8090.
"""
import json
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TS_INTERNAL = 'http://127.0.0.1:8090'  # записи з контейнера
TS_PUBLIC = 'http://localhost:8090'    # куди йде браузер ChromeOS
PORT = 8092
_cache = {}

HOP_BY_HOP = {'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
              'te', 'trailers', 'transfer-encoding', 'upgrade', 'content-length'}


def pick_audio(torrent_hash, index):
    key = (torrent_hash, index)
    if key in _cache:
        return _cache[key]
    result = None
    try:
        url = '{}/gst/{}/probe?index={}'.format(
            TS_INTERNAL, urllib.parse.quote(torrent_hash, safe=''),
            urllib.parse.quote(str(index), safe=''))
        with urllib.request.urlopen(url, timeout=10) as response:
            data = json.load(response)
        for i, track in enumerate(data.get('Tracks') or []):
            if (track.get('Type') == 'audio'
                    and str(track.get('Language', '')).lower().startswith('uk')
                    and str(track.get('CapsName', '')).startswith('audio/')):
                result = i
                break
    except Exception:
        pass
    _cache[key] = result
    return result


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def _cors(self):
        origin = self.headers.get('Origin')
        self.send_header('Access-Control-Allow-Origin', origin or '*')
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Private-Network', 'true')

    def _send(self, code, body=b'', content_type='text/plain; charset=utf-8'):
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204)

    def do_HEAD(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith('/stream/'):
            self.send_response(302)
            self.send_header('Location', self._stream_target(parsed))
            self._cors()
            self.end_headers()
            return
        self._proxy(head=True)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith('/stream/'):
            self.send_response(302)
            self.send_header('Location', self._stream_target(parsed))
            self._cors()
            self.end_headers()
            return
        self._proxy()

    def do_POST(self):
        self._proxy()

    def _stream_target(self, parsed):
        query = urllib.parse.parse_qs(parsed.query)
        torrent_hash = (query.get('link') or [''])[0]
        index = (query.get('index') or ['0'])[0]
        target = '{}/gst/{}/master.m3u8?index={}'.format(
            TS_PUBLIC, urllib.parse.quote(torrent_hash, safe=''),
            urllib.parse.quote(str(index), safe=''))
        audio = pick_audio(torrent_hash, index)
        if audio is not None:
            target += '&audio={}'.format(audio)
        return target

    def _proxy(self, head=False):
        length = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(length) if length else None
        headers = {}
        for key, value in self.headers.items():
            if key.lower() not in HOP_BY_HOP and key.lower() != 'host':
                headers[key] = value
        req = urllib.request.Request(
            TS_INTERNAL + self.path, data=body, method=self.command, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                payload = b'' if head else response.read()
                self.send_response(response.status)
                for key, value in response.headers.items():
                    low = key.lower()
                    # TorrServer уже шле ACAO -> отримаємо дубль і CORS впаде.
                    if low in HOP_BY_HOP or low.startswith('access-control-') or low == 'vary':
                        continue
                    self.send_header(key, value)
                self._cors()
                if not head:
                    self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                if payload:
                    self.wfile.write(payload)
        except Exception as exc:
            self._send(502, ('TorrServer unavailable: {}'.format(exc)).encode())

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()

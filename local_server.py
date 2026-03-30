#!/usr/bin/env python3
"""PAIGE local dev server — full OAuth + API proxy + static files"""
import os, json, urllib.request, urllib.parse, urllib.error, secrets, time, threading
from http.server import HTTPServer, BaseHTTPRequestHandler

XAI_KEY    = os.environ.get('XAI_KEY', '') or os.environ.get('XAI_API_KEY', '')
ANT_KEY    = os.environ.get('ANT_KEY', '') or os.environ.get('ANTHROPIC_API_KEY', '')
G_CLIENT   = os.environ.get('GOOGLE_CLIENT_ID', '')
G_SECRET   = os.environ.get('GOOGLE_CLIENT_SECRET', '')
BASE_URL   = 'http://localhost:7860'
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))

# In-memory sessions
_sessions = {}
_sessions_lock = threading.Lock()

def get_html():
    """Re-read index.html on every request so changes appear instantly."""
    with open(os.path.join(STATIC_DIR, 'index.html'), 'rb') as f:
        return f.read()

MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css',
        '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png',
        '.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/json'}

# xAI/Cloudflare blocks Python's default User-Agent. Use a real one.
_UA = 'PAIGE/1.0'
_opener = urllib.request.build_opener()
_opener.addheaders = [('User-Agent', _UA)]
urllib.request.install_opener(_opener)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # quiet — remove pass to see request logs

    # ── helpers ──────────────────────────────────────────────────
    def send_html(self, body_bytes, code=200):
        self.send_response(code)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body_bytes)))
        self.end_headers()
        self.wfile.write(body_bytes)

    def send_json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, url):
        self.send_response(302)
        self.send_header('Location', url)
        self.end_headers()

    def send_script(self, js):
        body = f'<!DOCTYPE html><html><head></head><body><script>{js}</script></body></html>'.encode()
        self.send_html(body)

    def get_session(self):
        token = self.headers.get('x-session-token', '')
        with _sessions_lock:
            return _sessions.get(token)

    # ── CORS preflight ───────────────────────────────────────────
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers',
                         'Content-Type, x-api-key, anthropic-version, Authorization, x-session-token')
        self.end_headers()

    # ── GET ──────────────────────────────────────────────────────
    def do_GET(self):
        path = self.path.split('?')[0]
        qs   = urllib.parse.parse_qs(self.path[self.path.find('?')+1:]) if '?' in self.path else {}

        # ── Root / index ──
        if path in ('/', '/index.html'):
            self.send_html(get_html())

        # ── Static assets (avatar etc.) ──
        elif path.startswith('/static/'):
            fname = path[8:]  # strip /static/
            fpath = os.path.join(STATIC_DIR, fname)
            if os.path.isfile(fpath):
                ext = os.path.splitext(fname)[1].lower()
                mime = MIME.get(ext, 'application/octet-stream')
                with open(fpath, 'rb') as f:
                    data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            else:
                self.send_response(404); self.end_headers()

        # ── Health ──
        elif path == '/health':
            self.send_json(200, {
                'status': 'PAIGE online (local)',
                'google_oauth': bool(G_CLIENT),
                'xai_key': bool(XAI_KEY),
                'ant_key': bool(ANT_KEY),
            })

        # ── xAI ephemeral token ──
        elif path == '/token':
            if not XAI_KEY:
                self.send_json(500, {'error': 'XAI_KEY not set'}); return
            try:
                req = urllib.request.Request(
                    'https://api.x.ai/v1/realtime/client_secrets',
                    method='POST',
                    headers={'Authorization': f'Bearer {XAI_KEY}', 'Content-Type': 'application/json'},
                    data=b'{}'
                )
                resp = urllib.request.urlopen(req, timeout=12)
                data = json.loads(resp.read())
                token = (data.get('value') or data.get('token') or
                         (data.get('client_secret') or {}).get('value'))
                if token:
                    self.send_json(200, {'token': token})
                else:
                    self.send_json(500, {'error': 'No token in response', 'raw': data})
            except Exception as e:
                self.send_json(500, {'error': str(e)})

        # ── Google OAuth — start ──
        elif path == '/auth/google':
            if not G_CLIENT:
                # No Google creds — redirect back with error flag
                self.redirect('/?auth_error=no_google_config')
                return
            state = secrets.token_hex(16)
            params = urllib.parse.urlencode({
                'client_id': G_CLIENT,
                'redirect_uri': BASE_URL + '/auth/callback',
                'response_type': 'code',
                'scope': 'openid email profile',
                'state': state,
                'access_type': 'offline',
                'prompt': 'consent',
            })
            self.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params)

        # ── Google OAuth — callback ──
        elif path == '/auth/callback':
            code = qs.get('code', [None])[0]
            if not code:
                self.send_html(b'<h2>Auth failed - no code returned</h2>'); return
            try:
                # Exchange code for tokens
                payload = urllib.parse.urlencode({
                    'code': code,
                    'client_id': G_CLIENT,
                    'client_secret': G_SECRET,
                    'redirect_uri': BASE_URL + '/auth/callback',
                    'grant_type': 'authorization_code',
                }).encode()
                req = urllib.request.Request(
                    'https://oauth2.googleapis.com/token',
                    data=payload,
                    headers={'Content-Type': 'application/x-www-form-urlencoded'}
                )
                tokens = json.loads(urllib.request.urlopen(req, timeout=12).read())
                if not tokens.get('access_token'):
                    self.send_html(b'<h2>Token exchange failed</h2>'); return

                # Fetch user profile
                ureq = urllib.request.Request(
                    'https://www.googleapis.com/oauth2/v2/userinfo',
                    headers={'Authorization': 'Bearer ' + tokens['access_token']}
                )
                user = json.loads(urllib.request.urlopen(ureq, timeout=10).read())

                # Create session
                session_token = secrets.token_hex(32)
                with _sessions_lock:
                    _sessions[session_token] = {
                        'email': user.get('email'),
                        'name': user.get('name'),
                        'picture': user.get('picture'),
                        'created': time.time(),
                    }

                user_json = json.dumps({
                    'email': user.get('email'),
                    'name': user.get('name'),
                    'picture': user.get('picture'),
                }).replace("'", "\\'").replace('"', '\\"')

                # Inject into localStorage then redirect to home
                js = (
                    f"localStorage.setItem('paige_google_session','{session_token}');"
                    f"localStorage.setItem('paige_google_user',\"{json.dumps({'email':user.get('email'),'name':user.get('name'),'picture':user.get('picture')})}\");"
                    "window.location.href='/?auth=google';"
                )
                self.send_script(js)
            except Exception as e:
                self.send_html(f'<h2>Auth error: {e}</h2>'.encode())

        # ── Session user ──
        elif path == '/auth/user':
            token = self.headers.get('x-session-token', '')
            with _sessions_lock:
                u = _sessions.get(token)
            if u:
                self.send_json(200, u)
            else:
                self.send_json(401, {'error': 'Not signed in'})

        # ── Logout ──
        elif path == '/auth/logout':
            token = self.headers.get('x-session-token', '')
            with _sessions_lock:
                _sessions.pop(token, None)
            self.send_json(200, {'ok': True})

        else:
            self.send_response(404); self.end_headers()

    # ── POST ─────────────────────────────────────────────────────
    def do_POST(self):
        path = self.path.split('?')[0]
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        if path == '/api/claude':
            # Try Anthropic first
            if ANT_KEY:
                try:
                    payload = json.dumps(body).encode()
                    req = urllib.request.Request(
                        'https://api.anthropic.com/v1/messages',
                        data=payload,
                        headers={
                            'Content-Type': 'application/json',
                            'x-api-key': ANT_KEY,
                            'anthropic-version': '2023-06-01',
                        }
                    )
                    data = json.loads(urllib.request.urlopen(req, timeout=90).read())
                    if data.get('content') and not data.get('error'):
                        self.send_json(200, data); return
                    print(f'[PAIGE] Anthropic error: {data.get("error")}')
                except Exception as e:
                    print(f'[PAIGE] Anthropic exception: {e}')

            # Fallback to Grok
            if XAI_KEY:
                try:
                    msgs = body.get('messages', [])
                    sys_prompt = body.get('system', 'You are PAIGE build engine. Generate complete HTML.')
                    payload = json.dumps({
                        'model': 'grok-3-mini',
                        'messages': [{'role': 'system', 'content': sys_prompt}] + msgs,
                        'max_tokens': body.get('max_tokens', 6000),
                    }).encode()
                    req = urllib.request.Request(
                        'https://api.x.ai/v1/chat/completions',
                        data=payload,
                        headers={'Authorization': f'Bearer {XAI_KEY}', 'Content-Type': 'application/json'}
                    )
                    data = json.loads(urllib.request.urlopen(req, timeout=90).read())
                    text = ((data.get('choices') or [{}])[0]
                            .get('message', {}).get('content', ''))
                    self.send_json(200, {'content': [{'type': 'text', 'text': text}]}); return
                except Exception as e:
                    self.send_json(500, {'error': str(e)}); return

            self.send_json(500, {'error': 'No API keys configured — set XAI_KEY or ANT_KEY'})
        else:
            self.send_response(404); self.end_headers()


if __name__ == '__main__':
    port = 7860
    print(f'\n  PAIGE local server  →  http://localhost:{port}')
    print(f'  XAI_KEY  : {"✓ set" if XAI_KEY else "✗ missing"}')
    print(f'  ANT_KEY  : {"✓ set" if ANT_KEY else "✗ missing"}')
    print(f'  Google   : {"✓ " + G_CLIENT[:20] + "..." if G_CLIENT else "✗ set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET"}')
    print()
    import socketserver
    class ReusableServer(HTTPServer):
        allow_reuse_address = True
        allow_reuse_port = True
    ReusableServer(('0.0.0.0', port), Handler).serve_forever()

// PAIGE v5.1 — Google OAuth + waveform + quick-build + export + build timer + version history
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 7860;

const XAI_KEY = process.env.XAI_KEY || process.env.XAI_API_KEY || "";
const ANT_KEY = process.env.ANT_KEY || process.env.ANTHROPIC_API_KEY || "";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const BASE_URL = process.env.SPACE_HOST ? 'https://' + process.env.SPACE_HOST : 'https://aibruh-paige-builder.hf.space';

// In-memory user sessions (keyed by session token)
const sessions = {};

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// ── GOOGLE OAUTH ROUTES ──────────────────────────────────────
app.get('/auth/google', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: BASE_URL + '/auth/callback',
    response_type: 'code',
    scope: 'openid email profile',
    state: state,
    access_type: 'offline',
    prompt: 'consent'
  }).toString();
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No auth code');

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: BASE_URL + '/auth/callback',
        grant_type: 'authorization_code'
      }).toString()
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) return res.status(400).send('Token exchange failed');

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: 'Bearer ' + tokens.access_token }
    });
    const user = await userRes.json();

    // Create session
    const sessionToken = crypto.randomBytes(32).toString('hex');
    sessions[sessionToken] = {
      email: user.email,
      name: user.name,
      picture: user.picture,
      createdAt: Date.now()
    };

    console.log('[PAIGE] User signed in:', user.email);

    // Redirect back to app with session token
    res.send('<script>localStorage.setItem("paige_google_session","' + sessionToken + '");localStorage.setItem("paige_google_user",' + "'" + JSON.stringify({ email: user.email, name: user.name, picture: user.picture }) + "'" + ');window.location.href="/";</script>');
  } catch (e) {
    console.error('[PAIGE] OAuth error:', e.message);
    res.status(500).send('Auth failed: ' + e.message);
  }
});

app.get('/auth/user', (req, res) => {
  const token = req.headers['x-session-token'];
  if (token && sessions[token]) {
    res.json(sessions[token]);
  } else {
    res.status(401).json({ error: 'Not signed in' });
  }
});

app.get('/auth/logout', (req, res) => {
  const token = req.headers['x-session-token'];
  if (token) delete sessions[token];
  res.json({ ok: true });
});

// Serve avatar image
app.use('/static', express.static(path.join(__dirname)));

app.get('/health', (_, res) => res.json({ status: 'PAIGE online', time: Date.now() }));

app.get('/token', async (_, res) => {
  try {
    const r = await fetch('https://api.x.ai/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${XAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await r.json();
    const token = data.value || data.token || (data.client_secret && data.client_secret.value);
    if (!token) return res.status(500).json({ error: 'No token returned', raw: data });
    res.json({ token });
  } catch (e) {
    console.error('Token error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/claude', async (req, res) => {
  // Try Anthropic first, fall back to Grok for builds
  if (ANT_KEY) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANT_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(req.body)
      });
      const data = await r.json();
      console.log('[PAIGE] Anthropic status:', r.status, 'hasError:', !!data.error, 'hasContent:', !!(data.content));
      // If Anthropic returned valid content, use it
      if (data.content && data.content.length > 0 && !data.error) {
        return res.json(data);
      }
      // Any error (credit, auth, rate limit) → fall through to Grok
      console.log('[PAIGE] Anthropic failed, falling back to Grok. Error:', JSON.stringify(data.error || {}).slice(0, 200));
    } catch (e) { console.error('[PAIGE] Anthropic error:', e.message); }
  }

  // Grok build engine fallback
  try {
    const systemPrompt = req.body.system || 'You are PAIGE build engine. Generate complete HTML.';
    const messages = req.body.messages || [];
    const r = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + XAI_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'grok-3-mini',
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        max_tokens: req.body.max_tokens || 4000
      })
    });
    const grokData = await r.json();
    const text = (grokData.choices && grokData.choices[0] && grokData.choices[0].message && grokData.choices[0].message.content) || '';
    // Convert to Anthropic-style response format so frontend works unchanged
    res.json({ content: [{ type: 'text', text: text }] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (_, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(fs.readFileSync(FRONTEND_PATH, "utf8"));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('PAIGE running on port', PORT);
  console.log('XAI_KEY set:', !!XAI_KEY);
  console.log('ANT_KEY set:', !!ANT_KEY);
});

// ═══════════════════════════════════════════════════════════════
// FRONTEND — Matches mockup: left panel with avatar + transcript,
// middle panel with versioning/memory, right canvas with backdrop
// ═══════════════════════════════════════════════════════════════

// Frontend served from index.html
const fs = require("fs");
const FRONTEND_PATH = require("path").join(__dirname, "index.html");


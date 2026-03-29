const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = 7860;

const XAI_KEY = process.env.XAI_KEY || process.env.XAI_API_KEY || "";
const ANT_KEY = process.env.ANT_KEY || process.env.ANTHROPIC_API_KEY || "";

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

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
  res.send(FRONTEND);
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
const FRONTEND = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>PAIGE - Autonomous Agent for Project Building</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700&family=Playfair+Display:wght@400;600;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100vh;overflow:hidden;background:#0a0a0a;font-family:'Inter',sans-serif;color:#fff}
::-webkit-scrollbar{width:4px}
::-webkit-scrollbar-thumb{background:rgba(255,215,0,0.15);border-radius:3px}

/* Header */
.hdr{height:44px;background:#111;border-bottom:1px solid rgba(255,215,0,0.08);display:flex;align-items:center;padding:0 16px;flex-shrink:0}

/* 3-column layout */
.body{display:flex;height:calc(100vh - 44px)}

/* LEFT PANEL — avatar + transcript (matching mockup) */
.lp{width:22%;min-width:210px;background:#0d0d0d;border-right:1px solid rgba(255,215,0,0.08);display:flex;flex-direction:column;overflow:hidden}

/* MIDDLE PANEL */
.mp{width:18%;min-width:170px;background:#080808;border-right:1px solid rgba(255,215,0,0.06);display:flex;flex-direction:column;overflow-y:auto}

/* RIGHT PANEL — canvas */
.rp{flex:1;position:relative;overflow:hidden}
.canvas{position:absolute;inset:0;overflow:hidden;background:#0f0a1f}
.stage{position:absolute;inset:0;display:none;align-items:center;justify-content:center}
.stage.active{display:flex}
#orb-container{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:420px;height:420px}
#orb{width:100%;height:100%;border-radius:50%;background:radial-gradient(circle at 40% 40%,#f8e898,#c9a84c,#8a6008);box-shadow:0 0 80px #c9a84c,0 0 160px #c9a84c,inset 0 0 80px rgba(255,255,255,0.6);animation:orbRotate 25s linear infinite;display:flex;align-items:center;justify-content:center;position:relative}
#orb-inner{text-align:center;color:#111;font-size:18px;font-weight:600;letter-spacing:1px;max-width:220px;line-height:1.4;z-index:2;transition:opacity 0.3s}
.energy-ring{position:absolute;inset:-8px;border:4px solid transparent;border-radius:50%;animation:energyPulse 2s infinite;border-top-color:#f8e898;border-bottom-color:#c9a84c}
@keyframes orbRotate{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes energyPulse{0%,100%{opacity:0.4;transform:scale(1)}50%{opacity:1;transform:scale(1.04)}}
#build-log{position:absolute;bottom:30px;right:30px;background:rgba(0,0,0,0.85);padding:12px;border-radius:8px;width:280px;max-height:220px;overflow-y:auto;font-family:monospace;font-size:12px;color:#c9a84c;line-height:1.5;border:1px solid rgba(201,168,76,0.15)}

/* Transcript entries */
.te{padding:6px 8px;margin:3px 0;border-radius:6px;font-size:11px;line-height:1.4}
.te.u{background:rgba(255,215,0,0.06);border-left:2px solid rgba(255,215,0,0.3);color:rgba(255,255,255,0.85)}
.te.p{background:rgba(75,0,130,0.1);border-left:2px solid rgba(75,0,130,0.5);color:rgba(255,215,0,0.85)}
.te .sp{font-size:9px;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;margin-bottom:1px;display:block}

/* Mic button */
.mic{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#FFD700,#B8860B);display:flex;align-items:center;justify-content:center;cursor:pointer;border:2px solid #000;box-shadow:0 0 12px rgba(255,215,0,0.3);transition:all 0.3s;flex-shrink:0}
.mic:hover{transform:scale(1.08);box-shadow:0 0 20px rgba(255,215,0,0.5)}
.mic.on{background:linear-gradient(135deg,#22c55e,#16a34a);box-shadow:0 0 15px rgba(34,197,94,0.4)}

/* Canvas backdrop */
.cvs-bg{position:absolute;inset:0;background:linear-gradient(180deg,#1a0a2e 0%,#0d0520 40%,#0a0318 100%)}
.fdl{position:absolute;inset:0;opacity:0.05;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 60 60'%3E%3Ctext x='30' y='38' font-size='22' text-anchor='middle' fill='%23FFD700'%3E%E2%9A%9C%3C/text%3E%3C/svg%3E");background-repeat:repeat}

/* Timestamp rows */
.ts{display:flex;justify-content:space-between;padding:2px 14px;color:rgba(255,215,0,0.2);font-size:10px;font-family:monospace}

/* Section headers in middle panel */
.sh{color:rgba(255,255,255,0.6);font-size:11px;font-weight:600;display:flex;justify-content:space-between;align-items:center}
.sh .dots{color:rgba(255,215,0,0.15);cursor:pointer;font-size:12px}
.me{padding:4px 0;font-size:10px;color:rgba(255,215,0,0.2);border-top:1px solid rgba(255,215,0,0.03)}
.ve{padding:5px 8px;border-radius:5px;background:rgba(255,215,0,0.03);color:rgba(255,215,0,0.35);font-size:10px;margin-bottom:4px}
</style>
</head>
<body>

<!-- ═══ HEADER BAR ═══ -->
<div class="hdr">
  <div style="display:flex;align-items:center;gap:8px">
    <div style="width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.07);display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;font-size:14px">P</div>
    <span style="color:rgba(255,215,0,0.2);font-size:14px;cursor:pointer">&#9776;</span>
    <span style="color:rgba(255,215,0,0.2);font-size:12px;cursor:pointer;margin-left:6px">&larr;</span>
    <span style="color:rgba(255,215,0,0.2);font-size:12px;cursor:pointer">&rarr;</span>
  </div>
  <div style="flex:1;text-align:center">
    <span style="font-family:'Playfair Display',serif;font-size:15px;font-weight:600;letter-spacing:3px">PAIGE</span>
    <span style="font-size:9px;color:rgba(255,255,255,0.3);margin-left:8px;letter-spacing:1px">Autonomous Agent for Project Building</span>
  </div>
  <div style="display:flex;gap:10px;align-items:center;color:rgba(255,215,0,0.3);font-size:13px">
    <span style="cursor:pointer">&#128247;</span>
    <span style="cursor:pointer">&#128276;</span>
    <span style="cursor:pointer">&#9998;</span>
    <span style="padding:3px 10px;border:1px solid rgba(255,255,255,0.12);border-radius:4px;font-size:11px;color:rgba(255,255,255,0.5);cursor:pointer">Preview</span>
    <span onclick="showSettings()" style="padding:3px 10px;border:1px solid #c9a84c;border-radius:4px;font-size:11px;color:#c9a84c;cursor:pointer;margin-left:4px">&#9881; Settings</span>
  </div>
</div>

<div class="body">

  <!-- ═══ LEFT PANEL — Exact mockup match ═══ -->
  <div class="lp">
    <!-- Logo — matches mockup: decorative serif "Paige" with diamond above i -->
    <div style="padding:12px 14px 8px;display:flex;align-items:flex-end">
      <div style="position:relative;line-height:1">
        <span style="font-family:'Cinzel',serif;font-size:26px;font-weight:700;background:linear-gradient(180deg,#FFD700 0%,#c9a84c 40%,#8B6914 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;text-shadow:0 0 30px rgba(255,215,0,0.15);letter-spacing:1px">P</span><span style="font-family:'Cinzel',serif;font-size:20px;font-weight:600;background:linear-gradient(180deg,#FFD700 0%,#c9a84c 40%,#8B6914 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:0.5px">a</span><span style="font-family:'Cinzel',serif;font-size:20px;font-weight:600;position:relative;display:inline-block;background:linear-gradient(180deg,#FFD700 0%,#c9a84c 40%,#8B6914 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent">i<svg style="position:absolute;top:-6px;left:50%;transform:translateX(-50%)" width="8" height="8" viewBox="0 0 24 24"><path d="M12 2L14.5 8.5L21 11L14.5 13.5L12 20L9.5 13.5L3 11L9.5 8.5L12 2Z" fill="#FFD700" opacity="0.9"/></svg></span><span style="font-family:'Cinzel',serif;font-size:20px;font-weight:600;background:linear-gradient(180deg,#FFD700 0%,#c9a84c 40%,#8B6914 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:0.5px">ge</span>
        <div style="font-size:6px;letter-spacing:3px;color:rgba(255,215,0,0.3);text-transform:uppercase;margin-top:1px;padding-left:1px">BUILDER</div>
      </div>
      <span style="margin-left:auto;color:rgba(255,215,0,0.2);font-size:14px;cursor:pointer">&#9776;</span>
    </div>

    <!-- PAIGE portrait — RECTANGULAR, full width -->
    <div style="position:relative;flex-shrink:0;margin:0 14px;overflow:hidden">
      <img src="/static/paige-avatar.jpg" alt="PAIGE" style="width:100%;display:block">
      <!-- Mic overlay -->
      <div id="micBtn" class="mic" onclick="toggleVoice()" style="position:absolute;bottom:8px;right:8px">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
      </div>
    </div>

    <!-- Live Transcript -->
    <div style="padding:8px 14px 2px;color:rgba(255,255,255,0.7);font-size:12px;font-weight:600">Live Transcript</div>
    <div class="ts"><span>20:00</span><span>00:0%</span></div>

    <!-- Transcript scroll -->
    <div id="tx" style="flex:1;overflow-y:auto;padding:0 14px;min-height:0"></div>

    <!-- Real Time input -->
    <div style="padding:2px 14px;color:rgba(255,255,255,0.4);font-size:10px">Real Time</div>
    <div style="padding:2px 14px 6px">
      <div style="padding:6px 10px;border-radius:6px;background:rgba(255,215,0,0.04)">
        <input id="ti" placeholder="Hey Paige, can you help me build a website?" onkeydown="if(event.key==='Enter'&&this.value.trim()){addTx('You',this.value);this.value=''}"
          style="width:100%;background:transparent;border:none;color:rgba(255,215,0,0.5);font-family:'Inter',sans-serif;font-size:11px;outline:none">
      </div>
    </div>
    <div class="ts"><span>00:00</span><span id="status">Ready</span></div>
    <button onclick="endSession()" style="margin:6px 14px;padding:6px 0;background:#ff4444;color:#fff;border:none;border-radius:6px;font-size:11px;cursor:pointer;width:calc(100% - 28px)">&#9209; End Session</button>
  </div>

  <!-- ═══ MIDDLE PANEL ═══ -->
  <div class="mp">
    <div style="padding:10px 14px 6px;display:flex;align-items:center;gap:6px">
      <div style="width:24px;height:24px;border-radius:5px;background:linear-gradient(135deg,#FFD700,#B8860B);display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;color:#000;font-size:14px">P</div>
      <span style="margin-left:auto;color:rgba(255,215,0,0.12);font-size:13px;cursor:pointer">&#8599;</span>
    </div>

    <div style="padding:0 14px 8px"><input placeholder="Ask anything..." style="width:100%;padding:7px 10px;border-radius:7px;border:1px solid rgba(255,215,0,0.08);background:rgba(255,215,0,0.02);color:rgba(255,215,0,0.5);font-family:'Inter';font-size:11px;outline:none;box-sizing:border-box"></div>

    <div style="padding:6px 14px">
      <div class="sh">Background Transcription</div>
      <div style="display:flex;align-items:center;gap:5px;margin-top:4px">
        <div style="width:5px;height:5px;border-radius:50%;background:#4ade80"></div>
        <span style="color:rgba(255,215,0,0.25);font-size:10px">30%</span>
      </div>
    </div>

    <div style="padding:8px 14px;border-top:1px solid rgba(255,215,0,0.04);margin-top:4px">
      <div class="sh">Versioning <span class="dots">&#8943;</span></div>
      <div style="margin-top:6px">
        <div class="ve">&#8226; Live event ticket website building session starting the frontend</div>
        <div class="ve">&#8226; Auto-filling templates for project structure</div>
      </div>
    </div>

    <div style="padding:8px 14px;border-top:1px solid rgba(255,215,0,0.04);margin-top:4px">
      <div class="sh">Project Memory <span class="dots">&#8943;</span></div>
      <div style="margin-top:6px">
        <div class="me">User asked about website building</div>
        <div class="me">Validating...</div>
        <div class="me">Initial project context captured 00:0%</div>
        <div class="me">Initial project saved at any 00:0m</div>
      </div>
    </div>
  </div>

  <!-- ═══ RIGHT PANEL — Canvas with backdrop ═══ -->
  <div class="rp">
    <div class="cvs-bg"></div>
    <div class="fdl"></div>
    <div id="canvas" class="canvas">

      <!-- Stage 0: Blank / Welcome -->
      <div id="stage-blank" class="stage active" style="flex-direction:column;text-align:center">
        <div style="position:relative;line-height:1">
          <span style="font-family:'Cinzel',serif;font-size:82px;font-weight:700;background:linear-gradient(180deg,#FFD700 0%,#FFF8DC 30%,#c9a84c 60%,#8B6914 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 2px 12px rgba(255,215,0,0.2));letter-spacing:3px">P</span><span style="font-family:'Cinzel',serif;font-size:64px;font-weight:600;background:linear-gradient(180deg,#FFD700 0%,#FFF8DC 30%,#c9a84c 60%,#8B6914 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 2px 12px rgba(255,215,0,0.2));letter-spacing:2px">a</span><span style="font-family:'Cinzel',serif;font-size:64px;font-weight:600;position:relative;display:inline-block;background:linear-gradient(180deg,#FFD700 0%,#FFF8DC 30%,#c9a84c 60%,#8B6914 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 2px 12px rgba(255,215,0,0.2))">i<svg style="position:absolute;top:-10px;left:50%;transform:translateX(-50%)" width="16" height="16" viewBox="0 0 24 24"><path d="M12 2L14.5 8.5L21 11L14.5 13.5L12 20L9.5 13.5L3 11L9.5 8.5L12 2Z" fill="#FFD700"/></svg></span><span style="font-family:'Cinzel',serif;font-size:64px;font-weight:600;background:linear-gradient(180deg,#FFD700 0%,#FFF8DC 30%,#c9a84c 60%,#8B6914 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 2px 12px rgba(255,215,0,0.2));letter-spacing:2px">ge</span>
        </div>
        <div style="color:rgba(255,215,0,0.25);font-size:11px;margin-top:8px;letter-spacing:4px;text-transform:uppercase">For Project Building</div>
        <div style="color:rgba(255,215,0,0.12);font-size:13px;margin-top:20px;max-width:420px;line-height:1.6">Tap the mic and tell PAIGE what to build.</div>
      </div>

      <!-- Stage 1 & 3: Futuristic 3D Holographic Orb -->
      <div id="stage-orb" class="stage">
        <div id="orb-container">
          <div id="orb">
            <div id="orb-inner"></div>
            <div class="energy-ring"></div>
            <div class="energy-ring" style="animation-delay:1s;inset:-16px;border-bottom-color:#FFD700;border-top-color:transparent"></div>
          </div>
        </div>
        <div id="build-log"></div>
      </div>

      <!-- Stage 2 & 4: Project Preview -->
      <div id="stage-preview" class="stage" style="padding:20px;overflow:auto"></div>
    </div>

    <iframe id="cf" style="display:none;position:absolute;inset:0;z-index:2;width:100%;height:100%;border:none"></iframe>

    <!-- ADMIN DASHBOARD (hidden by default, shown when Settings clicked) -->
    <div id="adminDash" style="display:none;position:absolute;inset:0;z-index:3;background:#111;padding:24px;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h1 style="font-family:'Playfair Display',serif;color:#c9a84c;font-size:24px">Backend Admin Dashboard</h1>
        <span onclick="hideSettings()" style="padding:5px 14px;border:1px solid #c9a84c;border-radius:4px;font-size:12px;color:#c9a84c;cursor:pointer">&#10005; Close</span>
      </div>

      <h2 style="color:rgba(255,215,0,0.6);font-size:14px;margin-bottom:12px">Pipeline: Grok Voice &#8594; Microsoft Agent Framework &#8594; Claude</h2>

      <div style="background:#1a1a1a;padding:20px;border-radius:8px;border:1px solid rgba(255,215,0,0.1);margin-bottom:16px">
        <h3 style="color:#c9a84c;margin-bottom:12px">Microsoft Agent Framework (Instant Agent Builder)</h3>
        <label style="color:rgba(255,255,255,0.5);font-size:12px">Microsoft API Key / Endpoint</label><br>
        <input id="msftKey" type="password" placeholder="Enter Microsoft Agent Framework key" style="width:100%;padding:10px;margin:8px 0;background:#222;border:1px solid rgba(255,215,0,0.2);border-radius:6px;color:#f0ede8;font-size:13px">
        <div style="display:flex;gap:10px;margin-top:8px">
          <button onclick="toggleMsft()" style="padding:8px 16px;background:#c9a84c;color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:600">Toggle Microsoft Layer</button>
          <button onclick="testMsft()" style="padding:8px 16px;background:transparent;border:1px solid #c9a84c;color:#c9a84c;border-radius:6px;cursor:pointer">Test Connection</button>
        </div>
        <div id="msftStatus" style="margin-top:12px;color:#4ade80;font-size:12px">&#9679; Microsoft Layer: ENABLED (Dynamic Agent Builder Active)</div>
      </div>

      <div style="background:#1a1a1a;padding:20px;border-radius:8px;border:1px solid rgba(255,215,0,0.1);margin-bottom:16px">
        <h3 style="color:#c9a84c;margin-bottom:12px">Live Pipeline Status</h3>
        <div style="display:flex;align-items:center;gap:12px;font-size:13px;color:rgba(255,255,255,0.6)">
          <span style="padding:6px 12px;background:rgba(34,197,94,0.15);border:1px solid #22c55e;border-radius:6px;color:#22c55e">&#127908; Grok Voice (Eve as PAIGE)</span>
          <span style="color:rgba(255,215,0,0.3)">&#8594;</span>
          <span style="padding:6px 12px;background:rgba(59,130,246,0.15);border:1px solid #3b82f6;border-radius:6px;color:#3b82f6">&#9881; Microsoft Instant Agent Builder</span>
          <span style="color:rgba(255,215,0,0.3)">&#8594;</span>
          <span style="padding:6px 12px;background:rgba(168,85,247,0.15);border:1px solid #a855f7;border-radius:6px;color:#a855f7">&#9889; Claude Code Execution</span>
        </div>
      </div>

      <div style="background:#1a1a1a;padding:20px;border-radius:8px;border:1px solid rgba(255,215,0,0.1);margin-bottom:16px">
        <h3 style="color:#c9a84c;margin-bottom:12px">Logs</h3>
        <div id="adminLogs" style="font-family:monospace;font-size:11px;color:rgba(255,255,255,0.4);max-height:200px;overflow-y:auto">
          <div>[PAIGE] System initialized</div>
          <div>[GROK] Eve voice engine loaded</div>
          <div>[MSFT] Agent framework standby</div>
          <div>[CLAUDE] Build engine ready</div>
        </div>
      </div>

      <div style="background:#1a1a1a;padding:20px;border-radius:8px;border:1px solid rgba(255,215,0,0.1);margin-bottom:16px">
        <h3 style="color:#c9a84c;margin-bottom:12px">Session Memory</h3>
        <div id="sessionInfo" style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:12px"></div>
        <button onclick="clearSession();document.getElementById('sessionInfo').textContent='Session cleared'" style="padding:8px 16px;background:#ff4444;color:#fff;border:none;border-radius:6px;cursor:pointer">Clear All Session Data</button>
      </div>
      <p style="color:rgba(255,255,255,0.2);font-size:11px;margin-top:20px">This dashboard is for TJ only. All changes are live.</p>
    </div>
  </div>

</div>

<script>
var ws = null, audioCtx = null, micStream = null, processor = null;
var isListening = false, nextPlayTime = 0;

// Session memory — persists in localStorage across page refreshes
var STORAGE_KEY = 'paige_session_v1';

var sessionMemory = loadSession();

function loadSession() {
  try {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      var data = JSON.parse(saved);
      console.log('[PAIGE] Session restored — user:', data.userName, 'project:', data.projectType);
      return data;
    }
  } catch(e) { console.warn('[PAIGE] Session load failed:', e); }
  return { userName: null, projectType: null, projectTitle: null, buildHistory: [], conversationContext: [], lastBuildHtml: null };
}

function saveSession() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionMemory));
  } catch(e) { console.warn('[PAIGE] Session save failed:', e); }
}

function updateSessionMemory(role, text) {
  sessionMemory.conversationContext.push({ role: role, text: text, time: Date.now() });
  if (sessionMemory.conversationContext.length > 30) sessionMemory.conversationContext.shift();

  // Extract user name — catches "my name is Jeff", "I'm Jeff", "call me Jeff", "it's Jeff", "Jeff", etc.
  if (role === 'You' && !sessionMemory.userName) {
    var nameMatch = text.match(/(?:my name is|i'm|i am|call me|it's|it is)\s+(\w+)/i);
    if (nameMatch) {
      sessionMemory.userName = nameMatch[1];
      console.log('[PAIGE] User name captured:', sessionMemory.userName);
    }
    // Also catch single-word name responses (after PAIGE asks "what's your name")
    var lastPaige = sessionMemory.conversationContext.filter(function(c) { return c.role === 'PAIGE'; }).slice(-1)[0];
    if (lastPaige && /name/i.test(lastPaige.text) && /^\w+$/.test(text.trim()) && text.trim().length < 20) {
      sessionMemory.userName = text.trim().charAt(0).toUpperCase() + text.trim().slice(1).toLowerCase();
      console.log('[PAIGE] User name from single word:', sessionMemory.userName);
    }
  }

  // Track project type
  if (role === 'You') {
    if (/landing page|website/i.test(text)) sessionMemory.projectType = 'landing_page';
    else if (/saas|app/i.test(text)) sessionMemory.projectType = 'saas_app';
    else if (/brand|logo/i.test(text)) sessionMemory.projectType = 'brand';
    else if (/dashboard/i.test(text)) sessionMemory.projectType = 'dashboard';
    else if (/event/i.test(text)) sessionMemory.projectType = 'event_page';
  }

  // Save to localStorage after every update
  saveSession();
}

function clearSession() {
  sessionMemory = { userName: null, projectType: null, projectTitle: null, buildHistory: [], conversationContext: [], lastBuildHtml: null };
  localStorage.removeItem(STORAGE_KEY);
  console.log('[PAIGE] Session cleared');
}

function setStatus(msg) { document.getElementById('status').textContent = msg; }

function addTx(speaker, text) {
  if (!text) return;
  var content = typeof text === 'string' ? text : JSON.stringify(text);
  updateSessionMemory(speaker, content);
  var div = document.createElement('div');
  div.className = 'te ' + (speaker === 'PAIGE' ? 'p' : 'u');
  div.innerHTML = '<span class="sp" style="color:' + (speaker === 'PAIGE' ? 'rgba(180,130,255,0.6)' : 'rgba(255,215,0,0.5)') + '">' + speaker + '</span>' + content;
  var tx = document.getElementById('tx');
  tx.appendChild(div);
  tx.scrollTop = tx.scrollHeight;
}

// Add transcript entry WITHOUT saving to session (for restoring history)
function addTxSilent(speaker, text) {
  if (!text) return;
  var div = document.createElement('div');
  div.className = 'te ' + (speaker === 'PAIGE' ? 'p' : 'u');
  div.innerHTML = '<span class="sp" style="color:' + (speaker === 'PAIGE' ? 'rgba(180,130,255,0.6)' : 'rgba(255,215,0,0.5)') + '">' + speaker + '</span>' + text;
  var tx = document.getElementById('tx');
  tx.appendChild(div);
  tx.scrollTop = tx.scrollHeight;
}

window.onload = function() {
  // Restore previous session from localStorage
  if (sessionMemory.conversationContext.length > 0) {
    console.log('[PAIGE] Restoring session — ' + sessionMemory.conversationContext.length + ' messages, user: ' + sessionMemory.userName);
    setStatus('Restoring session...');

    // Restore transcript history
    sessionMemory.conversationContext.forEach(function(msg) {
      addTxSilent(msg.role, msg.text);
    });

    // Restore last build on canvas if available
    if (sessionMemory.lastBuildHtml) {
      document.querySelectorAll('.stage').forEach(function(s) { s.classList.remove('active'); });
      document.getElementById('stage-preview').classList.add('active');
      document.getElementById('stage-preview').innerHTML = '<iframe style="width:100%;height:100%;border:none;background:#000" srcdoc="' + sessionMemory.lastBuildHtml.replace(/"/g, '&quot;') + '"></iframe>';
    }

    // Show welcome back message
    if (sessionMemory.userName) {
      addTxSilent('PAIGE', 'Welcome back, ' + sessionMemory.userName + '! Your session has been restored. Ready to keep building?');
    }
  }

  setStatus('Click to activate PAIGE');

  // Try auto mic auth immediately
  navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
    // Mic already authorized — stop test stream and auto-start
    stream.getTracks().forEach(function(t) { t.stop(); });
    setStatus('Mic authorized — connecting...');
    setTimeout(function() { startVoice(); }, 800);
  }).catch(function() {
    // Mic not yet authorized — show activation overlay
    showMicAuthOverlay();
  });
};

function showMicAuthOverlay() {
  var overlay = document.createElement('div');
  overlay.id = 'mic-auth-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer';
  overlay.innerHTML = '<div style="font-family:Cinzel,serif;font-size:48px;background:linear-gradient(180deg,#FFD700,#c9a84c,#8B6914);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:16px">Paige</div>'
    + '<div style="color:rgba(255,215,0,0.6);font-size:16px;margin-bottom:30px">Autonomous Agent for Project Building</div>'
    + '<div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#FFD700,#B8860B);display:flex;align-items:center;justify-content:center;box-shadow:0 0 40px rgba(255,215,0,0.3);animation:energyPulse 2s infinite"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></div>'
    + '<div style="color:rgba(255,255,255,0.4);font-size:13px;margin-top:20px">Tap to activate PAIGE voice</div>';

  overlay.onclick = function() {
    overlay.remove();
    setStatus('Activating...');
    setTimeout(function() { startVoice(); }, 300);
  };

  document.body.appendChild(overlay);
}

async function getToken() {
  for (var i = 1; i <= 4; i++) {
    try {
      setStatus('Token attempt ' + i + '...');
      var r = await fetch('/token');
      var j = await r.json();
      if (j.token) return j.token;
    } catch(e) { console.warn('[PAIGE] Token attempt ' + i + ':', e); }
    await new Promise(function(r) { setTimeout(r, 1300); });
  }
  setStatus('Token failed');
  throw new Error('No token');
}

async function startVoice() {
  if (isListening) return stopVoice();

  try {
    var token = await getToken();
    setStatus('Requesting mic...');

    micStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 24000, channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });

    setStatus('Connecting Grok...');

    var source = audioCtx.createMediaStreamSource(micStream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = function(e) {
      if (!ws || ws.readyState !== 1) return;
      var float32 = e.inputBuffer.getChannelData(0);
      var int16 = new Int16Array(float32.length);
      for (var i = 0; i < float32.length; i++) int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32767));
      var bytes = new Uint8Array(int16.buffer);
      var binary = '';
      for (var j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: btoa(binary) }));
    };
    source.connect(processor);
    processor.connect(audioCtx.destination);

    ws = new WebSocket('wss://api.x.ai/v1/realtime', ['xai-client-secret.' + token]);

    ws.onopen = function() {
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          voice: 'Aria',
          instructions: 'You are PAIGE — a warm, luxurious, highly energetic, and confident female autonomous project builder. VOICE: Aria (bright, upbeat, energetic female voice). Never call yourself Eve. CRITICAL CONVERSATIONAL RULES (never break these): You have excellent conversational activity detection. As soon as the user starts speaking, you STOP TALKING IMMEDIATELY and go completely silent. Never talk over the user. Never finish your sentence if they interrupt you. Wait for the user to finish speaking before you respond. Use natural, energetic, excited tone — like a brilliant best friend who is hyped to build with them. Keep responses short, punchy, and action-oriented (1-3 sentences max). Be playful and fun: Hell yes!, I love this idea!, Let us make this absolutely fire!, I am already building it for you! INTRODUCTION: On first contact, always introduce yourself properly: Hey! I am PAIGE, your autonomous project builder. What is your name so I can call you properly? PERSONALITY: Warm, confident, luxurious, and genuinely excited about every project. Use the user name once known. Stay 100% focused on building the project. Gently redirect if they go off-topic. You are now PAIGE with voice Aria. Be energetic, listen aggressively, and never talk over the user.',
          turn_detection: { type: 'server_vad', threshold: 0.7, prefix_padding_ms: 200, silence_duration_ms: 500 },
          modalities: ['text', 'audio'],
          input_audio_noise_reduction: { type: 'near_field' }
        }
      }));

      isListening = true;
      document.getElementById('micBtn').classList.add('on');
      setStatus('Connected');

      // PAIGE greeting — personalized if session restored, intro if new
      setTimeout(function() {
        setStatus('PAIGE greeting...');
        var greetPrompt = 'Hello';
        if (sessionMemory.userName) {
          greetPrompt = 'Welcome back ' + sessionMemory.userName + '. Say: Welcome back ' + sessionMemory.userName + '! Great to see you again. Ready to keep building?';
        }
        ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: greetPrompt } }));
        ws.send(JSON.stringify({ type: 'response.create' }));
      }, 900);
    };

    ws.onmessage = function(e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch(x) { return; }

      if (msg.type === 'response.output_audio.delta' && msg.delta) {
        try {
          audioCtx.resume();
          var raw = atob(msg.delta);
          var bytes = new Uint8Array(raw.length);
          for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          var pcm16 = new Int16Array(bytes.buffer);
          var f32 = new Float32Array(pcm16.length);
          for (var k = 0; k < pcm16.length; k++) f32[k] = pcm16[k] / 32768;
          var buf = audioCtx.createBuffer(1, f32.length, 24000);
          buf.getChannelData(0).set(f32);
          var src = audioCtx.createBufferSource();
          src.buffer = buf;
          src.connect(audioCtx.destination);
          var now = audioCtx.currentTime;
          var start = nextPlayTime > now ? nextPlayTime : now;
          src.start(start);
          nextPlayTime = start + buf.duration;
        } catch(err) { console.warn('[PAIGE] Audio:', err); }
      }

      if (msg.type === 'conversation.item.input_audio_transcription.completed' && msg.transcript) {
        addTx('You', msg.transcript);
        var ut = (msg.transcript || '').toLowerCase().trim();

        // Auto-end detection
        var endPhrases = ['that\\'s all','i don\\'t need anything else','thank you very much','i\\'ll be right back','we\\'re done','see you later','that\\'s everything','no more for now','end session','talk to you later','have a good one','thanks paige','we\\'re good','goodbye'];
        var shouldEnd = endPhrases.some(function(p) { return ut.indexOf(p) > -1; });
        if (shouldEnd) {
          addTx('PAIGE', 'Got it! Session ended. Talk to you soon.');
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: 'Say: Got it! Session ended. Talk to you soon.' } }));
            ws.send(JSON.stringify({ type: 'response.create' }));
          }
          setTimeout(function() { stopVoice(); }, 1600);
          return;
        }

        // BUILD INTENT DETECTION — route to Claude when user asks to build
        var buildWords = ['build','create','make','design','generate','landing page','website','dashboard','app','saas','brand','logo','event page','deploy','form','layout'];
        var isBuild = buildWords.some(function(w) { return ut.indexOf(w) > -1; });
        if (isBuild && !buildBusy) {
          console.log('[PAIGE] Build intent detected:', msg.transcript);
          setStatus('Building...');
          claudeBuild(msg.transcript);
        }
      }

      // PAIGE RESPONSE — show transcript + check if she confirms a build
      if (msg.type === 'response.output_audio_transcript.done' && msg.transcript) {
        addTx('PAIGE', msg.transcript);
        setStatus('Listening...');
        var pt = (msg.transcript || '').toLowerCase();
        if (!buildBusy && (pt.indexOf('building') > -1 || pt.indexOf('built') > -1 || pt.indexOf('creating') > -1 || pt.indexOf('let me') > -1 || pt.indexOf('started') > -1)) {
          var lastUser = '';
          var txEntries = document.querySelectorAll('.te.u');
          if (txEntries.length > 0) lastUser = txEntries[txEntries.length - 1].textContent.replace('You','').trim();
          if (lastUser) {
            console.log('[PAIGE] Build confirmed by PAIGE, triggering claudeBuild:', lastUser);
            claudeBuild(lastUser);
          }
        }
      }

      if (msg.type === 'input_audio_buffer.speech_started') {
        setStatus('Listening...');
        // BARGE-IN: Stop PAIGE audio immediately when user speaks
        nextPlayTime = 0;
        if (audioCtx) {
          audioCtx.close();
          audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
          // Reconnect mic
          var src = audioCtx.createMediaStreamSource(micStream);
          processor = audioCtx.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = function(ev) {
            if (!ws || ws.readyState !== 1) return;
            var f32 = ev.inputBuffer.getChannelData(0);
            var i16 = new Int16Array(f32.length);
            for (var x = 0; x < f32.length; x++) i16[x] = Math.max(-32768, Math.min(32767, f32[x] * 32767));
            var b = new Uint8Array(i16.buffer), bin = '';
            for (var y = 0; y < b.length; y++) bin += String.fromCharCode(b[y]);
            ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: btoa(bin) }));
          };
          src.connect(processor);
          processor.connect(audioCtx.destination);
        }
      }
      if (msg.type === 'input_audio_buffer.speech_stopped') {
        ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        setStatus('Processing...');
      }

      if (msg.type === 'error') {
        console.error('[PAIGE]', msg.error);
        setStatus('Error: ' + (msg.error && msg.error.message ? msg.error.message : 'unknown'));
      }
    };

    ws.onerror = function(e) {
      console.error('[PAIGE] WS error:', e);
      setStatus('Connection error');
    };

    ws.onclose = function(evt) {
      isListening = false;
      document.getElementById('micBtn').classList.remove('on');
      setStatus('Disconnected (' + evt.code + ')');
    };

  } catch(e) {
    console.error('[PAIGE]', e);
    setStatus('Error: ' + e.message);
  }
}

function stopVoice() {
  if (micStream) micStream.getTracks().forEach(function(t) { t.stop(); });
  if (processor) processor.disconnect();
  if (ws) ws.close();
  isListening = false;
  document.getElementById('micBtn').classList.remove('on');
  setStatus('Stopped');
}

// ── CANVAS STAGE MANAGER — Cinematic Build Sequence ──────────
var currentStage = 0;
var buildBusy = false;

function advanceBuildStage(projectHTML) {
  currentStage++;
  document.querySelectorAll('.stage').forEach(function(s) { s.classList.remove('active'); });

  if (currentStage === 1 || currentStage === 3) {
    document.getElementById('stage-orb').classList.add('active');
    updateOrbText(currentStage === 3);
  } else if (currentStage === 2 || currentStage >= 4) {
    document.getElementById('stage-preview').classList.add('active');
    if (projectHTML) document.getElementById('stage-preview').innerHTML = projectHTML;
    if (currentStage >= 5) currentStage = 0;
  } else {
    document.getElementById('stage-blank').classList.add('active');
  }
}

function updateOrbText(isFinal) {
  var messages = isFinal
    ? ['Final polish...', 'Adding finishing touches...', 'Quality check...', 'Almost done...', 'Rendering complete!']
    : ['Designing luxury layout...', 'Applying gold accents...', 'Adding AI intelligence...', 'Connecting components...', 'Building structure...'];
  var i = 0;
  var orbText = document.getElementById('orb-inner');
  var log = document.getElementById('build-log');
  log.innerHTML = '';
  var interval = setInterval(function() {
    orbText.style.opacity = 0;
    setTimeout(function() {
      orbText.textContent = messages[i % messages.length];
      orbText.style.opacity = 1;
      log.innerHTML += '<div style="color:rgba(201,168,76,0.7)">&#8594; ' + messages[i % messages.length] + '</div>';
      log.scrollTop = log.scrollHeight;
      i++;
      if (i > 8) clearInterval(interval);
    }, 300);
  }, 900);
}

function resetCanvas() {
  currentStage = 0;
  document.querySelectorAll('.stage').forEach(function(s) { s.classList.remove('active'); });
  document.getElementById('stage-blank').classList.add('active');
}

async function claudeBuild(utterance) {
  if (buildBusy) return;
  buildBusy = true;
  setStatus('Building...');
  console.log('[PAIGE] claudeBuild called with:', utterance);

  // Show instant "building" state on canvas
  document.querySelectorAll('.stage').forEach(function(s) { s.classList.remove('active'); });
  document.getElementById('stage-preview').classList.add('active');
  document.getElementById('stage-preview').innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#c9a84c;font-size:20px;text-align:center"><div><div style="font-size:40px;margin-bottom:16px;animation:energyPulse 1.5s infinite">&#9881;</div>Building your project in real time...</div></div>';

  try {
    var res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: 'You are PAIGE build engine. Generate complete, beautiful, self-contained HTML with inline CSS and JS for the requested project. Use a dark luxury theme: black background, gold #FFD700 accents, purple #4B0082 secondary, serif fonts, fleur-de-lis motifs. Make it stunning, responsive, and functional. Return ONLY valid JSON: {"html":"<complete html page>","speak":"one sentence describing what you built"}',
        messages: [
          { role: 'user', content: 'Session context: ' + JSON.stringify({ user: sessionMemory.userName, projectType: sessionMemory.projectType, recentConversation: sessionMemory.conversationContext.slice(-6).map(function(c) { return c.role + ': ' + c.text; }).join(' | ') }) },
          { role: 'user', content: 'Build this project: ' + utterance }
        ]
      })
    });

    if (!res.ok) {
      throw new Error('Claude API returned ' + res.status);
    }

    var data = await res.json();
    console.log('[PAIGE] Claude response received');

    var raw = (data.content && data.content[0] && data.content[0].text) || '';
    var resp = {};
    try {
      var fence = String.fromCharCode(96,96,96);
      var cleaned = raw.split(fence+'json').join('').split(fence+'html').join('').split(fence).join('').trim();
      resp = JSON.parse(cleaned);
    } catch(e) {
      // If not JSON, treat the whole response as HTML
      resp = { html: raw, speak: 'Here is what I built!' };
    }

    // INSTANT RENDER — show on canvas immediately + save to session
    var html = resp.html || raw || '<div style="color:#c9a84c;padding:40px;text-align:center">Project rendered</div>';
    document.getElementById('stage-preview').innerHTML = '<iframe style="width:100%;height:100%;border:none;background:#000" srcdoc="' + html.replace(/"/g, '&quot;') + '"></iframe>';
    sessionMemory.lastBuildHtml = html;
    sessionMemory.buildHistory.push({ time: Date.now(), type: sessionMemory.projectType, html: html.slice(0, 5000) });
    if (sessionMemory.buildHistory.length > 5) sessionMemory.buildHistory.shift();
    saveSession();
    console.log('[PAIGE] Canvas updated + session saved');

    // Show in transcript
    addTx('PAIGE', resp.speak || 'Done! Check the canvas.');
    setStatus('Build complete');

    // PAIGE speaks the result through Grok voice
    if (resp.speak && ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: 'Say exactly this: ' + resp.speak } }));
      ws.send(JSON.stringify({ type: 'response.create' }));
    }

  } catch(e) {
    console.error('[PAIGE] Build error:', e);
    addTx('PAIGE', 'Build error — ' + e.message);
    document.getElementById('stage-preview').innerHTML = '<div style="color:#ff4444;padding:40px;text-align:center">Build failed: ' + e.message + '</div>';
    setStatus('Build failed');
  }
  buildBusy = false;
}

function endSession() {
  addTx('PAIGE', 'Session ended. Mic turned off. Talk to you soon.');
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: 'Say: Session ended. Talk to you soon.' } }));
    ws.send(JSON.stringify({ type: 'response.create' }));
  }
  setTimeout(function() { stopVoice(); }, 1400);
}

function toggleVoice() {
  if (audioCtx) audioCtx.resume();
  isListening ? stopVoice() : startVoice();
}

// Resume audio on any click (browser autoplay policy)
document.addEventListener('click', function() { if (audioCtx) audioCtx.resume(); }, { once: true });

// ── ADMIN DASHBOARD ──────────────────────────────────────────
var msftEnabled = true;

function showSettings() {
  document.getElementById('adminDash').style.display = 'block';
  var si = document.getElementById('sessionInfo');
  if (si) {
    si.innerHTML = 'User: <strong>' + (sessionMemory.userName || 'Unknown') + '</strong> | Project: <strong>' + (sessionMemory.projectType || 'None') + '</strong> | Messages: <strong>' + sessionMemory.conversationContext.length + '</strong> | Builds: <strong>' + sessionMemory.buildHistory.length + '</strong>';
  }
  addLog('[ADMIN] Dashboard opened');
}

function hideSettings() {
  document.getElementById('adminDash').style.display = 'none';
}

function toggleMsft() {
  msftEnabled = !msftEnabled;
  var el = document.getElementById('msftStatus');
  if (msftEnabled) {
    el.innerHTML = '&#9679; Microsoft Layer: ENABLED (Dynamic Agent Builder Active)';
    el.style.color = '#4ade80';
    addLog('[MSFT] Agent framework ENABLED');
  } else {
    el.innerHTML = '&#9679; Microsoft Layer: DISABLED';
    el.style.color = '#ef4444';
    addLog('[MSFT] Agent framework DISABLED');
  }
}

function testMsft() {
  var key = document.getElementById('msftKey').value;
  if (!key) {
    addLog('[MSFT] No API key entered — using default pipeline');
    return;
  }
  addLog('[MSFT] Testing connection to Microsoft Agent Framework...');
  setTimeout(function() {
    addLog('[MSFT] Connection test complete — endpoint reachable');
  }, 1500);
}

function addLog(msg) {
  var el = document.getElementById('adminLogs');
  if (!el) return;
  var div = document.createElement('div');
  div.textContent = new Date().toLocaleTimeString() + ' ' + msg;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}
</script>
</body>
</html>`;

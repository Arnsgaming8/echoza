import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { verifyAccessToken } from './auth.js';
import { sendDiscordNotification } from './discord.js';
import { setupSocket } from './socket.js';
import { supabase, anonSupabase } from './supabase.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import pushRoutes from './routes/push.routes.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

async function main() {
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/push', pushRoutes);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/db-status', async (_req, res) => {
    const { data, error } = await supabase.from('users').select('id, username').limit(1);
    if (error) {
      const msg = error.message || '';
      if (msg.toLowerCase().includes('database is paused') || error.code === 'PGRST000') {
        res.json({ status: 'paused', message: 'Database is paused. Please contact the Developer: 319-359-5613. Thank you for your understanding.' });
        return;
      }
    }
    res.json({ status: data && data.length > 0 ? 'ok' : 'empty' });
  });

  app.get('/api/debug-db', async (_req, res) => {
    try {
      const { data: users, error: listErr } = await supabase.from('users').select('id, username');
      const { data: steph, error: stephErr } = await supabase.from('users').select('id, username').eq('username', 'Steph').maybeSingle();
      const { data: anonCheck, error: anonErr } = await anonSupabase.from('users').select('id').limit(1);
      res.json({
        usersCount: users?.length ?? 0,
        users: users ?? [],
        listError: listErr?.message ?? null,
        steph: steph ?? null,
        stephError: stephErr?.message ?? null,
        anonCanRead: !anonErr,
        anonError: anonErr?.message ?? null,
        url: (process.env.SUPABASE_URL || '').slice(0, 30) + '...',
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Unknown error' });
    }
  });

  app.get('/api/test-discord', async (_req, res) => {
    await sendDiscordNotification('Test from Echoza server');
    res.json({ sent: true });
  });

  app.post('/api/heartbeat', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const decoded = await verifyAccessToken(authHeader.slice(7));
    if (!decoded) { res.status(401).json({ error: 'Invalid token' }); return; }
    res.json({ ok: true });
  });

  app.get('/api/ice-config', (_req, res) => {
    const turnUrl = process.env.TURN_URL;
    const turnUsername = process.env.TURN_USERNAME;
    const turnCredential = process.env.TURN_CREDENTIAL;

    const iceServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
    ];

    if (turnUrl && turnUsername && turnCredential) {
      const urls: string[] = [];
      for (const url of turnUrl.split(',').map(s => s.trim()).filter(Boolean)) {
        urls.push(url);
        if (!url.includes('transport=')) {
          urls.push(`${url}?transport=tcp`);
        }
      }
      iceServers.push({ urls, username: turnUsername, credential: turnCredential });
    }

    res.json({ iceServers });
  });

  app.get('/api/debug/ice-test', (_req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ICE Test</title>
  <style>
    body { font-family: monospace; background: #111; color: #0f0; padding: 16px; font-size: 14px; }
    pre { white-space: pre-wrap; word-break: break-all; }
    .relay { color: #0ff; }
    .host { color: #0f0; }
    .srflx { color: #ff0; }
    .error { color: #f00; }
    .info { color: #888; }
    button { background: #0f0; color: #000; border: none; padding: 8px 16px; cursor: pointer; margin: 4px; }
    #status { margin: 8px 0; }
    hr { border-color: #333; }
  </style>
</head>
<body>
  <h3>ICE / TURN Diagnostic Tool</h3>
  <button onclick="runTest()">Test (all candidates)</button>
  <button onclick="runTest(true)">Test (relay only)</button>
  <button onclick="clearLog()">Clear</button>
  <div id="status">Ready. Click a test button to begin.</div>
  <hr>
  <pre id="log"></pre>
  <script>
    let pc1 = null, pc2 = null;
    const log = document.getElementById('log');
    const status = document.getElementById('status');

    function addLog(msg, cls = '') {
      log.innerHTML += '<span class="' + cls + '">' + new Date().toISOString().slice(11,19) + ' ' + msg + '</span>\\n';
    }

    function clearLog() { log.innerHTML = ''; }

    async function fetchIceServers() {
      const r = await fetch('/api/ice-config');
      const d = await r.json();
      addLog('ICE servers from server:', 'info');
      d.iceServers.forEach(s => addLog('  ' + JSON.stringify(s.urls) + (s.username ? ' (auth)' : ''), 'info'));
      return d.iceServers;
    }

    async function runTest(relayOnly = false) {
      clearLog();
      status.textContent = 'Running...';
      const iceServers = await fetchIceServers();
      const config = { iceServers };
      if (relayOnly) {
        config.iceTransportPolicy = 'relay';
        addLog('*** RELAY-ONLY MODE ***', 'info');
      }
      addLog('--- Creating PeerConnection 1 ---', 'info');
      pc1 = new RTCPeerConnection(config);
      let pc1Candidates = [];
      let pc2Candidates = [];

      pc1.onicecandidate = e => {
        if (e.candidate) {
          pc1Candidates.push(e.candidate);
          const type = e.candidate.type || e.candidate.candidate.split(' ')[7];
          const cls = type === 'relay' ? 'relay' : type === 'srflx' ? 'srflx' : 'host';
          addLog('PC1 candidate: ' + e.candidate.candidate, cls);
          if (pc2.localDescription && pc2.remoteDescription) {
            pc2.addIceCandidate(e.candidate).catch(() => {});
          }
        } else {
          addLog('PC1: all candidates gathered', 'info');
        }
      };
      pc1.oniceconnectionstatechange = () => {
        addLog('PC1 state: ' + pc1.iceConnectionState, pc1.iceConnectionState === 'connected' ? 'relay' : pc1.iceConnectionState === 'failed' ? 'error' : 'info');
        if (pc1.iceConnectionState === 'connected' || pc1.iceConnectionState === 'completed') {
          status.textContent = 'CONNECTED!';
          status.style.color = '#0f0';
        }
        if (pc1.iceConnectionState === 'failed') {
          status.textContent = 'FAILED';
          status.style.color = '#f00';
        }
      };
      pc1.onicecandidateerror = e => {
        addLog('PC1 candidate error: code=' + e.errorCode + ' text=' + (e.errorText || '') + ' url=' + e.url, 'error');
      };

      addLog('--- Creating PeerConnection 2 ---', 'info');
      pc2 = new RTCPeerConnection({ iceServers });
      pc2.onicecandidate = e => {
        if (e.candidate) {
          pc2Candidates.push(e.candidate);
          const type = e.candidate.type || e.candidate.candidate.split(' ')[7];
          const cls = type === 'relay' ? 'relay' : type === 'srflx' ? 'srflx' : 'host';
          addLog('PC2 candidate: ' + e.candidate.candidate, cls);
          if (pc1.localDescription && pc1.remoteDescription) {
            pc1.addIceCandidate(e.candidate).catch(() => {});
          }
        } else {
          addLog('PC2: all candidates gathered', 'info');
        }
      };
      pc2.oniceconnectionstatechange = () => {
        addLog('PC2 state: ' + pc2.iceConnectionState, pc2.iceConnectionState === 'connected' ? 'relay' : pc2.iceConnectionState === 'failed' ? 'error' : 'info');
      };
      pc2.onicecandidateerror = e => {
        addLog('PC2 candidate error: code=' + e.errorCode + ' text=' + (e.errorText || '') + ' url=' + e.url, 'error');
      };

      const dc = pc1.createDataChannel('test');
      pc2.ondatachannel = e => {
        addLog('PC2: data channel received', 'info');
      };

      try {
        addLog('--- Creating offer ---', 'info');
        const offer = await pc1.createOffer();
        await pc1.setLocalDescription(offer);
        addLog('PC1 local description set (type=' + offer.type + ')', 'info');
        await pc2.setRemoteDescription(offer);
        const answer = await pc2.createAnswer();
        await pc2.setLocalDescription(answer);
        addLog('PC2 local description set (type=' + answer.type + ')', 'info');
        await pc1.setRemoteDescription(answer);
        addLog('--- ICE negotiation complete, waiting for connection... ---', 'info');
      } catch (err) {
        addLog('ERROR: ' + err.message, 'error');
        status.textContent = 'Error: ' + err.message;
        status.style.color = '#f00';
      }
    }
  </script>
</body>
</html>`);
  });

  const clientDist = join(__dirname, '..', '..', 'client', 'dist');
  if (existsSync(clientDist)) {
    // Cache hashed asset bundles aggressively (Vite names them with a build
    // hash so they can't go stale). Serve the SPA index.html with no-store so
    // the browser always gets the latest build on next navigation.
    app.use(express.static(clientDist, { maxAge: '1y', immutable: true }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(join(clientDist, 'index.html'));
    });
    console.log('Serving client from:', clientDist);
  }

  setupSocket(io);

  httpServer.listen(PORT, () => {
    console.log(`Echoza server running on port ${PORT}`);
    const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    setInterval(async () => {
      try {
        const res = await fetch(`${baseUrl}/api/health`);
        if (!res.ok) console.warn('Keep-alive ping failed:', res.status);
        else console.log('Keep-alive ping OK');
      } catch (err) {
        console.warn('Keep-alive ping error:', err);
      }
    }, 14 * 60 * 1000);
  });

  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down...');
    httpServer.close();
    process.exit(0);
  });
}

main().catch(console.error);

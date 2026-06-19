import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { initDb, getPool } from './db.js';
import { setupSocket } from './socket.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import pushRoutes from './routes/push.routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

async function main() {
  await initDb();

  // Clean up stale push subscriptions (same endpoint, different user — keeps newest)
  try {
    const pool = getPool();
    if (pool) {
      await pool.query(`
        DELETE FROM push_subscriptions WHERE (user_id, endpoint) NOT IN (
          SELECT user_id, endpoint FROM (
            SELECT user_id, endpoint, ROW_NUMBER() OVER (PARTITION BY endpoint ORDER BY created_at DESC) rn
            FROM push_subscriptions
          ) sub WHERE rn = 1
        )
      `);
    }
  } catch {}

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

  app.get('/api/ice-config', async (_req, res) => {
    const meteredApiKey = process.env.METERED_API_KEY || '7581c01bdaff4eb85ddf4ce70ecc29df7a94';
    const meteredApp = process.env.METERED_APP || 'vanra';

    try {
      const response = await fetch(`https://${meteredApp}.metered.live/api/v1/turn/credentials?apiKey=${meteredApiKey}`);
      if (response.ok) {
        const iceServers = await response.json() as RTCIceServer[];
        return res.json({ iceServers });
      }
    } catch {}

    // Fallback to manual config if Metered API fails
    const turnUrl = process.env.TURN_URL;
    const turnUsername = process.env.TURN_USERNAME;
    const turnCredential = process.env.TURN_CREDENTIAL;

    const iceServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
    ];

    if (turnUrl && turnUsername && turnCredential) {
      for (const url of turnUrl.split(',').map(s => s.trim()).filter(Boolean)) {
        iceServers.push({ urls: [url], username: turnUsername, credential: turnCredential });
      }
    }

    res.json({ iceServers });
  });

  // Simple web-based TURN test page
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
      const config: RTCConfiguration = { iceServers };
      if (relayOnly) {
        config.iceTransportPolicy = 'relay';
        addLog('*** RELAY-ONLY MODE ***', 'info');
      }
      addLog('--- Creating PeerConnection 1 ---', 'info');
      pc1 = new RTCPeerConnection(config);
      let pc1Candidates: RTCIceCandidate[] = [];
      let pc2Candidates: RTCIceCandidate[] = [];

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

      // Trigger ICE by creating a data channel
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
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => {
      res.sendFile(join(clientDist, 'index.html'));
    });
    console.log('Serving client from:', clientDist);
  }

  setupSocket(io);

  httpServer.listen(PORT, () => {
    console.log(`Echoza server running on port ${PORT}`);
  });

  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down...');
    httpServer.close();
    try { await getPool().end(); } catch {}
    process.exit(0);
  });
}

main().catch(console.error);

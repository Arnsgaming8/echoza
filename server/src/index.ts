import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { verifyAccessToken, getOrCreateEchozaSecurityId, getOrCreateDirectConversation, warningMessageId, SESSION_DURATION_MS } from './auth.js';
import { sendDiscordNotification } from './discord.js';
import { setupSocket } from './socket.js';
import { supabase, anonSupabase } from './supabase.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import pushRoutes, { sendPushNotification } from './routes/push.routes.js';
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
    const { data, error } = await supabase.from('profiles').select('id, username').limit(1);
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
      const { data: profiles, error: listErr } = await supabase.from('profiles').select('id, username');
      const { data: steph, error: stephErr } = await supabase.from('profiles').select('id, username').eq('username', 'Steph').maybeSingle();
      const { data: anonCheck, error: anonErr } = await anonSupabase.from('profiles').select('id').limit(1);
      res.json({
        profilesCount: profiles?.length ?? 0,
        profiles: profiles ?? [],
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

// ── Daily cron entry for pre-expiry warnings ────────────────────────────────
// Called from cron-job.org (or any uptime pinger) once a day. Auth via shared
// secret header; iterates Supabase Auth users and notifies those whose
// 30-day window ends in the next 24h. Idempotent via UUIDv5 message-ids.
app.post('/api/security/notify-upcoming-expirations', async (req, res) => {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error('[security-cron] CRITICAL: CRON_SECRET env var is not configured on this server. The daily expiry-warning cron CANNOT run. Set it via Render > Environment > Add CRON_SECRET (e.g. `openssl rand -hex 32`).');
    res.status(503).json({
      error: 'CRON_SECRET env var not configured on server',
      remediation: 'Set CRON_SECRET in Render Environment Variables. Generate with: openssl rand -hex 32',
    });
    return;
  }
  const provided = req.headers['x-cron-secret'];
  if (provided !== expected) {
    res.status(401).json({ error: 'Invalid cron secret' });
    return;
  }

  try {
    const botId = await getOrCreateEchozaSecurityId();
    const now = Date.now();
    const tomorrowStart = now + 24 * 60 * 60 * 1000;
    const warningContent =
      '⚠️ Heads up! Echoza will log you out tomorrow for security. Re-sign-in to keep your session.';

    let page = 1;
    let notified = 0;
    let skippedDuplicate = 0;
    let pushFailed = 0;
    let errors = 0;
    while (true) {
      const { data, error: listErr } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
      if (listErr) throw listErr;
      const users = data.users;
      if (!users.length) break;

      for (const u of users) {
        if (!u.last_sign_in_at) continue;
        const expiresAt = new Date(u.last_sign_in_at).getTime() + SESSION_DURATION_MS;
        // Window: expiry is in the next 24h AND still in the future.
        if (expiresAt <= now || expiresAt > tomorrowStart) continue;

        try {
          // 1. Resolve or create 1:1 conversation between bot and user.
          const convId = await getOrCreateDirectConversation(botId, u.id);
          // 2. Deterministic message id keyed on the user's EXPIRY DATE (not
          // the cron's run date) — guarantees a single message per 30-day
          // window per user regardless of which cron runs hit it. Multiple
          // crons across days produce the same id and collide on PK.
          const expiryIsoDay = new Date(expiresAt).toISOString().slice(0, 10);
          const msgId = warningMessageId(u.id, expiryIsoDay);
          const { error: insertErr } = await supabase.from('messages').insert({
            id: msgId,
            conversation_id: convId,
            sender_id: botId,
            content: warningContent,
            created_at: new Date().toISOString(),
          });
          // 23505 = unique_violation = already warned for this expiry → skip.
          if (insertErr && insertErr.code === '23505') {
            skippedDuplicate++;
            continue;
          }
          if (insertErr) {
            console.warn(`[security-cron] message insert failed for ${u.id}: ${insertErr.message}`);
            errors++;
            continue;
          }

          // 3. Update conversation preview for sidebar ordering.
          await supabase.from('conversations').update({
            last_message: warningContent,
            last_message_at: new Date().toISOString(),
            last_message_sender_id: botId,
          }).eq('id', convId);

          // 4. Push notification — best-effort. The in-app message is the
          // source of truth; push failure bumps `pushFailed` not `errors`.
          try {
            await sendPushNotification(
              u.id,
              'Echoza Security',
              "You'll be logged out tomorrow. Re-sign-in to keep your session.",
              '/',
              convId,
            );
          } catch (pushErr) {
            pushFailed++;
            console.warn(`[security-cron] push failed for ${u.id}:`, pushErr);
          }
          notified++;
        } catch (perUserErr) {
          console.error(`[security-cron] failed for user ${u.id}:`, perUserErr);
          errors++;
        }
      }
      if (users.length < 1000) break;
      page++;
    }
    res.json({ notified, skippedDuplicate, pushFailed, errors });
  } catch (err: any) {
    console.error('[security-cron] failed:', err);
    res.status(500).json({ error: err?.message || 'Cron endpoint failed' });
  }
});

app.get('/api/conversations', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const decoded = await verifyAccessToken(authHeader.slice(7));
    if (!decoded) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    const userId = decoded.userId;

    try {
      // ── Step 1: Get all conversation IDs the user belongs to ──
      const { data: participantRows } = await supabase
        .from('participants')
        .select('conversation_id, last_read_at')
        .eq('user_id', userId);

      const convIds = (participantRows || []).map(p => p.conversation_id);
      const lastReadMap = new Map(
        (participantRows || []).map(p => [p.conversation_id, p.last_read_at])
      );

      if (convIds.length === 0) {
        res.json([]);
        return;
      }

      // ── Step 2: Fetch conversation rows ──
      const { data: convRows } = await supabase
        .from('conversations')
        .select('*')
        .in('id', convIds)
        .order('last_message_at', { ascending: false });

      if (!convRows || convRows.length === 0) {
        res.json([]);
        return;
      }

      // Sort: conversations with no messages go last
      convRows.sort((a, b) => {
        if (!a.last_message_at && !b.last_message_at) return 0;
        if (!a.last_message_at) return 1;
        if (!b.last_message_at) return -1;
        return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
      });

      // ── Step 3: Fetch all participants ──
      const { data: allParticipants } = await supabase
        .from('participants')
        .select('conversation_id, user_id')
        .in('conversation_id', convIds);

      // ── Step 4: Fetch profiles ──
      const allUserIds = [...new Set((allParticipants || []).map(p => p.user_id))];
      const { data: allProfiles } = await supabase
        .from('profiles')
        .select('id, username, avatar')
        .in('id', allUserIds);
      const profileMap = new Map((allProfiles || []).map(p => [p.id, p]));

      // ── Step 5: Build participant lookup ──
      const participantMap = new Map<string, { id: string; username: string; avatar: string }[]>();
      for (const p of (allParticipants || [])) {
        if (!participantMap.has(p.conversation_id)) {
          participantMap.set(p.conversation_id, []);
        }
        const prof = profileMap.get(p.user_id);
        participantMap.get(p.conversation_id)!.push({
          id: p.user_id,
          username: prof?.username || '',
          avatar: prof?.avatar || '',
        });
      }

      // ── Step 6: Unread counts (batched with Promise.all) ──
      const unreadMap = new Map<string, number>();
      await Promise.all(convRows.map(async (row) => {
        const lastRead = lastReadMap.get(row.id);
        let query = supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', row.id)
          .neq('sender_id', userId);
        if (lastRead) {
          query = query.gt('created_at', lastRead);
        }
        const { count } = await query;
        unreadMap.set(row.id, count || 0);
      }));

      // ── Step 7: Build response ──
      const conversations = convRows.map(row => {
        const members = participantMap.get(row.id) || [];
        const otherParticipants = members.filter(m => m.id !== userId);

        if (row.is_group) {
          return {
            id: row.id,
            isGroup: true,
            groupName: row.group_name || 'Unnamed Group',
            groupAvatar: row.group_avatar || '',
            members,
            lastMessage: row.last_message || '',
            lastTime: row.last_message_at || '',
            unread: unreadMap.get(row.id) || 0,
          };
        }

        const contact = otherParticipants[0] || { id: '', username: '', avatar: '' };
        return {
          id: row.id,
          isGroup: false,
          contact,
          lastMessage: row.last_message || '',
          lastTime: row.last_message_at || '',
          unread: unreadMap.get(row.id) || 0,
        };
      });

      res.json(conversations);
    } catch (err: any) {
      console.error('[API] /api/conversations error:', err);
      res.status(500).json({ error: err?.message || 'Unknown error' });
    }
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
        // iOS Safari 17+ tightened TURN-over-UDP/TCP requirements —
        // many NATs now require a `turns:` (TLS) candidate for the
        // browser to even try the relay. Mirror the first turn: URL
        // as turns:<same-host-port>?transport=tcp so the browser has
        // both options during ICE gathering. Harmless on Chromium.
        if (url.startsWith('turn:') && !urls.some(u => u.startsWith('turns:'))) {
          const tls = url.replace(/^turn:/, 'turns:');
          urls.push(tls.includes('?') ? `${tls}&transport=tcp` : `${tls}?transport=tcp`);
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
      log.innerHTML += '<span class="' + cls + '">' + new Date().toISOString().slice(11,19) + ' ' + msg + '</span>\\\\n';
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
    // `index: false` is intentional: without it, express.static serves
    // index.html for `/` with `maxAge: 1y, immutable: true`, which forces
    // the user's browser to keep the OLD index.html forever — so they
    // never download the new JS bundle. With index: false, the
    // `app.get('*')` catch-all below handles index.html and applies the
    // `no-store, no-cache` headers below.
    app.use(express.static(clientDist, { maxAge: '1y', immutable: true, index: false }));
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

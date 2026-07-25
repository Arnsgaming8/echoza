






import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import {
  verifyAccessToken,
} from './auth.js';
import { env, logEnvSanity } from './env.js';
import { pingDb, fetchOne, fetchAll } from './db.js';
import { sendDiscordNotification } from './discord.js';
import { setupSocket, startPresenceSweeper, emitToUserViaRegistry, setIoRef, touchPresence, emitToUserByUserId } from './socket.js';
import { startPairSessionSweeper } from './socket.pair.js';
import { startAccountDeletionSweeper, setNotifyDeletedAccount } from './account-deletion.js';
import { initVapid } from './vapid.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import pushRoutes from './routes/push.routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  logEnvSanity();
  
  
  
  await pingDb();
  console.log('[db] ping OK — Neon connection pool ready.');

  await initVapid();

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
    try {
      await pingDb();
      res.json({ status: 'ok' });
    } catch (e: any) {
      const msg = (e?.message || '').toString().toLowerCase();
      if (msg.includes('paused') || msg.includes('terminating')) {
        res.json({
          status: 'paused',
          message: 'Database is paused. Please contact the Developer: 319-359-5613. Thank you for your understanding.',
        });
        return;
      }
      res.status(503).json({ status: 'unreachable', message: e?.message });
    }
  });

  
  
  
  app.get('/api/debug-db', async (_req, res) => {
    try {
      const version = await fetchOne<{ server_version: string }>(`SHOW server_version`);
      const profiles = await fetchAll(`SELECT id, username FROM profiles`);
      const convCount = await fetchOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM conversations`);
      const indexList = await fetchAll(/* sql */ `
        SELECT schemaname, tablename, indexname
          FROM pg_indexes
         WHERE schemaname = 'public'
         ORDER BY tablename, indexname
      `).catch(() => [] as any[]);
      res.json({
        postgresVersion: version?.server_version || '',
        profilesCount: profiles.length,
        profiles: profiles.slice(0, 20),
        conversationCount: convCount?.c ?? '0',
        indexes: indexList,
        pool: 'Neon (pg.Pool)',
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
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const decoded = await verifyAccessToken(authHeader.slice(7));
    if (!decoded) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    
    
    
    
    touchPresence(decoded.userId);
    res.json({ ok: true });
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
      
      const participantRows = await fetchAll<{
        conversation_id: string;
        last_read_at: string | null;
      }>(
        `SELECT conversation_id, last_read_at FROM participants WHERE user_id = $1`,
        [userId],
      );
      const convIds = participantRows.map(p => p.conversation_id);
      if (convIds.length === 0) {
        res.json([]);
        return;
      }
      const lastReadMap = new Map(
        participantRows.map(p => [p.conversation_id, p.last_read_at]),
      );

      
      const convRows = await fetchAll<{
        id: string;
        is_group: boolean;
        group_name: string | null;
        group_avatar: string | null;
        last_message: string | null;
        last_message_at: string | null;
        created_at: string;
      }>(
        `SELECT id, is_group, group_name, group_avatar,
                last_message, last_message_at, created_at
           FROM conversations
          WHERE id = ANY($1::uuid[])
          ORDER BY last_message_at DESC NULLS LAST`,
        [convIds],
      );
      if (convRows.length === 0) {
        res.json([]);
        return;
      }

      
      const allParticipants = await fetchAll<{
        conversation_id: string;
        user_id: string;
      }>(
        `SELECT conversation_id, user_id FROM participants WHERE conversation_id = ANY($1::uuid[])`,
        [convIds],
      );

      
      const allUserIds = [...new Set(allParticipants.map(p => p.user_id))];
      const allProfiles = allUserIds.length
        ? await fetchAll<{ id: string; username: string; avatar: string }>(
            `SELECT id, username, avatar FROM profiles WHERE id = ANY($1::uuid[])`,
            [allUserIds],
          )
        : [];
      const profileMap = new Map(allProfiles.map(p => [p.id, p]));

      
      const participantMap = new Map<string, { id: string; username: string; avatar: string }[]>();
      for (const p of allParticipants) {
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

      
      const unreadRows = await fetchAll<{ conversation_id: string; unread: string }>(
        `SELECT m.conversation_id,
                COUNT(*) FILTER (
                  WHERE m.sender_id <> $1
                    AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
                )::text AS unread
           FROM messages m
           JOIN participants p
             ON p.conversation_id = m.conversation_id AND p.user_id = $1
          WHERE m.conversation_id = ANY($2::uuid[])
          GROUP BY m.conversation_id`,
        [userId, convIds],
      );
      const unreadMap = new Map<string, number>();
      for (const row of unreadRows) {
        unreadMap.set(row.conversation_id, parseInt(row.unread || '0', 10));
      }

      
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
    const turnUrl = env.TURN_URL;
    const turnUsername = env.TURN_USERNAME;
    const turnCredential = env.TURN_CREDENTIAL;

    const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

    if (turnUrl && turnUsername && turnCredential) {
      const urls: string[] = [];
      for (const url of turnUrl.split(',').map(s => s.trim()).filter(Boolean)) {
        urls.push(url);
        if (!url.includes('transport=')) {
          urls.push(`${url}?transport=tcp`);
        }
      }
      const turnTlsUrl = env.TURN_TLS_URL;
      if (turnTlsUrl) urls.push(turnTlsUrl);
      iceServers.push({ urls, username: turnUsername, credential: turnCredential });
    }

    res.json({ iceServers });
  });

  app.get('/api/debug/ice-test', (_req, res) => {
    res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ICE Test</title><style>body{font-family:monospace;background:#111;color:#0f0;padding:16px;font-size:14px}
pre{white-space:pre-wrap;word-break:break-all}.relay{color:#0ff}.host{color:#0f0}.srflx{color:#ff0}.error{color:#f00}.info{color:#888}
button{background:#0f0;color:#000;border:none;padding:8px 16px;cursor:pointer;margin:4px}#status{margin:8px 0}hr{border-color:#333}</style>
</head><body><h3>ICE / TURN Diagnostic Tool</h3>
<button onclick="runTest()">Test (all candidates)</button>
<button onclick="runTest(true)">Test (relay only)</button>
<button onclick="clearLog()">Clear</button>
<div id="status">Ready. Click a test button to begin.</div><hr><pre id="log"></pre>
<script>
let pc1=null,pc2=null;const log=document.getElementById('log'),status=document.getElementById('status');
function addLog(msg,cls=''){log.innerHTML+='<span class="'+cls+'">'+new Date().toISOString().slice(11,19)+' '+msg+'</span>\\n';}
function clearLog(){log.innerHTML='';}
async function fetchIceServers(){const r=await fetch('/api/ice-config');const d=await r.json();
 addLog('ICE servers from server:','info');d.iceServers.forEach(s=>addLog('  '+JSON.stringify(s.urls)+(s.username?' (auth)':''),'info'));return d.iceServers;}
async function runTest(relayOnly=false){
 clearLog();status.textContent='Running...';const iceServers=await fetchIceServers();
 const config={iceServers};if(relayOnly){config.iceTransportPolicy='relay';addLog('*** RELAY-ONLY MODE ***','info');}
 addLog('--- Creating PeerConnection 1 ---','info');pc1=new RTCPeerConnection(config);let pc1Candidates=[],pc2Candidates=[];
 pc1.onicecandidate=e=>{if(e.candidate){pc1Candidates.push(e.candidate);
  const type=e.candidate.type||e.candidate.candidate.split(' ')[7];
  const cls=type==='relay'?'relay':type==='srflx'?'srflx':'host';
  addLog('PC1 candidate: '+e.candidate.candidate,cls);if(pc2.localDescription&&pc2.remoteDescription){pc2.addIceCandidate(e.candidate).catch(()=>{});}
 }else addLog('PC1: all candidates gathered','info');};
 pc1.oniceconnectionstatechange=()=>{
  addLog('PC1 state: '+pc1.iceConnectionState,pc1.iceConnectionState==='connected'?'relay':pc1.iceConnectionState==='failed'?'error':'info');
  if(['connected','completed'].includes(pc1.iceConnectionState)){status.textContent='CONNECTED!';status.style.color='#0f0';}
  if(pc1.iceConnectionState==='failed'){status.textContent='FAILED';status.style.color='#f00';}};
 pc1.onicecandidateerror=e=>addLog('PC1 candidate error: code='+e.errorCode+' text='+(e.errorText||'')+' url='+e.url,'error');
 addLog('--- Creating PeerConnection 2 ---','info');pc2=new RTCPeerConnection({iceServers});
 pc2.onicecandidate=e=>{if(e.candidate){pc2Candidates.push(e.candidate);
  const type=e.candidate.type||e.candidate.candidate.split(' ')[7];
  const cls=type==='relay'?'relay':type==='srflx'?'srflx':'host';
  addLog('PC2 candidate: '+e.candidate.candidate,cls);if(pc1.localDescription&&pc1.remoteDescription){pc1.addIceCandidate(e.candidate).catch(()=>{});}
 }else addLog('PC2: all candidates gathered','info');};
 pc2.oniceconnectionstatechange=()=>addLog('PC2 state: '+pc2.iceConnectionState,pc2.iceConnectionState==='connected'?'relay':pc2.iceConnectionState==='failed'?'error':'info');
 pc2.onicecandidateerror=e=>addLog('PC2 candidate error: code='+e.errorCode+' text='+(e.errorText||'')+' url='+e.url,'error');
 const dc=pc1.createDataChannel('test');pc2.ondatachannel=e=>addLog('PC2: data channel received','info');
 try{
  addLog('--- Creating offer ---','info');const offer=await pc1.createOffer();await pc1.setLocalDescription(offer);
  addLog('PC1 local description set (type='+offer.type+')','info');
  await pc2.setRemoteDescription(offer);const answer=await pc2.createAnswer();await pc2.setLocalDescription(answer);
  addLog('PC2 local description set (type='+answer.type+')','info');
  await pc1.setRemoteDescription(answer);addLog('--- ICE negotiation complete, waiting for connection... ---','info');
 }catch(err){addLog('ERROR: '+err.message,'error');status.textContent='Error: '+err.message;status.style.color='#f00';}}
</script></body></html>`);
  });

  
  const clientDist = join(__dirname, '..', '..', 'client', 'dist');
  if (existsSync(clientDist)) {
    app.get('/sw.js', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(join(clientDist, 'sw.js'));
    });
    app.use(express.static(clientDist, { maxAge: '1y', immutable: true, index: false }));
    app.get('*', (req, res) => {
      const host = req.headers.host || '';
      if (host.includes('onrender.com')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Echoza — Moved</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    background:linear-gradient(135deg,#0F1A2F 0%,#1a2a4a 100%);
    min-height:100vh;display:flex;align-items:center;justify-content:center;color:#fff;padding:20px}
  .card{background:rgba(255,255,255,0.06);backdrop-filter:blur(16px);
    border:1px solid rgba(255,255,255,0.1);border-radius:20px;
    padding:48px 40px;max-width:480px;width:100%;text-align:center}
  .logo{width:80px;height:80px;margin:0 auto 24px;display:block}
  h1{font-size:24px;font-weight:700;margin-bottom:12px}
  p{color:rgba(255,255,255,0.65);line-height:1.6;margin-bottom:28px;font-size:15px}
  .btn{display:inline-flex;align-items:center;gap:8px;
    background:#3A7BFF;color:#fff;text-decoration:none;
    padding:14px 32px;border-radius:12px;font-size:16px;font-weight:600;
    transition:all .2s ease;border:none;cursor:pointer}
  .btn:hover{background:#2a5fd8;transform:translateY(-2px);box-shadow:0 8px 24px rgba(58,123,255,0.3)}
  .btn:active{transform:translateY(0)}
  .note{margin-top:20px;font-size:13px;color:rgba(255,255,255,0.4)}
</style>
</head>
<body>
<div class="card">
  <img class="logo" src="/vite.svg" alt="Echoza" />
  <h1>Echoza has moved</h1>
  <p>Echoza is an independent site and has been migrated to a new home. All accounts and conversations are safe.</p>
  <a class="btn" href="https://echozachat.com">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/>
      <line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
    Visit echozachat.com
  </a>
  <p class="note">This page will redirect automatically in 10 seconds.</p>
</div>
<script>setTimeout(()=>{window.location.href='https://echozachat.com'},10000)</script>
</body>
</html>`);
        return;
      }
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(join(clientDist, 'index.html'));
    });
    console.log('Serving client from:', clientDist);
  }

  setupSocket(io);
  startPresenceSweeper(io);
  startPairSessionSweeper();
  setIoRef(io);
  setNotifyDeletedAccount(emitToUserByUserId);
  startAccountDeletionSweeper();

  httpServer.listen(env.PORT, () => {
    console.log(`Echoza server running on port ${env.PORT}`);
    const baseUrl = env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT}`;
    
    
    setInterval(async () => {
      try {
        const r = await fetch(`${baseUrl}/api/health`);
        if (!r.ok) console.warn('Keep-alive ping failed:', r.status);
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

main().catch(err => {
  console.error('[boot] fatal:', err);
  process.exit(1);
});

import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { initDb, query, getPool } from './db.js';
import { setupSocket } from './socket.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import pushRoutes from './routes/push.routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

async function main() {
  await initDb();

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

  app.get('/api/ice-config', (_req, res) => {
    const turnUrl = process.env.TURN_URL;
    const turnUsername = process.env.TURN_USERNAME;
    const turnCredential = process.env.TURN_CREDENTIAL;

    const iceServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: ['turn:openrelay.metered.ca:80', 'turns:openrelay.metered.ca:443'],
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
    ];

    if (turnUrl && turnUsername && turnCredential) {
      iceServers.push({
        urls: turnUrl.split(',').map(s => s.trim()),
        username: turnUsername,
        credential: turnCredential,
      });
    }

    res.json({ iceServers });
  });

  // TEMP: delete contact Steph from arnav
  app.post('/api/admin/delete-contact', async (_req, res) => {
    const [users1, users2] = await Promise.all([
      query('SELECT id FROM users WHERE username = $1', ['arnav']),
      query('SELECT id FROM users WHERE username = $1', ['Steph']),
    ]);
    if (!users1[0]?.values?.length || !users2[0]?.values?.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    const arnavId = users1[0].values[0][0] as string;
    const stephId = users2[0].values[0][0] as string;
    const pool = getPool();

    const convs = await query(
      `SELECT id FROM conversations WHERE (user1_id = $1 AND user2_id = $2) OR (user2_id = $1 AND user1_id = $2)`,
      [arnavId, stephId]
    );
    const convIds = (convs[0]?.values || []).map(r => r[0] as string);
    if (convIds.length === 0) return res.json({ success: true, deletedConversation: 0, note: 'No conversation found' });

    await pool.query('DELETE FROM messages WHERE conversation_id = $1', [convIds[0]]);
    await pool.query('DELETE FROM conversations WHERE id = $1', [convIds[0]]);
    res.json({ success: true, deletedConversation: 1 });
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
}

main().catch(console.error);

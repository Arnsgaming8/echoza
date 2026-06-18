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

  app.get('/api/ice-config', (_req, res) => {
    const turnUrls = process.env.TURN_URL?.split(',').map(s => s.trim()) || [];
    const turnUsernames = process.env.TURN_USERNAME?.split(',').map(s => s.trim()) || [];
    const turnCredentials = process.env.TURN_CREDENTIAL?.split(',').map(s => s.trim()) || [];

    const iceServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
    ];

    const max = Math.max(turnUrls.length, turnUsernames.length, turnCredentials.length);
    for (let i = 0; i < max; i++) {
      const url = turnUrls[i];
      const user = turnUsernames[i] || turnUsernames[0];
      const cred = turnCredentials[i] || turnCredentials[0];
      if (url && user && cred) {
        const urls = [url];
        urls.push(url + '?transport=tcp');
        iceServers.push({ urls, username: user, credential: cred });
      }
    }

    res.json({ iceServers });
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

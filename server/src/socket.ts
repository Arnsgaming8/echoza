








import { Server as SocketServer, Socket } from 'socket.io';
import { verifyAccessToken } from './auth.js';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import { sendPushNotification } from './routes/push.routes.js';
import { sendDiscordNotification } from './discord.js';
import { fetchOne, fetchAll } from './db.js';
import {
  applyPairMiddleware,
  registerPairHandlersForSocket,
} from './socket.pair.js';
import { touchLastSignIn } from './account-deletion.js';

interface AuthSocket extends Socket {
  userId?: string;
  username?: string;
  avatar?: string;
  pairSessionId?: string;
  pairGuestUa?: string | null;
  pairGuestIp?: string | null;
}


const $1 = (v: unknown) => v;
void $1;

const onlineUsers = new Map<string, Map<string, { username: string; avatar: string }>>();


const userHeartbeats = new Map<string, { lastSeen: number; hidden: boolean; online: boolean }>();
const PRESENCE_STALE_MS = 60_000;
const PRESENCE_SWEEP_MS = 8_000;


const userActiveConversations = new Map<string, string | null>();

function isViewingConversation(userId: string, conversationId: string | undefined): boolean {
  if (!conversationId) return false;
  return userActiveConversations.get(userId) === conversationId;
}

const pendingCallTimers = new Map<string, ReturnType<typeof setTimeout>>();
const PENDING_CALL_TIMEOUT_MS = 60_000;
function pendingCallKey(a: string, b: string): string {
  return [a, b].sort().join('_');
}
function clearPendingCall(a: string, b: string): void {
  const k = pendingCallKey(a, b);
  const t = pendingCallTimers.get(k);
  if (t) {
    clearTimeout(t);
    pendingCallTimers.delete(k);
  }
}


async function emitAndPersistCallMissed(
  io: SocketServer,
  callerUserId: string,
  callerUsername: string,
  receiverId: string,
  callType: string,
): Promise<void> {
  try {
    let conversationId = await resolveDirectConversation(callerUserId, receiverId);
    if (!conversationId) {
      const newId = uuidv4();
      const pairKey = [callerUserId, receiverId].sort().join(':');
      const convIns = await fetchOne<{ id: string }>(
         `
        INSERT INTO conversations (id, is_group, direct_pair_key)
          VALUES ($1, FALSE, $2)
        ON CONFLICT (direct_pair_key) WHERE is_group = FALSE DO NOTHING
        RETURNING id`,
        [newId, pairKey],
      );
      let resolvedConvId = convIns?.id;
      if (!resolvedConvId) {
        
        
        
        
        
        const recovered = await fetchOne<{ id: string }>(
          `SELECT id FROM conversations
             WHERE direct_pair_key = $1 AND is_group = FALSE`,
          [pairKey],
        );
        if (!recovered?.id) return;
        resolvedConvId = recovered.id;
      }
      conversationId = resolvedConvId;
      await fetchAll(
        `INSERT INTO participants (conversation_id, user_id)
           VALUES ($1, $2), ($1, $3)
           ON CONFLICT DO NOTHING`,
        [conversationId, callerUserId, receiverId],
      );
    }

    const bucket = Math.floor(Date.now() / 60_000);
    const dedupKey = `callmissed:${[callerUserId, receiverId].sort().join('_')}:${bucket}`;
    const safeId = uuidv5(dedupKey, '6ba7b810-9dad-11d1-80b4-00c04fd430c8');
    const createdAt = new Date().toISOString();
    const icon = callType === 'video' ? '📹' : '📞';
    const content = `${icon} Missed ${callType} call`;

    
    
    
    const inserted = await fetchOne<{ id: string }>(
      `INSERT INTO messages (id, conversation_id, sender_id, content, created_at)
         VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [safeId, conversationId, callerUserId, content, createdAt],
    );
    if (!inserted) return;

    await fetchOne(
      `UPDATE conversations
          SET last_message = $1, last_message_at = $2, last_message_sender_id = $3
        WHERE id = $4`,
      [content, createdAt, callerUserId, conversationId],
    ).catch((err: any) => console.warn('[call:missed] conversation update skipped:', err?.message));

    const message = {
      id: safeId,
      conversationId,
      senderId: callerUserId,
      senderUsername: callerUsername,
      content,
      attachments: [],
      read: false,
      createdAt,
      isGroup: false,
    };
    emitToUser(io, callerUserId, 'message:sent', message);
    emitToUser(io, receiverId, 'message:new', message);
    emitToUser(io, receiverId, 'conversation:update', { conversationId });
    if (!onlineUsers.has(receiverId)) {
      sendPushNotification(
        receiverId,
        `Missed ${callType} call from ${callerUsername}`,
        '',
        '/',
        conversationId,
        { tag: `missed-call-${callerUserId}`, data: { callType, callerId: callerUserId } },
      ).catch(() => {});
    }
    if (await isReceiverMonitored(receiverId)) {
      await sendDiscordNotification(
        `**${callerUsername}** called but **${receiverId}** missed the **${callType}** call`,
      );
    }
  } catch (err) {
    console.error('[emitAndPersistCallMissed] failed:', err);
  }
}

async function isReceiverMonitored(receiverId: string): Promise<boolean> {
  
  const monitoredUsername = process.env.MONITORED_USERNAME;
  if (!monitoredUsername) return false;
  const row = await fetchOne<{ id: string }>(
    `SELECT id FROM profiles WHERE id = $1 AND username = $2`,
    [receiverId, monitoredUsername],
  );
  return !!row;
}


function emitToUser(io: SocketServer, userId: string, event: string, data: any) {
  const sockets = onlineUsers.get(userId);
  if (!sockets) return;
  for (const socketId of sockets.keys()) {
    io.to(socketId).emit(event, data);
  }
}

function emitToUserExcept(
  io: SocketServer,
  userId: string,
  exceptSocketId: string,
  event: string,
  data: any,
) {
  const sockets = onlineUsers.get(userId);
  if (!sockets) return;
  for (const socketId of sockets.keys()) {
    if (socketId !== exceptSocketId) io.to(socketId).emit(event, data);
  }
}

async function emitToGroupMembers(
  io: SocketServer,
  groupId: string,
  event: string,
  data: any,
  excludeUserId?: string,
) {
  const members = await fetchAll<{ user_id: string }>(
    `SELECT user_id FROM participants WHERE conversation_id = $1`,
    [groupId],
  );
  for (const row of members) {
    if (row.user_id !== excludeUserId) emitToUser(io, row.user_id, event, data);
  }
}


function startPresenceSweep(io: SocketServer): NodeJS.Timeout {
  return setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [userId, hb] of [...userHeartbeats.entries()]) {
      const connected = onlineUsers.has(userId);
      if (connected && now - hb.lastSeen > PRESENCE_STALE_MS) {
        const sockets = onlineUsers.get(userId);
        if (sockets) {
          for (const sid of sockets.keys()) {
            const s = io.sockets.sockets.get(sid);
            s?.disconnect(true);
          }
        }
        onlineUsers.delete(userId);
        userHeartbeats.delete(userId);
        changed = true;
      } else if (!connected && now - hb.lastSeen > PRESENCE_STALE_MS) {
        
        
        
        
        
        
        userHeartbeats.delete(userId);
      }
    }
    if (changed) io.emit('online-users', Array.from(onlineUsers.keys()));
  }, PRESENCE_SWEEP_MS);
}


async function resolveDirectConversation(
  userA: string,
  userB: string,
): Promise<string | null> {
  const [userLo, userHi] = [userA, userB].sort();

  
  
  const fast = await fetchOne<{ id: string }>(
    `SELECT id FROM conversations
       WHERE direct_pair_key = $1 AND is_group = FALSE`,
    [userLo + ':' + userHi],
  );
  if (fast?.id) return fast.id;

  
  
  
  const loConvs = await fetchAll<{ conversation_id: string }>(
    `SELECT conversation_id FROM participants WHERE user_id = $1`,
    [userLo],
  );
  if (loConvs.length === 0) return null;

  const convIds = loConvs.map(c => c.conversation_id);
  const matches = await fetchAll<{ conversation_id: string }>(
    `SELECT conversation_id FROM participants
       WHERE conversation_id = ANY($1::uuid[]) AND user_id = $2`,
    [convIds, userHi],
  );
  if (matches.length === 0) return null;

  const candidateIds = matches.map(m => m.conversation_id);
  const dated = await fetchAll<{ id: string; created_at: string }>(
    `SELECT id, created_at FROM conversations
       WHERE id = ANY($1::uuid[]) AND is_group = FALSE
       ORDER BY created_at ASC`,
    [candidateIds],
  );
  if (dated.length === 0) return null;

  const allParts = await fetchAll<{ conversation_id: string }>(
    `SELECT conversation_id FROM participants WHERE conversation_id = ANY($1::uuid[])`,
    [candidateIds],
  );
  const counts = new Map<string, number>();
  for (const p of allParts) {
    counts.set(p.conversation_id, (counts.get(p.conversation_id) || 0) + 1);
  }
  const canonical = dated.find(row => counts.get(row.id) === 2);
  return canonical?.id ?? null;
}




export function setupSocket(io: SocketServer): void {
  applyPairMiddleware(io);

  io.use(async (socket: AuthSocket, next) => {
    if (socket.pairSessionId) return next();

    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));

    const decoded = await verifyAccessToken(token);
    if (!decoded) return next(new Error('Invalid token'));

    
    
    
    const profile = await fetchOne<{ username: string; avatar: string }>(
      `SELECT username, avatar FROM profiles WHERE id = $1`,
      [decoded.userId],
    );
    if (!profile) return next(new Error('User no longer exists'));

    socket.userId = decoded.userId;
    socket.username = profile.username;
    socket.avatar = profile.avatar;
    next();
  });

  io.on('connection', async (socket: AuthSocket) => {
    registerPairHandlersForSocket(io, socket);
    if (socket.pairSessionId) return;

    const userId = socket.userId!;
    const username = socket.username!;

    const wasOffline = !onlineUsers.has(userId);
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Map());
    onlineUsers.get(userId)!.set(socket.id, { username, avatar: socket.avatar || '' });
    void touchLastSignIn(userId);
    io.emit('online-users', Array.from(onlineUsers.keys()));
    if (wasOffline) {
      io.emit('user:online', { userId, username });
    }

    socket.on('user:myIp', () => {
      socket.emit('user:myIp', socket.handshake.address);
    });

    
    
    socket.on('presence:heartbeat', ({ hidden, online }: { hidden?: boolean; online?: boolean } = {}) => {
      if (!userId) return;
      const prevHidden = userHeartbeats.get(userId)?.hidden;
      const newHidden = hidden ?? false;
      userHeartbeats.set(userId, {
        lastSeen: Date.now(),
        hidden: newHidden,
        online: online ?? true,
      });
      if (prevHidden === true && !newHidden) {
        io.emit('online-users', Array.from(onlineUsers.keys()));
        io.emit('user:online', { userId, username });
      } else if (prevHidden === false && newHidden) {
        io.emit('user:offline', { userId });
      }
      socket.emit('online-users', Array.from(onlineUsers.keys()));
    });
    userHeartbeats.set(userId, { lastSeen: Date.now(), hidden: false, online: true });

    
    socket.on('users:search', async ({ query: q }: { query: string }) => {
      try {
        let rows;
        if (!q.trim()) {
          rows = await fetchAll<{ id: string; username: string; avatar: string }>(
            `SELECT id, username, avatar FROM profiles WHERE id <> $1 LIMIT 50`,
            [userId],
          );
        } else {
          rows = await fetchAll<{ id: string; username: string; avatar: string }>(
            `SELECT id, username, avatar FROM profiles
               WHERE LOWER(username) LIKE LOWER($1) AND id <> $2
               LIMIT 20`,
            ['%' + q + '%', userId],
          );
        }
        socket.emit('users:search', rows.map(p => ({ ...p, online: false })));
      } catch (err: any) {
        console.error('[users:search] error:', err);
        socket.emit('users:search', []);
      }
    });

    
    socket.on('conversations:list', async () => {
      try {
        const convRows = await fetchAll<any>(
          `WITH my_parts AS (
            SELECT conversation_id, last_read_at FROM participants WHERE user_id = $1
          ),
          unread AS (
            SELECT m.conversation_id,
              COUNT(*) FILTER (
                WHERE m.sender_id <> $1
                  AND (mp.last_read_at IS NULL OR m.created_at > mp.last_read_at)
              )::int AS cnt
            FROM messages m
            JOIN my_parts mp ON mp.conversation_id = m.conversation_id
            GROUP BY m.conversation_id
          )
          SELECT c.id, c.is_group, c.group_name, c.group_avatar,
                 c.last_message, c.last_message_at, c.created_at,
                 COALESCE(u.cnt, 0) AS unread
            FROM conversations c
            JOIN my_parts mp ON mp.conversation_id = c.id
            LEFT JOIN unread u ON u.conversation_id = c.id
            ORDER BY c.last_message_at DESC NULLS LAST`,
          [userId],
        );

        const convIds = convRows.map((r: any) => r.id);
        if (convIds.length === 0) {
          socket.emit('conversations:list', []);
          return;
        }

        const partRows = await fetchAll<any>(
          `SELECT p.conversation_id, p.user_id, prof.username, prof.avatar
             FROM participants p
             JOIN profiles prof ON prof.id = p.user_id
            WHERE p.conversation_id = ANY($1::uuid[])`,
          [convIds],
        );

        const participantMap = new Map<string, any[]>();
        for (const row of partRows) {
          if (!participantMap.has(row.conversation_id)) {
            participantMap.set(row.conversation_id, []);
          }
          participantMap.get(row.conversation_id)!.push({
            id: row.user_id,
            username: row.username,
            avatar: row.avatar,
            online: onlineUsers.has(row.user_id),
          });
        }

        const conversations: any[] = [];
        for (const row of convRows) {
          const members = participantMap.get(row.id) || [];
          const otherParticipants = members.filter((m: any) => m.id !== userId);
          if (row.is_group) {
            conversations.push({
              id: row.id,
              isGroup: true,
              groupName: row.group_name || 'Unnamed Group',
              groupAvatar: row.group_avatar || '',
              members,
              lastMessage: row.last_message || '',
              lastTime: row.last_message_at || '',
              unread: row.unread,
            });
          } else {
            const contact = otherParticipants[0] ? {
              ...otherParticipants[0],
              online: onlineUsers.has(otherParticipants[0].id),
            } : { id: '', username: '', avatar: '', online: false };
            conversations.push({
              id: row.id,
              isGroup: false,
              contact,
              lastMessage: row.last_message || '',
              lastTime: row.last_message_at || '',
              unread: row.unread,
            });
          }
        }
        socket.emit('conversations:list', conversations);
      } catch (err: any) {
        console.error('[Server] conversations:list error:', err);
        socket.emit('server:diag', { stage: 'thrown', message: err?.message });
        socket.emit('conversations:list', []);
      }
    });

    
    socket.on('messages:get', async ({ conversationId }: { conversationId: string }) => {
      try {
        const msgRows = await fetchAll<{
          id: string;
          conversation_id: string;
          sender_id: string;
          content: string;
          attachments: any[];
          created_at: string;
        }>(
          `SELECT id, conversation_id, sender_id, content, attachments, created_at
             FROM messages
            WHERE conversation_id = $1
            ORDER BY created_at ASC`,
          [conversationId],
        );
        const messageIds = msgRows.map(m => m.id);
        const readReceipts = new Map<string, Set<string>>();
        if (messageIds.length > 0) {
          const rrRows = await fetchAll<{ message_id: string; user_id: string }>(
            `SELECT message_id, user_id FROM read_receipts
               WHERE message_id = ANY($1::uuid[])`,
            [messageIds],
          );
          for (const rr of rrRows) {
            if (!readReceipts.has(rr.message_id)) {
              readReceipts.set(rr.message_id, new Set());
            }
            readReceipts.get(rr.message_id)!.add(rr.user_id);
          }
        }
        const messages = msgRows.map(row => {
          const readers = readReceipts.get(row.id) || new Set();
          return {
            id: row.id,
            conversationId: row.conversation_id,
            senderId: row.sender_id,
            content: row.content,
            attachments: row.attachments || [],
            read: readers.size > 0,
            createdAt: row.created_at,
          };
        });
        socket.emit('messages:list', { conversationId, messages });
      } catch (err: any) {
        console.error('[messages:get] error:', err);
        socket.emit('messages:list', { conversationId, messages: [] });
      }
    });    socket.on('direct:start', async ({ receiverId }: { receiverId: string }) => {
      try {
        let conversationId = await resolveDirectConversation(userId, receiverId);
        if (!conversationId) {
          const newId = uuidv4();
          const pair = [userId, receiverId].sort();
          const directPairKey = pair[0] + ':' + pair[1];
          const ins = await fetchOne<{ id: string }>(
            `INSERT INTO conversations (id, is_group, direct_pair_key)
               VALUES ($1, FALSE, $2)
             ON CONFLICT (direct_pair_key) WHERE is_group = FALSE DO NOTHING
             RETURNING id`,
            [newId, directPairKey],
          );
          let resolvedConvId = ins?.id;
          if (!resolvedConvId) {
            const recovered = await fetchOne<{ id: string }>(
              `SELECT id FROM conversations
                 WHERE direct_pair_key = $1 AND is_group = FALSE`,
              [directPairKey],
            );
            if (!recovered?.id) {
              socket.emit('direct:started', { conversationId: null, receiverId, error: 'race_unresolvable' });
              return;
            }
            resolvedConvId = recovered.id;
          }
          conversationId = resolvedConvId;
          await fetchAll(
            `INSERT INTO participants (conversation_id, user_id)
               VALUES ($1, $2), ($1, $3)
               ON CONFLICT DO NOTHING`,
            [conversationId, userId, receiverId],
          );
        }
        const receiverProfile = await fetchOne<{ username: string; avatar: string }>(
          `SELECT username, avatar FROM profiles WHERE id = $1`,
          [receiverId],
        );
        socket.emit('direct:started', {
          conversationId,
          receiverId,
          receiverUsername: receiverProfile?.username ?? '',
          receiverAvatar: receiverProfile?.avatar ?? '',
        });
      } catch (err) {
        console.error('[direct:start] error:', err);
      }
    });

    
    socket.on('group:create', async ({ name, memberIds }: { name: string; memberIds: string[] }) => {
      const allMembers = [...new Set([userId, ...memberIds])];
      if (allMembers.length < 2) return;
      try {
      const conversationId = uuidv4();
      await fetchOne(
        `INSERT INTO conversations (id, is_group, group_name, created_by)
           VALUES ($1, TRUE, $2, $3)`,
        [conversationId, name || `${allMembers.length} members`, userId],
      );
      
      
      await fetchAll(
        `INSERT INTO participants (conversation_id, user_id)
           SELECT $1, * FROM UNNEST($2::uuid[])`,
        [conversationId, allMembers],
      );
        for (const memberId of allMembers) {
          emitToUser(io, memberId, 'conversation:update', { conversationId });
        }
        socket.emit('group:created', { conversationId, name: name || `${allMembers.length} members` });
      } catch (err: any) {
        console.error('[group:create] error:', err?.message);
      }
    });

    
    socket.on('message:send', async ({
      receiverId, content, groupId, attachments, clientId,
    }: {
      receiverId?: string; content: string; groupId?: string;
      attachments?: any[]; clientId?: string;
    }) => {
      if (!content.trim() && !attachments?.length) return;
      const safeClientId =
        typeof clientId === 'string' && clientId.length > 0 ? clientId.slice(0, 64) : null;

      let conversationId: string;
      let isGroup = false;
      try {
        if (groupId) {
          conversationId = groupId;
          isGroup = true;
        } else if (receiverId) {
          const existing = await resolveDirectConversation(userId, receiverId);
          if (existing) {
            conversationId = existing;
          } else {
            const newId = uuidv4();
            const pair = [userId, receiverId].sort();
            const ins = await fetchOne<{ id: string }>(
              `INSERT INTO conversations (id, is_group, direct_pair_key)
                 VALUES ($1, FALSE, $2)
               ON CONFLICT (direct_pair_key) WHERE is_group = FALSE DO NOTHING
               RETURNING id`,
              [newId, pair[0] + ':' + pair[1]],
            );
            let resolvedConvId = ins?.id;
            if (!resolvedConvId) {
              
              
              const recovered = await fetchOne<{ id: string }>(
                `SELECT id FROM conversations
                   WHERE direct_pair_key = $1 AND is_group = FALSE`,
                [pair[0] + ':' + pair[1]],
              );
              if (!recovered?.id) return;
              resolvedConvId = recovered.id;
            }
            conversationId = resolvedConvId;
            await fetchAll(
              `INSERT INTO participants (conversation_id, user_id)
                 VALUES ($1, $2), ($1, $3)
                 ON CONFLICT DO NOTHING`,
              [conversationId, userId, receiverId],
            );
          }
        } else {
          return;
        }

        const messageId = safeClientId || uuidv4();
        const createdAt = new Date().toISOString();

        
        
        const inserted = await fetchOne<{ id: string }>(
          `INSERT INTO messages (id, conversation_id, sender_id, content, attachments, created_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [messageId, conversationId, userId, content, JSON.stringify(attachments || []), createdAt],
        );
        if (!inserted && safeClientId) {
          
          
          const existing = await fetchOne<{
            id: string; conversation_id: string; sender_id: string;
            content: string; attachments: any[]; created_at: string;
          }>(
            `SELECT id, conversation_id, sender_id, content, attachments, created_at
               FROM messages WHERE id = $1`,
            [messageId],
          );
          if (existing) {
            emitToUser(io, userId, 'message:sent', {
              id: existing.id,
              conversationId: existing.conversation_id,
              senderId: existing.sender_id,
              senderUsername: username,
              content: existing.content,
              attachments: existing.attachments || [],
              read: false,
              createdAt: existing.created_at,
              isGroup,
              clientId: safeClientId,
            });
          }
          return;
        }

        const preview = content.trim()
          ? content
          : attachments?.length === 1
            ? (attachments[0].type === 'video' ? 'Video'
              : attachments[0].type === 'image' ? 'Image'
              : attachments[0].type === 'audio' ? 'Audio'
              : 'File')
            : attachments?.length
              ? 'Attachments'
              : '';
        await fetchOne(
          `UPDATE conversations
              SET last_message = $1, last_message_at = $2, last_message_sender_id = $3
            WHERE id = $4`,
          [preview, createdAt, userId, conversationId],
        ).catch((err: any) => console.warn('[message:send] preview update skipped:', err?.message));

        const message = {
          id: messageId, conversationId, senderId: userId,
          senderUsername: username,
          content, attachments: attachments || [],
          read: false, createdAt, isGroup,
          clientId: safeClientId,
        };

        emitToUser(io, userId, 'message:sent', message);

        if (isGroup) {
          await emitToGroupMembers(io, conversationId, 'message:new', message, userId);
          await emitToGroupMembers(io, conversationId, 'conversation:update', { conversationId }, userId);
          
          
          
          const [convRow, groupMembers] = await Promise.all([
            fetchOne<{ group_name: string | null }>(
              `SELECT group_name FROM conversations WHERE id = $1`,
              [conversationId],
            ),
            fetchAll<{ user_id: string }>(
              `SELECT user_id FROM participants
                 WHERE conversation_id = $1 AND user_id <> $2`,
              [conversationId, userId],
            ),
          ]);
          const groupTitle = convRow?.group_name || username;
          const bodyPreview = content.trim()
            ? `${username}: ${preview}`
            : `${username} sent ${attachments?.length === 1 ? 'an attachment' : 'attachments'}`;            for (const m of groupMembers) {
            if (!onlineUsers.has(m.user_id)) {
              sendPushNotification(
                m.user_id, groupTitle, bodyPreview,
                `/dashboard?conv=${conversationId}`, conversationId,
              ).catch(() => {});
            }
          }
        } else if (receiverId) {
          emitToUser(io, receiverId, 'message:new', message);
          emitToUser(io, receiverId, 'conversation:update', { conversationId });
          if (!onlineUsers.has(receiverId)) {
            sendPushNotification(
              receiverId, username,
              content || 'Sent an attachment',
              `/dashboard?conv=${conversationId}`, conversationId,
            ).catch(() => {});
          }
          if (await isReceiverMonitored(receiverId)) {
            await sendDiscordNotification(`**${username}** sent a message: ${content || 'Sent an attachment'}`);
          }
        }
      } catch (err: any) {
        console.error('[message:send] error:', err?.message || err);
      }
    });

    
    socket.on('message:read', async ({
      messageId, conversationId,
    }: { messageId: string; conversationId: string }) => {
      try {
        const participant = await fetchOne<{ user_id: string }>(
          `SELECT user_id FROM participants
             WHERE conversation_id = $1 AND user_id = $2`,
          [conversationId, userId],
        );
        if (!participant) return;
        await fetchOne(
          `INSERT INTO read_receipts (message_id, user_id)
             VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [messageId, userId],
        );
        await fetchOne(
          `UPDATE participants
              SET last_read_at = $1
            WHERE conversation_id = $2 AND user_id = $3`,
          [new Date().toISOString(), conversationId, userId],
        );
        const msg = await fetchOne<{ sender_id: string }>(
          `SELECT sender_id FROM messages WHERE id = $1`,
          [messageId],
        );
        if (msg && msg.sender_id !== userId) {
          emitToUser(io, msg.sender_id, 'message:read-status', { messageId, conversationId, readByUserId: userId });
          emitToUser(io, msg.sender_id, 'conversation:update', { conversationId });
        }
      } catch (err: any) {
        console.warn('[message:read] error:', err?.message || err);
      }
    });

    
    socket.on('messages:delete', async ({
      messageIds, conversationId,
    }: { messageIds: string[]; conversationId: string }) => {
      if (!messageIds.length) return;
      try {
        await fetchOne(
          `DELETE FROM messages WHERE id = ANY($1::uuid[]) AND sender_id = $2`,
          [messageIds, userId],
        );
        const lastMsg = await fetchOne<{ content: string; created_at: string }>(
          `SELECT content, created_at FROM messages
             WHERE conversation_id = $1
             ORDER BY created_at DESC
             LIMIT 1`,
          [conversationId],
        );
        await fetchOne(
          `UPDATE conversations
              SET last_message = $1, last_message_at = $2,
                  last_message_sender_id = CASE WHEN $1 = '' THEN NULL ELSE last_message_sender_id END
            WHERE id = $3`,
          [lastMsg?.content || '', lastMsg?.created_at || null, conversationId],
        );
        const participants = await fetchAll<{ user_id: string }>(
          `SELECT user_id FROM participants WHERE conversation_id = $1`,
          [conversationId],
        );
        const payload = { messageIds, conversationId };
        for (const row of participants) {
          emitToUser(io, row.user_id, 'messages:deleted', payload);
          emitToUser(io, row.user_id, 'conversation:update', { conversationId });
        }
      } catch (err: any) {
        console.error('[messages:delete] error:', err?.message || err);
      }
    });

    
    socket.on('conversation:viewing', ({ conversationId }: { conversationId: string | null }) => {
      userActiveConversations.set(userId, conversationId);
    });

    socket.on('typing:start', ({ receiverId, conversationId, groupId }: {
      receiverId?: string; conversationId?: string; groupId?: string;
    }) => {
      if (groupId) {
        emitToGroupMembers(io, groupId, 'typing:start', { userId, conversationId: groupId }, userId);
      } else if (receiverId) {
        emitToUser(io, receiverId, 'typing:start', { userId, conversationId });
      }
    });
    socket.on('typing:stop', ({ receiverId, conversationId, groupId }: {
      receiverId?: string; conversationId?: string; groupId?: string;
    }) => {
      if (groupId) {
        emitToGroupMembers(io, groupId, 'typing:stop', { userId, conversationId: groupId }, userId);
      } else if (receiverId) {
        emitToUser(io, receiverId, 'typing:stop', { userId, conversationId });
      }
    });

    
    socket.on('group:addMember', async ({ groupId, newMemberId }: {
      groupId: string; newMemberId: string;
    }) => {
      try {
        const conv = await fetchOne<{ id: string }>(
          `SELECT id FROM conversations
             WHERE id = $1 AND created_by = $2 AND is_group = TRUE`,
          [groupId, userId],
        );
        if (!conv) return;
        await fetchOne(
          `INSERT INTO participants (conversation_id, user_id)
             VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [groupId, newMemberId],
        );
        await emitToGroupMembers(io, groupId, 'participant:change', {
          groupId, userId: newMemberId, op: 'INSERT',
        });
        await emitToGroupMembers(io, groupId, 'conversation:update', { conversationId: groupId });
        socket.emit('group:memberAdded', { groupId, memberId: newMemberId });
      } catch (err: any) {
        console.error('[group:addMember] error:', err?.message || err);
      }
    });

    
    socket.on('conversation:delete', async ({ conversationId }: { conversationId: string }) => {
      try {
        const conv = await fetchOne<{ is_group: boolean; created_by: string | null }>(
          `SELECT is_group, created_by FROM conversations WHERE id = $1`,
          [conversationId],
        );
        if (!conv) return;
        if (conv.is_group) {
          if (conv.created_by !== userId) return;
          const members = await fetchAll<{ user_id: string }>(
            `SELECT user_id FROM participants WHERE conversation_id = $1`,
            [conversationId],
          );
          const memberIds = members.map(r => r.user_id);
          
          await fetchOne(`DELETE FROM conversations WHERE id = $1`, [conversationId]);
          for (const mid of memberIds) {
            emitToUser(io, mid, 'conversation:deleted', { conversationId });
          }
        } else {
          const other = await fetchOne<{ user_id: string }>(
            `SELECT user_id FROM participants
               WHERE conversation_id = $1 AND user_id <> $2`,
            [conversationId, userId],
          );
          await fetchOne(`DELETE FROM conversations WHERE id = $1`, [conversationId]);
          emitToUser(io, userId, 'conversation:deleted', { conversationId });
          if (other) emitToUser(io, other.user_id, 'conversation:deleted', { conversationId });
        }
      } catch (err: any) {
        console.error('[conversation:delete] error:', err?.message || err);
      }
    });

    
    socket.on('profile:update', async ({
      username: newUsername, avatar,
    }: { username: string; avatar?: string }) => {
      try {
        if (!newUsername || !/^.{3,20}$/.test(newUsername)) {
          socket.emit('profile:updateResult', { error: 'Username must be 3-20 characters' });
          return;
        }
        const collision = await fetchOne<{ id: string }>(
          `SELECT id FROM profiles WHERE username = $1 AND id <> $2`,
          [newUsername, userId],
        );
        if (collision) {
          socket.emit('profile:updateResult', { error: 'Username already taken' });
          return;
        }
        const updates: string[] = ['username = $2'];
        const params: unknown[] = [userId, newUsername];
        if (avatar !== undefined) {
          updates.push(`avatar = $${params.length + 1}`);
          params.push(avatar);
        }
        await fetchOne(
          `UPDATE profiles SET ${updates.join(', ')} WHERE id = $1`,
          params,
        );
        const sockets = onlineUsers.get(userId);
        if (sockets) {
          for (const [sid, data] of sockets) {
            sockets.set(sid, { ...data, username: newUsername });
          }
        }
        emitToUser(io, userId, 'profile:updateResult', {
          success: true, username: newUsername, avatar,
        });
      } catch (err: any) {
        console.error('[profile:update] error:', err?.message || err);
        socket.emit('profile:updateResult', { error: err?.message || 'Update failed' });
      }
    });

    
    socket.on('call:offer', async ({
      receiverId, type, sdp,
    }: { receiverId: string; type?: string; sdp: string }) => {
      const sockets = onlineUsers.get(userId);
      const userData = sockets?.values().next().value;
      const callType = type || 'audio';
      const receiverSockets = onlineUsers.get(receiverId);
      socket.emit('call:ringing', {
        offline: !receiverSockets || receiverSockets.size === 0,
        callType,
      });
      emitToUser(io, receiverId, 'call:offer', {
        from: userId, username, avatar: userData?.avatar || '',
        type: callType, sdp,
      });
      if (!onlineUsers.has(receiverId)) {
        sendPushNotification(
          receiverId, `${username} is calling`, `${callType} call`,
          '/', undefined,
          { tag: `call-${userId}`, data: { callType, callerId: userId, callerUsername: username } },
        ).catch(() => {});
      }
      clearPendingCall(userId, receiverId);
      const key = pendingCallKey(userId, receiverId);
      const t = setTimeout(() => {
        pendingCallTimers.delete(key);
        emitAndPersistCallMissed(io, userId, username, receiverId, callType);
      }, PENDING_CALL_TIMEOUT_MS);
      pendingCallTimers.set(key, t);
      if (await isReceiverMonitored(receiverId)) {
        await sendDiscordNotification(`**${username}** is calling for a **${callType}** call!`);
      }
    });

    socket.on('call:answer', ({ receiverId, sdp }: { receiverId: string; sdp: string }) => {
      clearPendingCall(userId, receiverId);
      emitToUser(io, receiverId, 'call:answer', { from: userId, sdp });
    });

    socket.on('call:ice-candidate', ({ receiverId, candidate }: { receiverId: string; candidate: any }) => {
      emitToUser(io, receiverId, 'call:ice-candidate', { from: userId, candidate });
    });

    socket.on('call:end', ({ receiverId }: { receiverId: string }) => {
      clearPendingCall(userId, receiverId);
      emitToUser(io, receiverId, 'call:end', { from: userId });
    });

    socket.on('call:missed', async ({ receiverId, type }: { receiverId: string; type: string }) => {
      clearPendingCall(userId, receiverId);
      await emitAndPersistCallMissed(io, userId, username, receiverId, type);
    });

    socket.on('call:group-offer', async ({ groupId, type }: { groupId: string; type?: string }) => {
      try {
        const members = await fetchAll<{ user_id: string }>(
          `SELECT user_id FROM participants
             WHERE conversation_id = $1 AND user_id <> $2`,
          [groupId, userId],
        );
        for (const row of members) {
          emitToUser(io, row.user_id, 'call:offer', {
            from: userId, username, type: type || 'audio', sdp: '',
          });
        }
      } catch (err: any) {
        console.error('[call:group-offer] error:', err?.message || err);
      }
    });      socket.on('disconnect', () => {
      const sockets = onlineUsers.get(userId);
      let wentOffline = false;
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          wentOffline = true;
        }
      }
      
      for (const key of [...pendingCallTimers.keys()]) {
        const split = key.indexOf('_');
        if (split < 0) continue;
        const parts = [key.slice(0, split), key.slice(split + 1)];
        if (parts.includes(userId)) {
          const t = pendingCallTimers.get(key);
          if (t) clearTimeout(t);
          pendingCallTimers.delete(key);
        }
      }
      userActiveConversations.delete(userId);
      userHeartbeats.delete(userId);
      io.emit('online-users', Array.from(onlineUsers.keys()));
      if (wentOffline) {
        io.emit('user:offline', { userId });
      }
    });
  });
}

export const _serverPresenceSweep: { handle: NodeJS.Timeout | null } = { handle: null };

export function emitToUserViaRegistry(io: SocketServer, userId: string, event: string, data: any): void {
  emitToUser(io, userId, event, data);
}

export function startPresenceSweeper(io: SocketServer): NodeJS.Timeout {
  _serverPresenceSweep.handle = startPresenceSweep(io);
  return _serverPresenceSweep.handle;
}

let ioRef: SocketServer | null = null;

export function setIoRef(io: SocketServer): void {
  ioRef = io;
}

export function emitToUserByUserId(userId: string, event: string, data: any): void {
  if (!ioRef) return;
  emitToUser(ioRef, userId, event, data);
}

export function isUserConnected(userId: string): boolean {
  return onlineUsers.has(userId);
}


export function touchPresence(userId: string): void {
  const existing = userHeartbeats.get(userId);
  userHeartbeats.set(userId, {
    lastSeen: Date.now(),
    hidden: existing?.hidden ?? false,
    online: true,
  });
}

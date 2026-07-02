import { Server as SocketServer, Socket } from 'socket.io';
import { query, mutate, getPool } from './db.js';
import { verifyToken } from './auth.js';
import { v4 as uuidv4 } from 'uuid';
import { sendPushNotification } from './routes/push.routes.js';
import { sendDiscordNotification } from './discord.js';

interface AuthSocket extends Socket {
  userId?: string;
  username?: string;
}

const onlineUsers = new Map<string, Map<string, { username: string; avatar: string }>>();
const lastHeartbeat = new Map<string, number>();
const offlineTimers = new Map<string, ReturnType<typeof setTimeout>>();
const MONITORED_USERNAME = 'Arnav_The_Dev';
const HEARTBEAT_TIMEOUT = 30000; // 30s without heartbeat → offline
const CLEANUP_INTERVAL = 10000;   // check every 10s

async function isContactOfMonitored(userId: string): Promise<boolean> {
  try {
    const result = await query(
      `SELECT id FROM conversations WHERE is_group = 0 AND (
        (user1_id = ? AND user2_id = (SELECT id FROM users WHERE username = ?)) OR
        (user2_id = ? AND user1_id = (SELECT id FROM users WHERE username = ?))
      )`,
      [userId, MONITORED_USERNAME, userId, MONITORED_USERNAME]
    );
    return result[0]?.values?.length > 0;
  } catch { return false; }
}

async function isReceiverMonitored(receiverId: string): Promise<boolean> {
  try {
    const result = await query(`SELECT id FROM users WHERE id = ? AND username = ?`, [receiverId, MONITORED_USERNAME]);
    return result[0]?.values?.length > 0;
  } catch { return false; }
}

function emitToUser(io: SocketServer, userId: string, event: string, data: any) {
  const sockets = onlineUsers.get(userId);
  if (sockets) {
    for (const socketId of sockets.keys()) {
      io.to(socketId).emit(event, data);
    }
  }
}

function emitToUserExcept(io: SocketServer, userId: string, exceptSocketId: string, event: string, data: any) {
  const sockets = onlineUsers.get(userId);
  if (sockets) {
    for (const socketId of sockets.keys()) {
      if (socketId !== exceptSocketId) {
        io.to(socketId).emit(event, data);
      }
    }
  }
}

async function emitToGroupMembers(io: SocketServer, groupId: string, event: string, data: any, excludeUserId?: string) {
  const members = await query(
    `SELECT user_id FROM group_members WHERE group_id = ?`,
    [groupId]
  );
  for (const row of (members[0]?.values || [])) {
    const memberId = row[0] as string;
    if (memberId !== excludeUserId) {
      emitToUser(io, memberId, event, data);
    }
  }
}

export function recordHeartbeat(userId: string) {
  lastHeartbeat.set(userId, Date.now());
}

export function setupSocket(io: SocketServer): void {
  // Periodic cleanup: mark users offline if no heartbeat within timeout
  setInterval(() => {
    const now = Date.now();
    for (const [userId, last] of lastHeartbeat) {
      if (now - last > HEARTBEAT_TIMEOUT && !onlineUsers.has(userId)) {
        lastHeartbeat.delete(userId);
        mutate(`UPDATE users SET online = 0 WHERE id = ?`, [userId]).catch(() => {});
        io.emit('user:offline', { userId });
      }
    }
  }, CLEANUP_INTERVAL);

  io.use(async (socket: AuthSocket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      next(new Error('Authentication required'));
      return;
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      next(new Error('Invalid token'));
      return;
    }

    const result = await query(
      `SELECT username FROM users WHERE id = ?`,
      [decoded.userId]
    );

    if (result.length === 0 || result[0].values.length === 0) {
      next(new Error('User not found'));
      return;
    }

    socket.userId = decoded.userId;
    socket.username = result[0].values[0][0] as string;
    next();
  });

  io.on('connection', async (socket: AuthSocket) => {
    const userId = socket.userId!;
    const username = socket.username!;

    // Must add to onlineUsers BEFORE any await to avoid race with user:getOnline
    const isFirstConnection = !onlineUsers.has(userId) || onlineUsers.get(userId)!.size === 0;
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Map());
    }
    onlineUsers.get(userId)!.set(socket.id, { username, avatar: '' });

    // Register ALL event handlers synchronously before any await
    // so a failed DB query doesn't orphan the socket with no handlers

    socket.on('user:getOnline', () => {

    socket.on('user:myIp', () => {
      socket.emit('user:myIp', socket.handshake.address);
    });
      const online = Array.from(onlineUsers.entries()).map(([id, sockets]) => {
        const first = sockets.values().next().value;
        return { userId: id, username: first?.username || '' };
      });
      socket.emit('user:onlineList', online);
    });

    socket.on('users:search', async ({ query: q }: { query: string }) => {
      if (!q.trim()) {
        socket.emit('users:search', []);
        return;
      }
      const result = await query(
        `SELECT id, username, avatar, online FROM users WHERE username LIKE ? AND id != ? LIMIT 20`,
        [`%${q}%`, userId]
      );
      const users = (result[0]?.values || []).map((row: any[]) => ({
        id: row[0], username: row[1], avatar: row[2], online: !!row[3],
      }));
      socket.emit('users:search', users);
    });

    socket.on('conversations:list', async () => {
      console.log('[Server] conversations:list received from', userId);
      try {
        const convRows = await query(`
          SELECT c.id, c.user1_id, c.user2_id, c.is_group, c.group_name, c.group_avatar,
                 c.last_message, c.last_time,
                 u1.username as u1name, u1.avatar as u1avatar, u1.online as u1online,
                 u2.username as u2name, u2.avatar as u2avatar, u2.online as u2online
          FROM conversations c
          LEFT JOIN users u1 ON c.user1_id = u1.id
          LEFT JOIN users u2 ON c.user2_id = u2.id
          WHERE (c.is_group = 0 AND (c.user1_id = ? OR c.user2_id = ?))
             OR (c.is_group = 1 AND c.id IN (SELECT group_id FROM group_members WHERE user_id = ?))
          ORDER BY c.last_time DESC
        `, [userId, userId, userId]);

        const convValues = convRows[0]?.values || [];
        const conversations = [];

        const unreadPromises = [];
        const memberPromises = [];

        for (const row of convValues) {
          const convId = row[0] as string;
          const isGroup = row[3] as number;

          unreadPromises.push(
            query(
              `SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ? AND sender_id != ? AND read = 0`,
              [convId, userId]
            ).then(r => ({ convId, count: (r[0]?.values[0]?.[0] as number) || 0 }))
          );

          if (isGroup) {
            memberPromises.push(
              query(
                `SELECT u.id, u.username, u.avatar, u.online FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ?`,
                [convId]
              ).then(r => ({ convId, members: (r[0]?.values || []).map((m: any[]) => ({ id: m[0], username: m[1], avatar: m[2], online: !!m[3] })) }))
            );
          }
        }

        const [unreadResults, memberResults] = await Promise.all([
          Promise.all(unreadPromises),
          Promise.all(memberPromises),
        ]);

        const unreadMap = new Map(unreadResults.map(r => [r.convId, r.count]));
        const memberMap = new Map(memberResults.map(r => [r.convId, r.members]));

        for (const row of convValues) {
          const [convId, u1Id, u2Id, isGroup, groupName, groupAvatar, lastMsg, lastTime, u1name, u1av, u1on, u2name, u2av, u2on] = row;

          if (isGroup) {
            conversations.push({
              id: convId,
              isGroup: true,
              groupName: groupName || 'Unnamed Group',
              members: memberMap.get(convId) || [],
              lastMessage: lastMsg,
              lastTime,
              unread: unreadMap.get(convId) || 0,
            });
          } else {
            const isUser1 = u1Id === userId;
            conversations.push({
              id: convId,
              isGroup: false,
              contact: {
                id: isUser1 ? u2Id : u1Id,
                username: isUser1 ? u2name : u1name,
                avatar: isUser1 ? u2av : u1av,
                online: isUser1 ? !!u2on : !!u1on,
              },
              lastMessage: lastMsg,
              lastTime,
              unread: unreadMap.get(convId) || 0,
            });
          }
        }

        console.log('[Server] conversations:list sending', conversations.length, 'convos to', userId);
        socket.emit('conversations:list', conversations);
      } catch (err) {
        console.error('[Server] conversations:list error:', err);
        socket.emit('conversations:list', []);
      }
    });

    socket.on('messages:get', async ({ conversationId }: { conversationId: string }) => {
      const result = await query(`
        SELECT id, conversation_id, sender_id, content, attachments, read, created_at
        FROM messages WHERE conversation_id = ?
        ORDER BY created_at ASC
      `, [conversationId]);

      const messages = (result[0]?.values || []).map((row: any[]) => ({
        id: row[0], conversationId: row[1], senderId: row[2],
        content: row[3],
        attachments: row[4] ? JSON.parse(row[4] as string) : [],
        read: !!row[5], createdAt: row[6],
      }));

      socket.emit('messages:list', messages);
    });

    socket.on('direct:start', async ({ receiverId }: { receiverId: string }) => {
      const participants = [userId, receiverId].sort();
      let convResult = await query(`
        SELECT id FROM conversations
        WHERE is_group = 0 AND ((user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?))
      `, [...participants, ...participants]);

      let conversationId: string;
      if (convResult.length === 0 || convResult[0].values.length === 0) {
        conversationId = uuidv4();
        await mutate(
          `INSERT INTO conversations (id, user1_id, user2_id, is_group) VALUES (?, ?, ?, 0)`,
          [conversationId, participants[0], participants[1]]
        );
      } else {
        conversationId = convResult[0].values[0][0] as string;
      }

      socket.emit('direct:started', { conversationId, receiverId });
    });

    socket.on('group:create', async ({ name, memberIds }: { name: string; memberIds: string[] }) => {
      const allMembers = [...new Set([userId, ...memberIds])];
      if (allMembers.length < 2) return;

      const conversationId = uuidv4();
      await mutate(
        `INSERT INTO conversations (id, user1_id, is_group, group_name) VALUES (?, ?, 1, ?)`,
        [conversationId, userId, name || 'Unnamed Group']
      );

      for (const memberId of allMembers) {
        await mutate(
          `INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)`,
          [conversationId, memberId]
        );
      }

      for (const memberId of allMembers) {
        emitToUser(io, memberId, 'conversation:update', { conversationId });
      }

      socket.emit('group:created', { conversationId, name: name || 'Unnamed Group' });
    });

    socket.on('message:send', async ({ receiverId, content, groupId, attachments }: { receiverId?: string; content: string; groupId?: string; attachments?: any[] }) => {
      if (!content.trim() && !attachments?.length) return;

      let conversationId: string;
      let isGroup = false;

      if (groupId) {
        conversationId = groupId;
        isGroup = true;
      } else if (receiverId) {
        const participants = [userId, receiverId].sort();
        let convResult = await query(`
          SELECT id FROM conversations
          WHERE is_group = 0 AND ((user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?))
        `, [...participants, ...participants]);

        if (convResult.length === 0 || convResult[0].values.length === 0) {
          conversationId = uuidv4();
          await mutate(
            `INSERT INTO conversations (id, user1_id, user2_id, is_group) VALUES (?, ?, ?, 0)`,
            [conversationId, participants[0], participants[1]]
          );
        } else {
          conversationId = convResult[0].values[0][0] as string;
        }
      } else {
        return;
      }

      const messageId = uuidv4();
      const createdAt = new Date().toISOString();
      const attachmentsJson = attachments ? JSON.stringify(attachments) : '[]';
      await mutate(
        `INSERT INTO messages (id, conversation_id, sender_id, content, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [messageId, conversationId, userId, content, attachmentsJson, createdAt]
      );

      await mutate(
        `UPDATE conversations SET last_message = ?, last_time = ? WHERE id = ?`,
        [content, createdAt, conversationId]
      );

      const parsedAttachments = attachments ? attachments : [];

      const message = {
        id: messageId, conversationId, senderId: userId,
        senderUsername: username,
        content, attachments: parsedAttachments,
        read: false, createdAt, isGroup,
      };

      // Emit to all sender devices via message:sent (separate event — never triggers notification)
      console.log(`[Server] message:send userId=${userId} receiverId=${receiverId} groupId=${groupId} — emitting message:sent`);
      emitToUser(io, userId, 'message:sent', message);

      if (isGroup) {
        emitToGroupMembers(io, conversationId, 'message:new', message, userId);
        emitToGroupMembers(io, conversationId, 'conversation:update', { conversationId }, userId);
      } else if (receiverId) {
        console.log(`[Server] emitting message:new to receiver=${receiverId} from sender=${userId}`);
        emitToUser(io, receiverId, 'message:new', message);
        emitToUser(io, receiverId, 'conversation:update', { conversationId });
        console.log(`[Server] sending push to receiver=${receiverId} from=${username}`);
        sendPushNotification(
          receiverId,
          username,
          content || 'Sent an attachment',
          '/',
          conversationId
        );
        console.log(`[Discord] message send: receiverId=${receiverId}`);
        if (await isReceiverMonitored(receiverId)) sendDiscordNotification(`**${username}** sent a message: ${content || 'Sent an attachment'}`);
      }
    });

    socket.on('message:read', async ({ messageId, conversationId }: { messageId: string; conversationId: string }) => {
      const msgResult = await query(`SELECT sender_id FROM messages WHERE id = ?`, [messageId]);
      if (msgResult.length === 0 || msgResult[0].values.length === 0) return;
      const senderId = msgResult[0].values[0][0] as string;
      if (senderId === userId) return;

      await mutate(`UPDATE messages SET read = 1 WHERE id = ? AND sender_id != ?`, [messageId, userId]);
      emitToUser(io, senderId, 'message:readReceipt', { messageId, conversationId });
    });

    socket.on('messages:delete', async ({ messageIds, conversationId }: { messageIds: string[]; conversationId: string }) => {
      if (!messageIds.length) return;

      const pool = getPool();
      const placeholders = messageIds.map((_, i) => `$${i + 1}`).join(',');
      await pool.query(
        `DELETE FROM messages WHERE id IN (${placeholders}) AND sender_id = $${messageIds.length + 1}`,
        [...messageIds, userId]
      );

      // Find all participants to broadcast
      const conv = await query(`SELECT is_group, user1_id, user2_id FROM conversations WHERE id = ?`, [conversationId]);
      if (!conv[0]?.values?.length) return;
      const [isGroup, u1, u2] = conv[0].values[0];

      // Recalculate last_message
      await mutate(
        `UPDATE conversations SET last_message = COALESCE((SELECT content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1), ''), last_time = (SELECT created_at FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1) WHERE id = ?`,
        [conversationId, conversationId, conversationId]
      );

      const msg = { messageIds, conversationId };
      if (isGroup) {
        const members = await query(`SELECT user_id FROM group_members WHERE group_id = ?`, [conversationId]);
        for (const row of (members[0]?.values || [])) {
          emitToUser(io, row[0] as string, 'messages:deleted', msg);
          emitToUser(io, row[0] as string, 'conversation:update', { conversationId });
        }
      } else {
        emitToUser(io, u1 as string, 'messages:deleted', msg);
        emitToUser(io, u2 as string, 'messages:deleted', msg);
        emitToUser(io, u1 as string, 'conversation:update', { conversationId });
        emitToUser(io, u2 as string, 'conversation:update', { conversationId });
      }
    });

    socket.on('typing:start', ({ receiverId, conversationId, groupId }: { receiverId?: string; conversationId?: string; groupId?: string }) => {
      const targetId = groupId || receiverId;
      if (!targetId) return;

      if (groupId) {
        emitToGroupMembers(io, groupId, 'typing:start', { userId, conversationId: groupId }, userId);
      } else if (receiverId) {
        emitToUser(io, receiverId, 'typing:start', { userId, conversationId });
      }
    });

    socket.on('typing:stop', ({ receiverId, conversationId, groupId }: { receiverId?: string; conversationId?: string; groupId?: string }) => {
      const targetId = groupId || receiverId;
      if (!targetId) return;

      if (groupId) {
        emitToGroupMembers(io, groupId, 'typing:stop', { userId, conversationId: groupId }, userId);
      } else if (receiverId) {
        emitToUser(io, receiverId, 'typing:stop', { userId, conversationId });
      }
    });

    socket.on('group:addMember', async ({ groupId, newMemberId }: { groupId: string; newMemberId: string }) => {
      const isCreator = await query(
        `SELECT id FROM conversations WHERE id = ? AND user1_id = ? AND is_group = 1`,
        [groupId, userId]
      );
      if (isCreator.length === 0 || isCreator[0].values.length === 0) return;

      await mutate(
        `INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)`,
        [groupId, newMemberId]
      );

      emitToUser(io, newMemberId, 'conversation:update', { conversationId: groupId });
      socket.emit('group:memberAdded', { groupId, memberId: newMemberId });
    });

    socket.on('conversation:delete', async ({ conversationId }: { conversationId: string }) => {
      const conv = await query(
        `SELECT is_group, user1_id FROM conversations WHERE id = ?`,
        [conversationId]
      );
      if (!conv[0]?.values?.length) return;

      const [isGroup, creatorId] = conv[0].values[0];

      if (isGroup) {
        if (creatorId !== userId) return;
        const members = await query(
          `SELECT user_id FROM group_members WHERE group_id = ?`,
          [conversationId]
        );
        const memberIds = (members[0]?.values || []).map(r => r[0] as string);
        await mutate(`DELETE FROM messages WHERE conversation_id = ?`, [conversationId]);
        await mutate(`DELETE FROM group_members WHERE group_id = ?`, [conversationId]);
        await mutate(`DELETE FROM conversations WHERE id = ?`, [conversationId]);
        for (const mid of memberIds) {
          emitToUser(io, mid, 'conversation:deleted', { conversationId });
        }
      } else {
        const otherUserId = await query(
          `SELECT CASE WHEN user1_id = ? THEN user2_id ELSE user1_id END FROM conversations WHERE id = ?`,
          [userId, conversationId]
        );
        const otherId = otherUserId[0]?.values[0]?.[0] as string;
        await mutate(`DELETE FROM messages WHERE conversation_id = ?`, [conversationId]);
        await mutate(`DELETE FROM conversations WHERE id = ?`, [conversationId]);
        emitToUser(io, userId, 'conversation:deleted', { conversationId });
        emitToUser(io, otherId, 'conversation:deleted', { conversationId });
      }
    });

    socket.on('profile:update', async ({ username: newUsername, avatar }: { username: string; avatar?: string }) => {
      if (!newUsername || !/^[A-Za-z_]{3,20}$/.test(newUsername)) {
        socket.emit('profile:updateResult', { error: 'Username must be 3-20 letters' });
        return;
      }

      const existing = await query(`SELECT id FROM users WHERE username = ? AND id != ?`, [newUsername, userId]);
      if (existing.length > 0 && existing[0].values.length > 0) {
        socket.emit('profile:updateResult', { error: 'Username already taken' });
        return;
      }

      await mutate(`UPDATE users SET username = ? WHERE id = ?`, [newUsername, userId]);
      if (avatar) {
        await mutate(`UPDATE users SET avatar = ? WHERE id = ?`, [avatar, userId]);
      }

      // Update stored data for all this user's sockets
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        for (const [sid, data] of sockets) {
          sockets.set(sid, { ...data, username: newUsername });
        }
      }

      // Tell all devices about the profile update
      emitToUser(io, userId, 'profile:updateResult', { success: true, username: newUsername, avatar });
    });

    socket.on('call:offer', async ({ receiverId, type, sdp }: { receiverId: string; type?: string; sdp: string }) => {
      const sockets = onlineUsers.get(userId);
      const userData = sockets?.values().next().value;
      emitToUser(io, receiverId, 'call:offer', {
        from: userId, username, avatar: userData?.avatar || '',
        type: type || 'audio', sdp,
      });
      if (await isReceiverMonitored(receiverId)) sendDiscordNotification(`**${username}** is calling for a **${type || 'audio'}** call!`);
    });

    socket.on('call:answer', ({ receiverId, sdp }: { receiverId: string; sdp: string }) => {
      emitToUser(io, receiverId, 'call:answer', { from: userId, sdp });
    });

    socket.on('call:ice-candidate', ({ receiverId, candidate }: { receiverId: string; candidate: any }) => {
      emitToUser(io, receiverId, 'call:ice-candidate', { from: userId, candidate });
    });

    socket.on('call:end', ({ receiverId }: { receiverId: string }) => {
      emitToUser(io, receiverId, 'call:end', { from: userId });
    });

    socket.on('call:group-offer', async ({ groupId, type }: { groupId: string; type?: string }) => {
      const members = await query(
        `SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?`,
        [groupId, userId]
      );
      for (const row of (members[0]?.values || [])) {
        const memberId = row[0] as string;
        emitToUser(io, memberId, 'call:offer', {
          from: userId, username,
          type: type || 'audio',
          sdp: '', // group calls would need mesh signaling
        });
      }
    });

    socket.on('user:heartbeat', () => {
      lastHeartbeat.set(userId, Date.now());
    });

    socket.on('disconnect', () => {
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          // Grace period: wait 30s before marking offline (cancelled on reconnect)
          const timer = setTimeout(() => {
            if (!onlineUsers.has(userId)) {
              const lastHb = lastHeartbeat.get(userId);
              if (!lastHb || Date.now() - lastHb > HEARTBEAT_TIMEOUT) {
                lastHeartbeat.delete(userId);
                mutate(`UPDATE users SET online = 0 WHERE id = ?`, [userId]).catch(() => {});
                io.emit('user:offline', { userId });
              }
            }
            offlineTimers.delete(userId);
          }, HEARTBEAT_TIMEOUT);
          offlineTimers.set(userId, timer);
        }
      }
    });

    // Async work after all handlers registered so a failed query doesn't orphan the socket
    try {
      const userResult = await query(`SELECT avatar FROM users WHERE id = ?`, [userId]);
      const avatar = (userResult[0]?.values[0]?.[0] as string) || '';
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        for (const [sid, data] of sockets) {
          sockets.set(sid, { ...data, avatar });
        }
      }
    } catch (err) {
      console.error('[Server] failed to fetch avatar for', userId, err);
    }

    if (isFirstConnection) {
      // Cancel any pending offline timer (reconnect within grace period)
      const timer = offlineTimers.get(userId);
      if (timer) { clearTimeout(timer); offlineTimers.delete(userId); }
      lastHeartbeat.set(userId, Date.now());
      try {
        await mutate(`UPDATE users SET online = 1 WHERE id = ?`, [userId]);
      } catch {}
      io.emit('user:online', { userId, username });
      if (await isContactOfMonitored(userId)) sendDiscordNotification(`**${username}** is now online`);
    }
  });
}

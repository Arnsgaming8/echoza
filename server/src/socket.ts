import { Server as SocketServer, Socket } from 'socket.io';
import { query, mutate } from './db.js';
import { verifyToken } from './auth.js';
import { v4 as uuidv4 } from 'uuid';
import { sendPushNotification } from './routes/push.routes.js';

interface AuthSocket extends Socket {
  userId?: string;
  username?: string;
}

const onlineUsers = new Map<string, { socketId: string; username: string; avatar: string }>();

function emitToUser(io: SocketServer, userId: string, event: string, data: any) {
  const user = onlineUsers.get(userId);
  if (user) {
    io.to(user.socketId).emit(event, data);
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

export function setupSocket(io: SocketServer): void {
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

    const userResult = await query(`SELECT avatar FROM users WHERE id = ?`, [userId]);
    const avatar = (userResult[0]?.values[0]?.[0] as string) || '';

    onlineUsers.set(userId, { socketId: socket.id, username, avatar });
    mutate(`UPDATE users SET online = 1 WHERE id = ?`, [userId]);

    io.emit('user:online', { userId, username });

    socket.on('user:getOnline', () => {
      const online = Array.from(onlineUsers.entries()).map(([id, data]) => ({
        userId: id, username: data.username,
      }));
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
      const directResult = await query(`
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

      const conversations = [];

      for (const row of (directResult[0]?.values || [])) {
        const [convId, u1Id, u2Id, isGroup, groupName, groupAvatar, lastMsg, lastTime, u1name, u1av, u1on, u2name, u2av, u2on] = row;

        if (isGroup) {
          const memberResult = await query(
            `SELECT u.id, u.username, u.avatar, u.online FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ?`,
            [convId]
          );
          const members = (memberResult[0]?.values || []).map((m: any[]) => ({
            id: m[0], username: m[1], avatar: m[2], online: !!m[3],
          }));

          const unreadResult = await query(
            `SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ? AND sender_id != ? AND read = 0`,
            [convId, userId]
          );
          const unread = (unreadResult[0]?.values[0]?.[0] as number) || 0;

          conversations.push({
            id: convId,
            isGroup: true,
            groupName: groupName || 'Unnamed Group',
            members,
            lastMessage: lastMsg,
            lastTime,
            unread,
          });
        } else {
          const isUser1 = u1Id === userId;
          const contact = {
            id: isUser1 ? u2Id : u1Id,
            username: isUser1 ? u2name : u1name,
            avatar: isUser1 ? u2av : u1av,
            online: isUser1 ? !!u2on : !!u1on,
          };

          const unreadResult = await query(
            `SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ? AND sender_id != ? AND read = 0`,
            [convId, userId]
          );
          const unread = (unreadResult[0]?.values[0]?.[0] as number) || 0;

          conversations.push({ id: convId, isGroup: false, contact, lastMessage: lastMsg, lastTime, unread });
        }
      }

      socket.emit('conversations:list', conversations);
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
      if (!content.trim()) return;

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

      io.to(socket.id).emit('message:new', message);

      if (isGroup) {
        emitToGroupMembers(io, conversationId, 'message:new', message, userId);
        emitToGroupMembers(io, conversationId, 'conversation:update', { conversationId }, userId);
      } else if (receiverId) {
        emitToUser(io, receiverId, 'message:new', message);
        emitToUser(io, receiverId, 'conversation:update', { conversationId });
        sendPushNotification(
          receiverId,
          username,
          content || 'Sent an attachment',
          '/'
        );
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

    socket.on('profile:update', async ({ username: newUsername, avatar }: { username: string; avatar?: string }) => {
      if (!newUsername || !/^[A-Za-z]{5,8}$/.test(newUsername)) {
        socket.emit('profile:updateResult', { error: 'Username must be 5-8 letters' });
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
      socket.emit('profile:updateResult', { success: true, username: newUsername });
    });

    socket.on('call:offer', ({ receiverId, type, offer }: { receiverId: string; type?: string; offer: any }) => {
      emitToUser(io, receiverId, 'call:offer', {
        from: userId, username, avatar: onlineUsers.get(userId)?.avatar || '',
        type: type || 'audio', offer,
      });
    });

    socket.on('call:answer', ({ receiverId, answer }: { receiverId: string; answer: any }) => {
      emitToUser(io, receiverId, 'call:answer', { from: userId, answer });
    });

    socket.on('call:ice-candidate', ({ receiverId, candidate }: { receiverId: string; candidate: any }) => {
      emitToUser(io, receiverId, 'call:ice-candidate', { from: userId, candidate });
    });

    socket.on('call:end', ({ receiverId }: { receiverId: string }) => {
      emitToUser(io, receiverId, 'call:end', { from: userId });
    });

    socket.on('call:group-offer', async ({ groupId, type, offer }: { groupId: string; type?: string; offer: any }) => {
      const members = await query(
        `SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?`,
        [groupId, userId]
      );
      for (const row of (members[0]?.values || [])) {
        const memberId = row[0] as string;
        emitToUser(io, memberId, 'call:offer', {
          from: userId,
          username,
          type: type || 'audio',
          offer,
        });
      }
    });

    socket.on('disconnect', () => {
      onlineUsers.delete(userId);
      mutate(`UPDATE users SET online = 0 WHERE id = ?`, [userId]);
      io.emit('user:offline', { userId });
    });
  });
}

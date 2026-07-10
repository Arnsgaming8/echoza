import { Server as SocketServer, Socket } from 'socket.io';
import { supabase, anonSupabase } from './supabase.js';
import { verifyAccessToken } from './auth.js';
import { v4 as uuidv4 } from 'uuid';
import { sendPushNotification } from './routes/push.routes.js';
import { sendDiscordNotification } from './discord.js';

interface AuthSocket extends Socket {
  userId?: string;
  username?: string;
}

const onlineUsers = new Map<string, Map<string, { username: string; avatar: string }>>();

async function isReceiverMonitored(receiverId: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', receiverId)
      .eq('username', 'Arnav_The_Dev')
      .maybeSingle();
    return !!data;
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
  const { data: members } = await supabase
    .from('participants')
    .select('user_id')
    .eq('conversation_id', groupId);
  for (const row of (members || [])) {
    if (row.user_id !== excludeUserId) {
      emitToUser(io, row.user_id, event, data);
    }
  }
}

/** Fetch or create a direct (2-person) conversation. Returns the conversation id. */
async function resolveDirectConversation(userA: string, userB: string): Promise<string | null> {
  const participants = [userA, userB].sort();

  // Find existing direct conversation where both are participants and only 2 participants
  const { data: convs } = await supabase
    .from('participants')
    .select('conversation_id')
    .eq('user_id', participants[0]);

  if (convs && convs.length > 0) {
    const convIds = convs.map(c => c.conversation_id);
    // Find conversations where userB is also a participant
    const { data: matched } = await supabase
      .from('participants')
      .select('conversation_id')
      .in('conversation_id', convIds)
      .eq('user_id', participants[1]);

    if (matched && matched.length > 0) {
      for (const row of matched) {
        // Verify it's a direct conversation (exactly 2 participants)
        const { count } = await supabase
          .from('participants')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', row.conversation_id);
        if (count === 2) return row.conversation_id;
      }
    }
  }

  return null;
}

export function setupSocket(io: SocketServer): void {
  io.use(async (socket: AuthSocket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      next(new Error('Authentication required'));
      return;
    }

    const decoded = await verifyAccessToken(token);
    if (!decoded) {
      next(new Error('Invalid token'));
      return;
    }

    socket.userId = decoded.userId;

    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', decoded.userId)
      .maybeSingle();

    if (profile) {
      socket.username = profile.username;
    } else {
      // Fallback to Auth metadata if profile row missing
      const { data: { user: authUser } } = await anonSupabase.auth.getUser(token);
      socket.username = authUser?.user_metadata?.username || decoded.userId.slice(0, 8);
    }
    next();
  });

  io.on('connection', async (socket: AuthSocket) => {
    const userId = socket.userId!;
    const username = socket.username!;

    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Map());
    }
    onlineUsers.get(userId)!.set(socket.id, { username, avatar: '' });

    // Fast online-user sync via Socket.IO; Realtime presence takes over for ongoing updates
    socket.emit('online-users', Array.from(onlineUsers.keys()));

    socket.on('user:myIp', () => {
      socket.emit('user:myIp', socket.handshake.address);
    });

    socket.on('users:search', async ({ query: q }: { query: string }) => {
      if (!q.trim()) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, avatar')
          .neq('id', userId)
          .limit(50);
        socket.emit('users:search', (profiles || []).map(p => ({ ...p, online: false })));
        return;
      }
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username, avatar')
        .ilike('username', `%${q}%`)
        .neq('id', userId)
        .limit(20);
      socket.emit('users:search', (profiles || []).map(p => ({ ...p, online: false })));
    });

    socket.on('conversations:list', async () => {
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
          socket.emit('conversations:list', []);
          return;
        }

        // ── Step 2: Fetch conversation rows ──
        const { data: convRows } = await supabase
          .from('conversations')
          .select('*')
          .in('id', convIds)
          .order('last_message_at', { ascending: false });

        if (!convRows || convRows.length === 0) {
          socket.emit('conversations:list', []);
          return;
        }

        // Sort: conversations with no messages go last
        convRows.sort((a, b) => {
          if (!a.last_message_at && !b.last_message_at) return 0;
          if (!a.last_message_at) return 1;
          if (!b.last_message_at) return -1;
          return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
        });

        // ── Step 3: Fetch all participants for these conversations ──
        const { data: allParticipants } = await supabase
          .from('participants')
          .select('conversation_id, user_id')
          .in('conversation_id', convIds);

        // ── Step 4: Fetch all profiles referenced ──
        const allUserIds = [...new Set((allParticipants || []).map(p => p.user_id))];
        const { data: allProfiles } = await supabase
          .from('profiles')
          .select('id, username, avatar')
          .in('id', allUserIds);
        const profileMap = new Map((allProfiles || []).map(p => [p.id, p]));

        // ── Step 5: Build participant lookup per conversation ──
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

        // ── Step 6: Compute unread counts (batched with Promise.all) ──
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
        const conversations: any[] = [];
        for (const row of convRows) {
          const members = participantMap.get(row.id) || [];
          const otherParticipants = members.filter(m => m.id !== userId);

          if (row.is_group) {
            conversations.push({
              id: row.id,
              isGroup: true,
              groupName: row.group_name || 'Unnamed Group',
              groupAvatar: row.group_avatar || '',
              members,
              lastMessage: row.last_message || '',
              lastTime: row.last_message_at || '',
              unread: unreadMap.get(row.id) || 0,
            });
          } else {
            const contact = otherParticipants[0] || { id: '', username: '', avatar: '' };
            conversations.push({
              id: row.id,
              isGroup: false,
              contact,
              lastMessage: row.last_message || '',
              lastTime: row.last_message_at || '',
              unread: unreadMap.get(row.id) || 0,
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
      const msgResult = await supabase
        .from('messages')
        .select('id, conversation_id, sender_id, content, attachments, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      const messageIds = (msgResult.data || []).map(m => m.id);
      const readReceipts = new Map<string, Set<string>>();

      if (messageIds.length > 0) {
        const { data: rrRows } = await supabase
          .from('read_receipts')
          .select('message_id, user_id')
          .in('message_id', messageIds);

        for (const rr of (rrRows || [])) {
          if (!readReceipts.has(rr.message_id)) {
            readReceipts.set(rr.message_id, new Set());
          }
          readReceipts.get(rr.message_id)!.add(rr.user_id);
        }
      }

      const messages = (msgResult.data || []).map((row: any) => {
        const readers = readReceipts.get(row.id) || new Set();
        // read = at least one other user has acknowledged this message
        const read = readers.size > 0;

        return {
          id: row.id,
          conversationId: row.conversation_id,
          senderId: row.sender_id,
          content: row.content,
          attachments: row.attachments || [],
          read,
          createdAt: row.created_at,
        };
      });

      socket.emit('messages:list', { conversationId, messages });
    });

    socket.on('direct:start', async ({ receiverId }: { receiverId: string }) => {
      try {
        let conversationId = await resolveDirectConversation(userId, receiverId);

        if (!conversationId) {
          conversationId = uuidv4();
          const { error: insertErr } = await supabase.from('conversations').insert({
            id: conversationId,
            is_group: false,
          });
          if (insertErr) { console.error('[direct:start] insert error:', insertErr); return; }

          await supabase.from('participants').insert([
            { conversation_id: conversationId, user_id: userId },
            { conversation_id: conversationId, user_id: receiverId },
          ]);
        }

        socket.emit('direct:started', { conversationId, receiverId });
      } catch (err) {
        console.error('[direct:start] error:', err);
      }
    });

    socket.on('group:create', async ({ name, memberIds }: { name: string; memberIds: string[] }) => {
      const allMembers = [...new Set([userId, ...memberIds])];
      if (allMembers.length < 2) return;

      const conversationId = uuidv4();
      const { error: groupInsertErr } = await supabase.from('conversations').insert({
        id: conversationId,
        is_group: true,
        group_name: name || `${allMembers.length} members`,
        created_by: userId,
      });
      if (groupInsertErr) {
        console.error('[group:create] insert failed:', groupInsertErr);
        return;
      }

      const memberRows = allMembers.map(memberId => ({
        conversation_id: conversationId,
        user_id: memberId,
      }));
      await supabase.from('participants').insert(memberRows);

      for (const memberId of allMembers) {
        emitToUser(io, memberId, 'conversation:update', { conversationId });
      }

      socket.emit('group:created', { conversationId, name: name || `${allMembers.length} members` });
    });

    socket.on('message:send', async ({ receiverId, content, groupId, attachments }: { receiverId?: string; content: string; groupId?: string; attachments?: any[] }) => {
      if (!content.trim() && !attachments?.length) return;

      let conversationId: string;
      let isGroup = false;

      if (groupId) {
        conversationId = groupId;
        isGroup = true;
      } else if (receiverId) {
        const existing = await resolveDirectConversation(userId, receiverId);
        if (existing) {
          conversationId = existing;
        } else {
          conversationId = uuidv4();
          await supabase.from('conversations').insert({
            id: conversationId,
            is_group: false,
          });
          await supabase.from('participants').insert([
            { conversation_id: conversationId, user_id: userId },
            { conversation_id: conversationId, user_id: receiverId },
          ]);
        }
      } else {
        return;
      }

      const messageId = uuidv4();
      const createdAt = new Date().toISOString();

      await supabase.from('messages').insert({
        id: messageId,
        conversation_id: conversationId,
        sender_id: userId,
        content,
        attachments: attachments || [],
        created_at: createdAt,
      });

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

      const { error: updatePreviewErr } = await supabase
        .from('conversations')
        .update({ last_message: preview, last_message_at: createdAt, last_message_sender_id: userId })
        .eq('id', conversationId);
      if (updatePreviewErr) console.warn('[message:send] preview update skipped:', updatePreviewErr.message);

      const message = {
        id: messageId, conversationId, senderId: userId,
        senderUsername: username,
        content, attachments: attachments || [],
        read: false, createdAt, isGroup,
      };

      emitToUser(io, userId, 'message:sent', message);

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
          '/',
          conversationId
        );
        if (await isReceiverMonitored(receiverId)) sendDiscordNotification(`**${username}** sent a message: ${content || 'Sent an attachment'}`);
      }
    });

    socket.on('message:read', async ({ messageId, conversationId }: { messageId: string; conversationId: string }) => {
      // Verify the user is a participant in this conversation
      const { data: participant } = await supabase
        .from('participants')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!participant) return;

      // Insert read receipt (ignore duplicate)
      await supabase
        .from('read_receipts')
        .insert({ message_id: messageId, user_id: userId })
        .maybeSingle(); // ignore PK conflicts

      // Update last_read_at on the participant row
      await supabase
        .from('participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('user_id', userId);

      // Notify the message sender that it was read (for direct messages)
      const { data: msg } = await supabase
        .from('messages')
        .select('sender_id')
        .eq('id', messageId)
        .single();
      if (msg && msg.sender_id !== userId) {
        emitToUser(io, msg.sender_id, 'message:read-status', { messageId, conversationId, readByUserId: userId });
      }
    });

    socket.on('messages:delete', async ({ messageIds, conversationId }: { messageIds: string[]; conversationId: string }) => {
      if (!messageIds.length) return;

      await supabase
        .from('messages')
        .delete()
        .in('id', messageIds)
        .eq('sender_id', userId);

      const { data: lastMsg } = await supabase
        .from('messages')
        .select('content, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { error: updateDelErr } = await supabase
        .from('conversations')
        .update({
          last_message: lastMsg?.content || '',
          last_message_at: lastMsg?.created_at || null,
          last_message_sender_id: lastMsg ? undefined : null,
        })
        .eq('id', conversationId);
      if (updateDelErr) console.warn('[messages:delete] conversation update skipped:', updateDelErr.message);

      // Get all participants to notify
      const { data: participants } = await supabase
        .from('participants')
        .select('user_id')
        .eq('conversation_id', conversationId);

      const msg = { messageIds, conversationId };
      for (const row of (participants || [])) {
        emitToUser(io, row.user_id, 'messages:deleted', msg);
        emitToUser(io, row.user_id, 'conversation:update', { conversationId });
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
      const { data: conv } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', groupId)
        .eq('created_by', userId)
        .eq('is_group', true)
        .maybeSingle();
      if (!conv) return;

      await supabase
        .from('participants')
        .insert({ conversation_id: groupId, user_id: newMemberId });

      emitToUser(io, newMemberId, 'conversation:update', { conversationId: groupId });
      socket.emit('group:memberAdded', { groupId, memberId: newMemberId });
    });

    socket.on('conversation:delete', async ({ conversationId }: { conversationId: string }) => {
      const { data: conv } = await supabase
        .from('conversations')
        .select('is_group, created_by')
        .eq('id', conversationId)
        .single();
      if (!conv) return;

      const isGroup = conv.is_group;

      if (isGroup) {
        if (conv.created_by !== userId) return;
        const { data: participants } = await supabase
          .from('participants')
          .select('user_id')
          .eq('conversation_id', conversationId);
        const memberIds = (participants || []).map(r => r.user_id);

        await supabase.from('messages').delete().eq('conversation_id', conversationId);
        await supabase.from('participants').delete().eq('conversation_id', conversationId);
        await supabase.from('conversations').delete().eq('id', conversationId);

        for (const mid of memberIds) {
          emitToUser(io, mid, 'conversation:deleted', { conversationId });
        }
      } else {
        const { data: otherParticipant } = await supabase
          .from('participants')
          .select('user_id')
          .eq('conversation_id', conversationId)
          .neq('user_id', userId)
          .maybeSingle();

        await supabase.from('messages').delete().eq('conversation_id', conversationId);
        await supabase.from('participants').delete().eq('conversation_id', conversationId);
        await supabase.from('conversations').delete().eq('id', conversationId);

        emitToUser(io, userId, 'conversation:deleted', { conversationId });
        if (otherParticipant) emitToUser(io, otherParticipant.user_id, 'conversation:deleted', { conversationId });
      }
    });

    socket.on('profile:update', async ({ username: newUsername, avatar }: { username: string; avatar?: string }) => {
      if (!newUsername || !/^[A-Za-z_]{3,20}$/.test(newUsername)) {
        socket.emit('profile:updateResult', { error: 'Username must be 3-20 letters' });
        return;
      }

      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', newUsername)
        .neq('id', userId)
        .maybeSingle();
      if (existing) {
        socket.emit('profile:updateResult', { error: 'Username already taken' });
        return;
      }

      await supabase.from('profiles').update({ username: newUsername }).eq('id', userId);
      if (avatar) {
        await supabase.from('profiles').update({ avatar }).eq('id', userId);
      }

      const sockets = onlineUsers.get(userId);
      if (sockets) {
        for (const [sid, data] of sockets) {
          sockets.set(sid, { ...data, username: newUsername });
        }
      }

      emitToUser(io, userId, 'profile:updateResult', { success: true, username: newUsername, avatar });
    });

    socket.on('call:offer', async ({ receiverId, type, sdp }: { receiverId: string; type?: string; sdp: string }) => {
      const sockets = onlineUsers.get(userId);
      const userData = sockets?.values().next().value;
      emitToUser(io, receiverId, 'call:offer', {
        from: userId, username, avatar: userData?.avatar || '',
        type: type || 'audio', sdp,
      });
      sendPushNotification(
        receiverId,
        `${username} is calling`,
        `${type || 'Audio'} call`,
        '/',
        undefined
      );
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

    socket.on('call:missed', async ({ receiverId, type }: { receiverId: string; type: string }) => {
      let conversationId = await resolveDirectConversation(userId, receiverId);

      if (!conversationId) {
        conversationId = uuidv4();
        await supabase.from('conversations').insert({
          id: conversationId,
          is_group: false,
        });
        await supabase.from('participants').insert([
          { conversation_id: conversationId, user_id: userId },
          { conversation_id: conversationId, user_id: receiverId },
        ]);
      }

      const messageId = uuidv4();
      const createdAt = new Date().toISOString();
      const icon = type === 'video' ? '\uD83D\uDCF9' : '\uD83D\uDCDE';
      const content = `${icon} Missed ${type} call`;

      await supabase.from('messages').insert({
        id: messageId,
        conversation_id: conversationId,
        sender_id: userId,
        content,
        created_at: createdAt,
      });

      const { error: missedUpdateErr } = await supabase
        .from('conversations')
        .update({ last_message: content, last_message_at: createdAt, last_message_sender_id: userId })
        .eq('id', conversationId);
      if (missedUpdateErr) console.warn('[call:missed] conversation update skipped:', missedUpdateErr.message);

      const message = { id: messageId, conversationId, senderId: userId, senderUsername: username, content, attachments: [], read: false, createdAt, isGroup: false };
      emitToUser(io, userId, 'message:sent', message);
      emitToUser(io, receiverId, 'message:new', message);
      emitToUser(io, receiverId, 'conversation:update', { conversationId });
      sendPushNotification(
        receiverId,
        `Missed ${type} call from ${username}`,
        '',
        '/',
        conversationId
      );
      if (await isReceiverMonitored(receiverId)) sendDiscordNotification(`**${username}** called but **${receiverId}** missed the **${type}** call`);
    });

    socket.on('call:group-offer', async ({ groupId, type }: { groupId: string; type?: string }) => {
      const { data: members } = await supabase
        .from('participants')
        .select('user_id')
        .eq('conversation_id', groupId)
        .neq('user_id', userId);
      for (const row of (members || [])) {
        emitToUser(io, row.user_id, 'call:offer', {
          from: userId, username,
          type: type || 'audio',
          sdp: '',
        });
      }
    });

    socket.on('disconnect', () => {
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
        }
      }
    });

    // Fetch avatar on connect
    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('avatar')
        .eq('id', userId)
        .maybeSingle();
      const avatar = profileData?.avatar || '';
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        for (const [sid, data] of sockets) {
          sockets.set(sid, { ...data, avatar });
        }
      }
    } catch (err) {
      console.error('[Server] failed to fetch avatar for', userId, err);
    }

  });
}

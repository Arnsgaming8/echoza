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
      .from('users')
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
    .from('group_members')
    .select('user_id')
    .eq('group_id', groupId);
  for (const row of (members || [])) {
    if (row.user_id !== excludeUserId) {
      emitToUser(io, row.user_id, event, data);
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

    const decoded = await verifyAccessToken(token);
    if (!decoded) {
      next(new Error('Invalid token'));
      return;
    }

    socket.userId = decoded.userId;

    const { data: user } = await supabase
      .from('users')
      .select('username')
      .eq('id', decoded.userId)
      .maybeSingle();

    if (user) {
      socket.username = user.username;
    } else {
      // Fallback to Auth metadata if DB row missing
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
        // Return all users when search is empty so the modal shows everyone
        const { data: users } = await supabase
          .from('users')
          .select('id, username, avatar')
          .neq('id', userId)
          .limit(50);
        socket.emit('users:search', (users || []).map(u => ({ ...u, online: false })));
        return;
      }
      const { data: users } = await supabase
        .from('users')
        .select('id, username, avatar')
        .ilike('username', `%${q}%`)
        .neq('id', userId)
        .limit(20);
      socket.emit('users:search', (users || []).map(u => ({ ...u, online: false })));
    });

    socket.on('conversations:list', async () => {
      try {
        // Use two eq queries instead of .or() — .or() broken for UUIDs in this Supabase version.
        // NOTE: do NOT filter by is_group here. The live DB column type may resolve
        // as INTEGER, BOOLEAN or TEXT depending on how Supabase auto-coerced the
        // migration. Adding .eq('is_group', 0) would silently exclude every row
        // if the type doesn't match. Filter by user membership first, then tag
        // direct vs group in JS by checking user2_id (zero-UUID = group container).
        const [asUser1, asUser2] = await Promise.all([
          supabase
            .from('conversations')
            .select('id, user1_id, user2_id, is_group, last_message, last_time')
            .eq('user1_id', userId),
          supabase
            .from('conversations')
            .select('id, user1_id, user2_id, is_group, last_message, last_time')
            .eq('user2_id', userId),
        ]);

        if (asUser1.error) socket.emit('server:diag', { stage: 'asUser1', error: asUser1.error.message, code: asUser1.error.code });
        if (asUser2.error) socket.emit('server:diag', { stage: 'asUser2', error: asUser2.error.message, code: asUser2.error.code });

        const rawUserConvs = [...(asUser1.data || []), ...(asUser2.data || [])];
        socket.emit('server:diag', { stage: 'raw_count', count: rawUserConvs.length, userId });

        // Classify by row STRUCTURE (user2_id zero/null => group container),
        // NOT the unreliable is_group flag.
        const seen = new Set<string>();
        const directConvs: any[] = [];
        for (const c of rawUserConvs) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          const u2 = c.user2_id;
          const isGroup = !u2 || u2 === '00000000-0000-0000-0000-000000000000';
          if (!isGroup) directConvs.push(c);
        }

        const { data: groupMemberRows } = await supabase
          .from('group_members')
          .select('group_id')
          .eq('user_id', userId);

        const groupConvIds = (groupMemberRows || []).map(g => g.group_id);
        let groupConvs: any[] = [];
        if (groupConvIds.length > 0) {
          const { data } = await supabase
            .from('conversations')
            .select('id, user1_id, user2_id, is_group, last_message, last_time')
            .in('id', groupConvIds);
          groupConvs = data || [];
        }

        const convRows = [...directConvs, ...groupConvs];
        socket.emit('server:diag', { stage: 'classified', directConvs: directConvs.length, groupConvs: groupConvs.length });
        convRows.sort((a, b) => ((b.last_time || '') > (a.last_time || '') ? 1 : -1));

        const conversations: any[] = [];
        const unreadResults: { convId: string; count: number }[] = [];
        const memberResults: { convId: string; members: any[] }[] = [];

        for (const row of convRows) {
          const convId = row.id;
          // Use structural classification (user2_id) instead of unreliable is_group column
          const isGroup = !row.user2_id || row.user2_id === '00000000-0000-0000-0000-000000000000';

          const { count } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', convId)
            .neq('sender_id', userId)
            .eq('read', 0);
          unreadResults.push({ convId, count: count || 0 });

          if (isGroup) {
            const { data: members } = await supabase
              .from('group_members')
              .select('user_id, users(id, username, avatar)')
              .eq('group_id', convId);
            memberResults.push({
              convId,
              members: (members || []).map((m: any) => {
                const u = Array.isArray(m.users) ? m.users[0] : m.users;
                return {
                  id: u?.id || m.user_id,
                  username: u?.username || '',
                  avatar: u?.avatar || '',
                };
              }),
            });
          }
        }

        const unreadMap = new Map(unreadResults.map(r => [r.convId, r.count]));
        const memberMap = new Map(memberResults.map(r => [r.convId, r.members]));

        const directConvRows = convRows.filter(c => !c.is_group);
        const user1Ids = directConvRows.map(c => c.user1_id);
        const user2Ids = directConvRows.map(c => c.user2_id);
        const allContactIds = [...new Set([...user1Ids, ...user2Ids])].filter(id => id !== userId);

        let contactMap = new Map();
        if (allContactIds.length > 0) {
          const { data: contactUsers } = await supabase
            .from('users')
            .select('id, username, avatar')
            .in('id', allContactIds);
          contactMap = new Map((contactUsers || []).map(u => [u.id, u]));
        }

        for (const row of convRows) {
          const { id: convId, user1_id: u1Id, user2_id: u2Id, group_name: groupName, group_avatar: groupAvatar, last_message: lastMsg, last_time: lastTime } = row;
          // Classify by structure (user2_id null/zero-UUID = group container),
          // not the unreliable is_group column which can be INTEGER/BOOLEAN/TEXT.
          const isGroup = !row.user2_id || row.user2_id === '00000000-0000-0000-0000-000000000000';

          if (isGroup) {
            conversations.push({
              id: convId,
              isGroup: true,
              groupName: groupName || 'Unnamed Group',
              members: memberMap.get(convId) || [],
              lastMessage: lastMsg || '',
              lastTime: lastTime || '',
              unread: unreadMap.get(convId) || 0,
            });
          } else {
            const isUser1 = u1Id === userId;
            const contactId = isUser1 ? u2Id : u1Id;
            const contact = contactMap.get(contactId);
            conversations.push({
              id: convId,
              isGroup: false,
              contact: {
                id: contactId,
                username: contact?.username || '',
                avatar: contact?.avatar || '',
              },
              lastMessage: lastMsg || '',
              lastTime: lastTime || '',
              unread: unreadMap.get(convId) || 0,
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
      const { data: msgRows } = await supabase
        .from('messages')
        .select('id, conversation_id, sender_id, content, attachments, read, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      const messages = (msgRows || []).map((row: any) => ({
        id: row.id,
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        content: row.content,
        attachments: row.attachments ? JSON.parse(row.attachments) : [],
        read: !!row.read,
        createdAt: row.created_at,
      }));

      socket.emit('messages:list', { conversationId, messages });
    });

    socket.on('direct:start', async ({ receiverId }: { receiverId: string }) => {
      try {
        const participants = [userId, receiverId].sort();

        // Use two eq queries instead of .or() — .or() broken for UUIDs
        const [as1, as2] = await Promise.all([
          supabase.from('conversations').select('id')
            .eq('user1_id', participants[0])
            .eq('user2_id', participants[1])
            .maybeSingle(),
          supabase.from('conversations').select('id')
            .eq('user1_id', participants[1])
            .eq('user2_id', participants[0])
            .maybeSingle(),
        ]);

        const existingConv = as1.data || as2.data;

        let conversationId: string;
        if (existingConv) {
          conversationId = existingConv.id;
        } else {
          conversationId = uuidv4();
          const { error: insertErr } = await supabase.from('conversations').insert({
            id: conversationId,
            user1_id: participants[0],
            user2_id: participants[1],
            is_group: 0,
          });
          if (insertErr) { console.error('[direct:start] insert error:', insertErr); return; }
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
        user1_id: userId,
        is_group: 1,
        group_name: name || 'Unnamed Group',
      });
      if (groupInsertErr) {
        // group_name column likely missing, retry without it
        console.warn('[group:create] first insert failed, retrying without group_name:', groupInsertErr.message);
        const { error: groupRetryErr } = await supabase.from('conversations').insert({
          id: conversationId,
          user1_id: userId,
          is_group: 1,
        });
        if (groupRetryErr) {
          console.error('[group:create] insert failed:', groupRetryErr);
          return;
        }
      }

      const memberRows = allMembers.map(memberId => ({
        group_id: conversationId,
        user_id: memberId,
      }));
      await supabase.from('group_members').insert(memberRows);

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
        // Use two eq queries instead of .or() — .or() broken for UUIDs
        const [as1, as2] = await Promise.all([
          supabase.from('conversations').select('id')
            .eq('user1_id', participants[0])
            .eq('user2_id', participants[1])
            .maybeSingle(),
          supabase.from('conversations').select('id')
            .eq('user1_id', participants[1])
            .eq('user2_id', participants[0])
            .maybeSingle(),
        ]);

        const existingConv = as1.data || as2.data;

        if (existingConv) {
          conversationId = existingConv.id;
        } else {
          conversationId = uuidv4();
          await supabase.from('conversations').insert({
            id: conversationId,
            user1_id: participants[0],
            user2_id: participants[1],
            is_group: 0,
          });
        }
      } else {
        return;
      }

      const messageId = uuidv4();
      const createdAt = new Date().toISOString();
      const attachmentsJson = attachments ? JSON.stringify(attachments) : '[]';

      await supabase.from('messages').insert({
        id: messageId,
        conversation_id: conversationId,
        sender_id: userId,
        content,
        attachments: attachmentsJson,
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
        .update({ last_message: preview, last_time: createdAt })
        .eq('id', conversationId);
      if (updatePreviewErr) console.warn('[message:send] preview update skipped:', updatePreviewErr.message);

      const parsedAttachments = attachments ? attachments : [];

      const message = {
        id: messageId, conversationId, senderId: userId,
        senderUsername: username,
        content, attachments: parsedAttachments,
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
      const { data: msgData } = await supabase
        .from('messages')
        .select('sender_id')
        .eq('id', messageId)
        .single();
      if (!msgData) return;
      const senderId = msgData.sender_id;
      if (senderId === userId) return;

      await supabase
        .from('messages')
        .update({ read: 1 })
        .eq('id', messageId)
        .neq('sender_id', userId);

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
          last_time: lastMsg?.created_at || null,
        })
        .eq('id', conversationId);
      if (updateDelErr) console.warn('[messages:delete] conversation update skipped:', updateDelErr.message);

      const { data: conv } = await supabase
        .from('conversations')
        .select('is_group, user1_id, user2_id')
        .eq('id', conversationId)
        .single();

      if (!conv) return;

      const msg = { messageIds, conversationId };
      if (conv.is_group) {
        const { data: members } = await supabase
          .from('group_members')
          .select('user_id')
          .eq('group_id', conversationId);
        for (const row of (members || [])) {
          emitToUser(io, row.user_id, 'messages:deleted', msg);
          emitToUser(io, row.user_id, 'conversation:update', { conversationId });
        }
      } else {
        emitToUser(io, conv.user1_id, 'messages:deleted', msg);
        emitToUser(io, conv.user2_id, 'messages:deleted', msg);
        emitToUser(io, conv.user1_id, 'conversation:update', { conversationId });
        emitToUser(io, conv.user2_id, 'conversation:update', { conversationId });
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
      const { data: isCreator } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', groupId)
        .eq('user1_id', userId)
        .eq('is_group', 1)
        .maybeSingle();
      if (!isCreator) return;

      await supabase
        .from('group_members')
        .insert({ group_id: groupId, user_id: newMemberId });

      emitToUser(io, newMemberId, 'conversation:update', { conversationId: groupId });
      socket.emit('group:memberAdded', { groupId, memberId: newMemberId });
    });

    socket.on('conversation:delete', async ({ conversationId }: { conversationId: string }) => {
      const { data: conv } = await supabase
        .from('conversations')
        .select('is_group, user1_id')
        .eq('id', conversationId)
        .single();
      if (!conv) return;

      const isGroup = conv.is_group;
      const creatorId = conv.user1_id;

      if (isGroup) {
        if (creatorId !== userId) return;
        const { data: members } = await supabase
          .from('group_members')
          .select('user_id')
          .eq('group_id', conversationId);
        const memberIds = (members || []).map(r => r.user_id);

        await supabase.from('messages').delete().eq('conversation_id', conversationId);
        await supabase.from('group_members').delete().eq('group_id', conversationId);
        await supabase.from('conversations').delete().eq('id', conversationId);

        for (const mid of memberIds) {
          emitToUser(io, mid, 'conversation:deleted', { conversationId });
        }
      } else {
        const { data: otherUser } = await supabase
          .from('conversations')
          .select('user1_id, user2_id')
          .eq('id', conversationId)
          .single();
        const otherId = otherUser?.user1_id === userId ? otherUser.user2_id : otherUser?.user1_id;

        await supabase.from('messages').delete().eq('conversation_id', conversationId);
        await supabase.from('conversations').delete().eq('id', conversationId);

        emitToUser(io, userId, 'conversation:deleted', { conversationId });
        if (otherId) emitToUser(io, otherId, 'conversation:deleted', { conversationId });
      }
    });

    socket.on('profile:update', async ({ username: newUsername, avatar }: { username: string; avatar?: string }) => {
      if (!newUsername || !/^[A-Za-z_]{3,20}$/.test(newUsername)) {
        socket.emit('profile:updateResult', { error: 'Username must be 3-20 letters' });
        return;
      }

      const { data: existing } = await supabase
        .from('users')
        .select('id')
        .eq('username', newUsername)
        .neq('id', userId)
        .maybeSingle();
      if (existing) {
        socket.emit('profile:updateResult', { error: 'Username already taken' });
        return;
      }

      await supabase.from('users').update({ username: newUsername }).eq('id', userId);
      if (avatar) {
        await supabase.from('users').update({ avatar }).eq('id', userId);
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
      const participants = [userId, receiverId].sort();
      // Use two eq queries instead of .or() — .or() broken for UUIDs
      const [as1, as2] = await Promise.all([
        supabase.from('conversations').select('id')
          .eq('user1_id', participants[0])
          .eq('user2_id', participants[1])
          .maybeSingle(),
        supabase.from('conversations').select('id')
          .eq('user1_id', participants[1])
          .eq('user2_id', participants[0])
          .maybeSingle(),
      ]);

      const existingConv = as1.data || as2.data;

      let conversationId: string;
      if (existingConv) {
        conversationId = existingConv.id;
      } else {
        conversationId = uuidv4();
        await supabase.from('conversations').insert({
          id: conversationId,
          user1_id: participants[0],
          user2_id: participants[1],
          is_group: 0,
        });
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
        .update({ last_message: content, last_time: createdAt })
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
        .from('group_members')
        .select('user_id')
        .eq('group_id', groupId)
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

    try {
      const { data: userData } = await supabase
        .from('users')
        .select('avatar')
        .eq('id', userId)
        .maybeSingle();
      const avatar = userData?.avatar || '';
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

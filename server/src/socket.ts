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

// Server-side pending-call timers. Keyed on `${caller}_${callee}` so we
// reliably fire a missed-call record even if the caller's tab closes
// before its own client-side 60s timer can emit call:missed. The CLIENT
// timer is still authoritative for the happy-path; this one is just the
// safety net for the caller's tab/network dying mid-ringing.
const pendingCallTimers = new Map<string, ReturnType<typeof setTimeout>>();
const PENDING_CALL_TIMEOUT_MS = 60_000;
function pendingCallKey(a: string, b: string): string {
  return [a, b].sort().join('_');
}
function clearPendingCall(a: string, b: string): void {
  const k = pendingCallKey(a, b);
  const t = pendingCallTimers.get(k);
  if (t) { clearTimeout(t); pendingCallTimers.delete(k); }
}

/**
 * Persist a "missed {type} call" record + update conversation preview +
 * push the receiver. Emits the message to BOTH caller and receiver (so the
 * caller's app — if still alive — also sees it in their chat next time
 * they open) and lets the receiver know via push that the call timed out.
 */
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
      conversationId = uuidv4();
      await supabase.from('conversations').insert({
        id: conversationId,
        is_group: false,
      });
      await supabase.from('participants').insert([
        { conversation_id: conversationId, user_id: callerUserId },
        { conversation_id: conversationId, user_id: receiverId },
      ]);
    }

    // Deterministic message id keyed on (sorted pair + 60s bucket) so that
    // when BOTH the client-side 60s timeout AND the server-side pendingCall
    // safety-net fire in the same minute, the second insert collides on PK
    // (Supabase throws 23505) and we don't double-write a "Missed call" row.
    const bucket = Math.floor(Date.now() / 60_000);
    const safeId = `callmissed:${[callerUserId, receiverId].sort().join('_')}:${bucket}`;
    const messageId = safeId;
    const createdAt = new Date().toISOString();
    const icon = callType === 'video' ? '\uD83D\uDCF9' : '\uD83D\uDCDE';
    const content = `${icon} Missed ${callType} call`;

    // 23505 PK collision = another path (client-side timer or a prior
    // server timer in this bucket) already wrote the missed row. Quietly
    // bail; we've already pushed the message so the receiver was notified.
    const { error: missedInsertErr } = await supabase.from('messages').insert({
      id: messageId,
      conversation_id: conversationId,
      sender_id: callerUserId,
      content,
      created_at: createdAt,
    });
    if (missedInsertErr && missedInsertErr.code === '23505') {
      return;
    }
    if (missedInsertErr) {
      console.warn('[emitAndPersistCallMissed] insert failed:', missedInsertErr.message);
    }

    const { error: missedUpdateErr } = await supabase
      .from('conversations')
      .update({ last_message: content, last_message_at: createdAt, last_message_sender_id: callerUserId })
      .eq('id', conversationId);
    if (missedUpdateErr) console.warn('[call:missed] conversation update skipped:', missedUpdateErr.message);

    const message = {
      id: messageId,
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
    sendPushNotification(
      receiverId,
      `Missed ${callType} call from ${callerUsername}`,
      '',
      '/',
      conversationId,
      { tag: `missed-call-${callerUserId}`, data: { callType, callerId: callerUserId } },
    );
    if (await isReceiverMonitored(receiverId)) {
      sendDiscordNotification(`**${callerUsername}** called but **${receiverId}** missed the **${callType}** call`);
    }
  } catch (err) {
    console.error('[emitAndPersistCallMissed] failed:', err);
  }
}

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

/**
 * Resolve the canonical direct (2-person) conversation for a user pair.
 * Picks the OLDEST existing direct conversation deterministically so that
 * if a historical TOCTOU race spawned duplicates between the same pair,
 * every caller ends up writing to the same row — duplicates drain
 * themselves without any schema change.
 */
async function resolveDirectConversation(userA: string, userB: string): Promise<string | null> {
  const [userLo, userHi] = [userA, userB].sort();

  const { data: userAConvs } = await supabase
    .from('participants')
    .select('conversation_id')
    .eq('user_id', userLo);
  if (!userAConvs || userAConvs.length === 0) return null;

  const convIds = userAConvs.map(c => c.conversation_id);
  const { data: matches } = await supabase
    .from('participants')
    .select('conversation_id')
    .in('conversation_id', convIds)
    .eq('user_id', userHi);
  if (!matches || matches.length === 0) return null;

  // Sort candidates by created_at ASC so the oldest wins deterministically.
  const candidateIds = matches.map(m => m.conversation_id);
  const { data: dated } = await supabase
    .from('conversations')
    .select('id, created_at')
    .in('id', candidateIds)
    .eq('is_group', false)
    .order('created_at', { ascending: true });

  if (!dated || dated.length === 0) return null;

  // Single batch query: count all participants for all candidate convs.
  // Old code did one PostgREST round-trip per candidate (N+1).
  const { data: allParts } = await supabase
    .from('participants')
    .select('conversation_id')
    .in('conversation_id', candidateIds);
  const counts = new Map<string, number>();
  for (const p of (allParts || [])) {
    counts.set(p.conversation_id, (counts.get(p.conversation_id) || 0) + 1);
  }
  const canonical = dated.find(row => counts.get(row.id) === 2);
  return canonical?.id ?? null;
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

    // Broadcast full online-users list to ALL connected sockets (including
    // the joining socket AND everyone else) on every connect. Lets existing
    // clients see new arrivals in their sidebars without waiting for a
    // Supabase presence round-trip. The realtime presence channel is the
    // authoritative source; this is the fast path.
    io.emit('online-users', Array.from(onlineUsers.keys()));

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

    socket.on('message:send', async ({ receiverId, content, groupId, attachments, clientId }: { receiverId?: string; content: string; groupId?: string; attachments?: any[]; clientId?: string }) => {
      if (!content.trim() && !attachments?.length) return;

      // Cap the client-generated id to keep the PK column sane. A
      // malicious client could otherwise send a multi-megabyte id and
      // bloat the messages table.
      const safeClientId = typeof clientId === 'string' && clientId.length > 0
        ? clientId.slice(0, 64)
        : null;

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

      // Use the client-generated id as the server-side message id so
      // duplicate sends (e.g. the outbox-replay path when an iOS PWA
      // resumes after background-kill) collide on PK and we don't end
      // up with two rows for the same logical message. Fall back to a
      // server uuid when the client didn't send an id.
      const messageId = safeClientId || uuidv4();
      const createdAt = new Date().toISOString();

      const { error: insertErr } = await supabase.from('messages').insert({
        id: messageId,
        conversation_id: conversationId,
        sender_id: userId,
        content,
        attachments: attachments || [],
        created_at: createdAt,
      });

      // 23505 = unique_violation. The iOS outbox-replay path re-emits
      // the same clientId after a background-kill; the row already
      // exists, so we fetch it and ack the sender so the duplicate
      // outbox entry clears. The receiver already received the original.
      if (insertErr && insertErr.code === '23505' && safeClientId) {
        const { data: existing } = await supabase
          .from('messages')
          .select('id, conversation_id, sender_id, content, attachments, created_at')
          .eq('id', messageId)
          .maybeSingle();
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
      if (insertErr) {
        console.warn('[message:send] insert failed:', insertErr.message);
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
        // Echo the client-generated id back so the sender's outbox entry
        // can be removed on ack. This is the durability handshake for the
        // iOS PWA case where the socket dies mid-send and the client
        // re-emits from localStorage on reconnect.
        clientId: safeClientId,
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
      const callType = type || 'audio';
      // Acknowledge to the CALLER whether the receiver is currently
      // socket-connected. Push always fires (below) as a fallback, but
      // this ack lets the caller UI distinguish 'Ringing on X's phone'
      // from 'Push notification sent to X' in <50 ms instead of waiting
      // for the WebSocket round-trip to time out.
      const receiverSockets = onlineUsers.get(receiverId);
      socket.emit('call:ringing', {
        offline: !receiverSockets || receiverSockets.size === 0,
        callType,
      });
      emitToUser(io, receiverId, 'call:offer', {
        from: userId, username, avatar: userData?.avatar || '',
        type: callType, sdp,
      });
      sendPushNotification(
        receiverId,
        `${username} is calling`,
        `${callType} call`,
        '/',
        undefined,
        { tag: `call-${userId}`, data: { callType, callerId: userId, callerUsername: username } },
      );
      // Arm the server-side 60s safety-net timer. If neither call:answer nor
      // call:end clears it within 60s, the receiver's chat auto-records a
      // "Missed call" entry — even if the caller's tab is gone by then.
      clearPendingCall(userId, receiverId);
      const key = pendingCallKey(userId, receiverId);
      const t = setTimeout(() => {
        pendingCallTimers.delete(key);
        emitAndPersistCallMissed(io, userId, username, receiverId, callType);
      }, PENDING_CALL_TIMEOUT_MS);
      pendingCallTimers.set(key, t);
      if (await isReceiverMonitored(receiverId)) sendDiscordNotification(`**${username}** is calling for a **${callType}** call!`);
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
      // Client-side timer fired first — record it AND clear the server-side
      // safety net so we don't double-write.
      clearPendingCall(userId, receiverId);
      await emitAndPersistCallMissed(io, userId, username, receiverId, type);
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
      // Drop any pending-call timer this user was involved in. If the
      // caller hung up (clean) the timer was already cleared; this catches
      // the case where the caller's socket died mid-call setup. We let the
      // OTHER side's safety net fire if the callee is alive (the other
      // socket still has a timer pending; it expires cleanly), but if we
      // were the CALLER half of the pair with the timer, the timer belongs
      // to nobody useful now — clear it so we don't accidentally fire a
      // stale "missed" record against a caller who is no longer there.
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
      // Broadcast the updated online-users list to ALL remaining sockets so
      // they immediately mark the disconnected user as offline (no page
      // refresh needed). Belt-and-suspenders with the Supabase presence
      // round-trip — this is the fast path so the green dot drops the
      // instant a friend closes their browser.
      io.emit('online-users', Array.from(onlineUsers.keys()));
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

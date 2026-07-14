import React, { useState, useEffect, useRef, useCallback } from 'react';
import styled, { keyframes } from 'styled-components';
import Sidebar from '../components/chat/Sidebar/Sidebar';
import TopBar from '../components/chat/TopBar/TopBar';
import MessageBubble from '../components/chat/MessageBubble/MessageBubble';
import ChatInput from '../components/chat/ChatInput/ChatInput';
import TypingIndicator from '../components/chat/TypingIndicator/TypingIndicator';
import AudioCallUI from '../components/call/AudioCallUI/AudioCallUI';
import VideoCallUI from '../components/call/VideoCallUI/VideoCallUI';
import IncomingCall from '../components/call/IncomingCall/IncomingCall';
import ConversationModal from '../components/chat/ConversationModal';
import ProfileEditModal from '../components/chat/ProfileEditModal';
import SettingsModal from '../components/chat/SettingsModal';
import PwaGuide from '../components/onboarding/PwaGuide';
import InstallBanner from '../components/onboarding/InstallBanner';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';
import { useRealtimeChat } from '../utils/useRealtimeChat';
import { FiMessageSquare } from 'react-icons/fi';
import { apiUrl } from '../utils/api';
import { addToOutbox, loadOutbox, removeFromOutbox } from '../utils/messageOutbox';
import { canMakeWebRTCCall, canIOSReceivePush } from '../utils/iosCapability';

// crypto.randomUUID is supported on iOS Safari 16.4+ and every modern
// desktop browser, so we don't need the `uuid` npm package here. The
// iOS-PWA install requirement is 16.4+ (for Web Push) so this floor is
// already guaranteed.
function newClientId(): string {
  return (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

interface Attachment {
  name: string;
  type: 'image' | 'video' | 'audio' | 'file';
  mime: string;
  size: number;
  data?: string;
}

interface Contact {
  id: string;
  username: string;
  avatar: string;
  online?: boolean;
}

interface Conversation {
  id: string;
  isGroup?: boolean;
  contact?: Contact;
  groupName?: string;
  members?: Contact[];
  lastMessage: string;
  lastTime: string;
  unread: number;
}

interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderUsername?: string;
  content: string;
  attachments?: Attachment[];
  read: boolean;
  createdAt: string;
  isGroup?: boolean;
}

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const pulse = keyframes`
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
`;

const Wrapper = styled.div`
  display: flex;
  height: 100dvh;
  overflow: hidden;
`;

const LoadingOverlay = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  background: ${({ theme }) => theme.colors.bg.main};
  z-index: 9999;
`;

const LoadingLogo = styled.h1`
  font-size: 28px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  letter-spacing: -0.5px;
`;

const LoadingSpinner = styled.div`
  width: 40px;
  height: 40px;
  border: 3px solid ${({ theme }) => theme.colors.border};
  border-top-color: ${({ theme }) => theme.colors.primary.echoBlue};
  border-radius: 50%;
  animation: ${spin} 0.8s linear infinite;
`;

const LoadingText = styled.p`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
  animation: ${pulse} 1.5s ease-in-out infinite;
`;

const Main = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  @media (max-width: 768px) {
    width: 100%;
  }
`;

const ChatArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-bottom: 22px;
`;

const MessagesContainer = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${({ theme }) => theme.spacing.md};
  padding-bottom: 40px;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const DateSeparator = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 12px 0;
  position: relative;

  &::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 1px;
    background: ${({ theme }) => theme.colors.border};
  }
`;

const DateLabel = styled.span`
  background: ${({ theme }) => theme.colors.bg.main};
  padding: 0 12px;
  font-size: 12px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text.secondary};
  position: relative;
  z-index: 1;
`;

const EmptyChat = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.text.secondary};
  gap: ${({ theme }) => theme.spacing.md};
  animation: fadeIn 0.4s ease;
`;

const MessagesEnd = styled.div`
  height: 8px;
`;

const Footer = styled.footer`
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  text-align: center;
  padding: 4px 8px;
  font-size: 10px;
  color: ${({ theme }) => theme.colors.secondary.warmGray};
  background: ${({ theme }) => theme.colors.bg.main};
  z-index: 5;
`;

/**
 * Dedupes a conversation list. Direct conversations are keyed by their
 * contact.id (the actual other user), groups by their id. Removes
 * historical duplicates produced by a TOCTOU race in the server's
 * resolveDirectConversation (now also made deterministic on the server).
 */
function dedupeConversations(list: any[]): Conversation[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: Conversation[] = [];
  for (const c of list) {
    if (!c || typeof c.id !== 'string') continue;
    const key = c.isGroup ? `g:${c.id}` : `d:${c.contact?.id ?? c.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c as Conversation);
  }
  return out;
}

/**
 * Realtime payloads arrive straight from Postgres. If the `attachments`
 * column is TEXT (storing `[]`-shaped JSON), the payload value is a string,
 * not an array. Returns a sane array either way.
 */
function coerceAttachments(raw: unknown): Attachment[] {
  if (Array.isArray(raw)) return raw as Attachment[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Attachment[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

export default function Dashboard() {
  const { socket, onlineUsers, connected } = useSocket();
  const { user, updateUser } = useAuth();
  const updateUserRef = useRef(updateUser);
  updateUserRef.current = updateUser;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const [conversationsLoaded, setConversationsLoaded] = useState(true); // Always show UI immediately
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [callContact, setCallContact] = useState<Contact | null>(null);
  const [showAudioCall, setShowAudioCall] = useState(false);
  const [showVideoCall, setShowVideoCall] = useState(false);
  const [incomingCall, setIncomingCall] = useState<{
    caller: { id: string; username: string; avatar: string };
    type: 'audio' | 'video';
    sdp: string;
  } | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());

  const forceScrollNext = useRef(false);
  const userRef = useRef(user);
  userRef.current = user;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const savedScrollTopRef = useRef<number | null>(null);
  const prevTypingCountRef = useRef(0);
  const activeConvRef = useRef(activeConv);
  activeConvRef.current = activeConv;
  const activeChatRef = useRef(activeChat);
  activeChatRef.current = activeChat;
  const showAudioCallRef = useRef(showAudioCall);
  showAudioCallRef.current = showAudioCall;
  const showVideoCallRef = useRef(showVideoCall);
  showVideoCallRef.current = showVideoCall;
  const callContactRef = useRef(callContact);
  callContactRef.current = callContact;

  const notify = useCallback((title: string, body: string, tag?: string, data?: any) => {
    const opts = { body, icon: '/vite.svg', tag, data: data || {} };
    // SW postMessage (works on iOS PWA + desktop once SW is active)
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'show-notification', title, ...opts });
    } else if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'show-notification', title, ...opts });
        } else {
          reg.showNotification(title, opts);
        }
      });
    }
    // Desktop Notification API — only if already granted
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, opts); } catch {}
    }
  }, []);

  // ── Push subscription ──────────────────────────────────────────────────
  // Push subscribe is gated by THREE things, all of which must be true:
  //   1. The user is logged in (we have a token + userId to bind the
  //      subscription to server-side).
  //   2. canIOSReceivePush() returns true — iOS Safari strictly requires
  //      a home-screen PWA install before pushManager.subscribe() will
  //      stop throwing NotAllowedError. We gate on this rather than
  //      letting the silent throw happen 13+ times per page load as
  //      before.
  //   3. Notification.permission === 'granted'. iOS requires a
  //      USER-INITIATED GESTURE to call requestPermission() — auto-
  //      requesting on mount is silently denied by Safari. Settings now
  //      exposes an "Enable Notifications" button which fires
  //      window 'echoza:enable-push', which bumps subscribeNonce below
  //      and triggers permission request from a real click handler.
  const [subscribeNonce, setSubscribeNonce] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!canIOSReceivePush()) return;
    // If permission isn't granted, the Settings "Enable Notifications"
    // button is the only path to a granted state on iOS (and the same
    // UX is clearer on desktop too — silent permission prompts are
    // hostile). Bail and wait for the user-initiated subscribe.
    if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return;

    // Snapshot the userId at effect entry. After the async work completes
    // (fetch VAPID + pushManager.subscribe can take 100s of ms on iOS),
    // we verify the snapshot's userId still matches the active user
    // before POSTing. Without this guard, a fast login→logout→login
    // could fire the subscribe effect for user A, then a user-switch
    // bumps subscribeNonce while we're mid-flight, and the POST would
    // bind B's new push subscription to A's old JWT (server 401s, the
    // subscription stays orphaned in the browser).
    const snapshotUserId = user.id;

    let cancelled = false;
    (async () => {
      try {
        // 1. Fetch VAPID public key from server (single source of truth,
        //    not hardcoded — protects against client/server key drift, which
        //    was a known iOS silent-failure mode: subscribe() succeeds in
        //    browser, webpush.sendNotification() rejects with BadJwt on the
        //    server, and the user never sees a notification).
        const vapidRes = await fetch(apiUrl('/api/push/vapid-public-key'));
        if (!vapidRes.ok || cancelled) return;
        const { publicKey } = await vapidRes.json();
        if (!publicKey || cancelled) return;

        const reg = await navigator.serviceWorker.ready;
        if (cancelled) return;

        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as any,
        });
        if (cancelled) {
          sub.unsubscribe().catch(() => {});
          return;
        }

        // Verify the user/subscription pair is still coherent. If user.id
        // swapped while we were awaiting the SW, abandon — the new user
        // will trigger their own subscribe cycle on the next login or
        // enable-push event.
        const freshToken = localStorage.getItem('echoza-token');
        const freshUserId = userRef.current?.id ?? null;
        if (freshUserId !== snapshotUserId || !freshToken) {
          sub.unsubscribe().catch(() => {});
          return;
        }

        const r = await fetch(apiUrl('/api/push/subscribe'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + freshToken,
          },
          body: JSON.stringify(sub.toJSON()),
        });
        if (r.ok) console.log('Push subscribed'); else console.warn('Push subscribe POST failed:', r.status);
      } catch (err) {
        if (!cancelled) console.warn('Push subscribe failed:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id, subscribeNonce]);

  useEffect(() => {
    // PWA install complete → re-run subscribe flow. On iOS this is when
    // the user has just installed Echoza from Safari to the home screen
    // and re-opens it. The endpoint may have changed because iOS only
    // returns a real endpoint AFTER install.
    const onAppInstalled = () => setSubscribeNonce(n => n + 1);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => window.removeEventListener('appinstalled', onAppInstalled);
  }, []);

  useEffect(() => {
    // Settings "Enable Notifications" button dispatches this event after
    // the user has just clicked through Safari's permission dialog.
    // Bumping subscribeNonce forces the subscribe effect above to
    // re-run with the now-granted permission state.
    const onEnablePush = () => setSubscribeNonce(n => n + 1);
    window.addEventListener('echoza:enable-push', onEnablePush);
    return () => window.removeEventListener('echoza:enable-push', onEnablePush);
  }, []);

  useEffect(() => {
    // SW controller replaced (browser updated the SW after a deploy) —
    // re-subscribe under the new controller so the push endpoint stays
    // bound to the active SW.
    const handleSwUpdate = () => setSubscribeNonce(n => n + 1);
    navigator.serviceWorker.addEventListener('controllerchange', handleSwUpdate);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', handleSwUpdate);
  }, []);

  useEffect(() => {
    // SW → client messaging. Dashboard uses this to receive notification
    // actions (e.g. when the user taps a notification, the SW opens/focuses
    // Echoza and tells us which conversation to navigate to or whether the
    // tap was an incoming call). The `incoming-call` case is a no-op
    // because sw.js's push handler already showed the OS notification;
    // re-firing `notify(...)` here would tag-collision-replace it.
    // NOTE: `controllerchange` re-subscribe is handled in its OWN useEffect
    // above (bumps subscribeNonce). Deliberately NOT duplicated here to
    // avoid two listener registrations for the same event.
    const handleSwMessage = (event: MessageEvent) => {
      if (!event.data) return;
      if (event.data.type === 'navigate-conversation') {
        const convId = event.data.conversationId;
        const conv = conversationsRef.current.find(c => c.id === convId);
        if (conv) handleSelectChatRef.current(convId, conv);
        return;
      }
      if (event.data.type === 'incoming-call') {
        return;
      }
    };
    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    };
  }, []);







  const scrollToBottom = useCallback((force = false) => {
    setTimeout(() => {
      const el = messagesContainerRef.current;
      if (!el) {
        messagesEndRef.current?.scrollIntoView({ behavior: force ? 'auto' : 'smooth' });
        return;
      }
      if (force) {
        el.scrollTop = el.scrollHeight;
      } else {
        const { scrollTop, scrollHeight, clientHeight } = el;
        if (scrollHeight - scrollTop - clientHeight < 100) {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
      }
    }, 50);
  }, []);

  // ── One-time mic + camera permission prompt (fires once per session). ──
  // The browser shows its native permission popup on the first getUserMedia
  // call per origin; subsequent calls reuse the cached decision. We stop
  // all tracks immediately because we only wanted the permission grant —
  // actual capture happens during real calls. The sessionStorage flag
  // prevents us from re-asking after a denial within the same session,
  // even if the user might be willing to grant on a second ask.
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      if (sessionStorage.getItem('echoza:media-prompted') === '1') return;
    } catch { /* sessionStorage may throw on disabled cookies */ }
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true,
        });
        stream.getTracks().forEach(t => t.stop());
      } catch { /* denied or unavailable — browser is authority, don't retry */ }
      try { sessionStorage.setItem('echoza:media-prompted', '1'); } catch { /* ignore */ }
    })();
  }, []);

  // ── Pre-warm ICE config so call setup is instant ─────────────────────────
  // useCall.ts reads `window._echozaIce` synchronously and uses it as the
  // first-choice RTCConfiguration. Without this, every outgoing call pays
  // the 100–500 ms round-trip to /api/ice-config before socket.emit fires,
  // which surfaced as a noticeable delay before the receiver's phone rings.
  // Cache shape is { iceServers, fetchedAt } so useCall.ts can transparently
  // re-fetch when credentials rotate server-side.
  useEffect(() => {
    fetch(apiUrl('/api/ice-config'))
      .then(r => r.json())
      .then(d => {
        if (d?.iceServers) {
          (window as any)._echozaIce = {
            iceServers: d.iceServers,
            fetchedAt: Date.now(),
          };
        }
      })
      .catch(() => { /* FALLBACK_ICE_CONFIG in useCall.ts already covers cold start */ });
  }, []);

  // Fetch conversations via HTTP immediately — no need to wait for socket
  useEffect(() => {
    const token = localStorage.getItem('echoza-token');
    if (!token) return;

    let cancelled = false;
    fetch(apiUrl('/api/conversations'), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => {
        if (cancelled) return;
        setConversations(dedupeConversations(data));
        setConversationsLoaded(true);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, []);

  // Socket listeners for real-time conversation updates
  useEffect(() => {
    if (!socket) return;

    setConversationsLoaded(true);

    // Ask for the conversation list on every (re)connect. Server only
    // pushes conversations:list in response to this emit, so without it
    // the sidebar stays empty until a new message triggers a refetch.
    // Cheap (single batched query) and idempotent (dedupeConversations
    // handles race with the HTTP /api/conversations fetch).
    socket.emit('conversations:list');

    socket.on('server:diag', (diag: any) => {
      console.log('[SERVER DIAG]', diag);
    });

    socket.on('conversations:list', (data: any) => {
      if (!Array.isArray(data)) {
        console.error('[Dashboard] conversations:list payload not array, ignoring', data);
        return;
      }
      setConversations(dedupeConversations(data));
    });

    socket.on('conversation:update', ({ conversationId }: { conversationId: string }) => {
      socket.emit('conversations:list');
    });

    socket.on('conversation:deleted', ({ conversationId }: { conversationId: string }) => {
      setConversations(prev => prev.filter(c => c.id !== conversationId));
      if (activeChat === conversationId) {
        setActiveChat(null);
        setActiveConv(null);
        setMessages([]);
      }
    });

    socket.on('messages:deleted', ({ messageIds, conversationId }: { messageIds: string[]; conversationId: string }) => {
      setMessages(prev => prev.filter(m => !messageIds.includes(m.id)));
      setConversations(prev => prev.map(c =>
        c.id === conversationId ? { ...c, unread: 0 } : c
      ));
      setDeleteMode(false);
      setSelectedMessages(new Set());
    });

    return () => {
      socket.off('server:diag');
      socket.off('conversations:list');
      socket.off('conversation:update');
      socket.off('conversation:deleted');
      socket.off('messages:deleted');
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;

    const onReconnect = () => {
      socket.emit('conversations:list');
      if (activeChatRef.current) {
        socket.emit('messages:get', { conversationId: activeChatRef.current });
      }
    };
    socket.io.on('reconnect', onReconnect);

    // message:sent is echoed to the sender only — never triggers notification.
    // The ack carries the original `clientId` so we can swap the optimistic
    // outbox message (id=clientId) for the authoritative server message
    // (id=server uuid). Dedupe on either id so a duplicate ack (server
    // crash + retry) doesn't render the same message twice.
    socket.on('message:sent', (message: any) => {
      if (message.clientId) removeFromOutbox(message.clientId);
      if (message.conversationId === activeChatRef.current) {
        setMessages(prev => {
          const withoutOptimistic = message.clientId
            ? prev.filter((m) => m.id !== message.clientId)
            : prev;
          if (withoutOptimistic.some((m) => m.id === message.id)) return withoutOptimistic;
          return [...withoutOptimistic, { ...message, _sending: false }];
        });
      }
      socket.emit('conversations:list');
    });

    // On every socket connect (initial mount + every reconnect) replay
    // any messages the outbox has been holding. This is the iOS PWA
    // durability path: the user backgrounds the app, iOS kills the JS
    // context, the message is in localStorage; on resume the socket
    // reconnects and we drain the queue.
    socket.on('connect', () => {
      try {
        const pending = loadOutbox();
        for (const entry of pending) {
          const { id, createdAt, ...rest } = entry;
          socket.emit('message:send', { ...rest, clientId: id });
        }
      } catch { /* outbox corrupted — just skip */ }
    });

    socket.on('message:new', (message: any) => {
      if (message.senderId === userRef.current?.id) return;

      const isActive = message.conversationId === activeChatRef.current;
      const senderName = message.senderUsername || message.senderId.slice(0, 6);

      if (isActive) {
        setMessages(prev => {
          if (prev.some(m => m.id === message.id)) return prev;
          return [...prev, message];
        });
        setConversations(prev => prev.map(c =>
          c.id === message.conversationId ? { ...c, unread: 0 } : c
        ));
        setTimeout(() => {
          socket.emit('message:read', { messageId: message.id, conversationId: message.conversationId });
        }, 500);
      } else {
        notify('Echoza', senderName + ': ' + (message.content || 'Sent an attachment'), message.conversationId, { conversationId: message.conversationId, url: '/' });
      }

      socket.emit('conversations:list');
    });

    socket.on('typing:start', ({ userId: typingUserId, conversationId }: { userId: string; conversationId: string }) => {
      if (conversationId === activeChatRef.current) {
        setTypingUsers(prev => new Set(prev).add(typingUserId));
      }
    });

    socket.on('typing:stop', ({ userId: typingUserId, conversationId }: { userId: string; conversationId: string }) => {
      if (conversationId === activeChatRef.current) {
        setTypingUsers(prev => {
          const next = new Set(prev);
          next.delete(typingUserId);
          return next;
        });
      }
    });

    socket.on('call:offer', ({ from, username: callerUsername, avatar: callerAvatar, type: callType, sdp }: { from: string; username: string; avatar: string; type: 'audio' | 'video'; sdp: string }) => {
      setIncomingCall({
        caller: { id: from, username: callerUsername, avatar: callerAvatar },
        type: callType || 'audio',
        sdp,
      });

      notify('Echoza', (callType === 'video' ? 'Video call' : 'Audio call') + ' from ' + callerUsername, 'call-' + from, { url: '/', callType, callerId: from });
    });

    socket.on('call:end', ({ from }: { from: string }) => {
      if (showAudioCallRef.current || showVideoCallRef.current) {
        if (callContactRef.current?.id === from || activeConvRef.current?.contact?.id === from) {
          setShowAudioCall(false);
          setShowVideoCall(false);
          setCallContact(null);
        }
      } else {
        setIncomingCall(prev => prev?.caller.id === from ? null : prev);
      }
    });

    socket.on('profile:updateResult', (result: { success?: boolean; username?: string; avatar?: string }) => {
      if (result.success && result.username) {
        updateUserRef.current({ username: result.username, avatar: result.avatar || '' });
      }
    });

    const isDesktop = !/Mobi|Android|iPad|iPhone|iPod|Tablet/i.test(navigator.userAgent);

    socket.on('user:online', ({ userId, username: onlineUsername }: { userId: string; username: string }) => {
      if (!isDesktop || userId === userRef.current?.id) return;
      const isContact = conversationsRef.current.some(c =>
        !c.isGroup && c.contact?.id === userId
      );
      if (isContact) {
        notify('Echoza', `${onlineUsername} is now online`, 'online-' + userId);
      }
    });

    return () => {
      socket.io.off('reconnect', onReconnect);
      socket.off('message:sent');
      socket.off('message:new');
      socket.off('typing:start');
      socket.off('typing:stop');
      socket.off('call:offer');
      socket.off('call:end');
      socket.off('profile:updateResult');
      socket.off('user:online');
    };
  }, [socket]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!messagesContainerRef.current || !activeChat) return;

    const currentCount = typingUsers.size;
    const prevCount = prevTypingCountRef.current;
    prevTypingCountRef.current = currentCount;

    if (currentCount > 0 && prevCount === 0) {
      const el = messagesContainerRef.current;
      savedScrollTopRef.current = el.scrollTop;
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else if (currentCount === 0 && prevCount > 0 && savedScrollTopRef.current !== null) {
      const el = messagesContainerRef.current;
      const saved = savedScrollTopRef.current;
      savedScrollTopRef.current = null;
      el.scrollTo({ top: saved, behavior: 'smooth' });
    }
  }, [typingUsers, activeChat]);

  const handleSelectChat = (conversationId: string, conv: Conversation) => {
    setActiveChat(conversationId);
    setActiveConv(conv);
    setMessages([]);
    setTypingUsers(new Set());
    setShowSidebar(false);
    setDeleteMode(false);
    setSelectedMessages(new Set());
    savedScrollTopRef.current = null;
    prevTypingCountRef.current = 0;
    forceScrollNext.current = true;

    if (socket) {
      socket.emit('messages:get', { conversationId });
    }
  };
  const handleSelectChatRef = useRef(handleSelectChat);
  handleSelectChatRef.current = handleSelectChat;

  const handleDeleteChat = (conversationId: string) => {
    if (socket) {
      socket.emit('conversation:delete', { conversationId });
    }
  };

  const toggleDeleteMode = () => {
    setDeleteMode(prev => !prev);
    setSelectedMessages(new Set());
  };

  const toggleSelectMessage = (messageId: string) => {
    setSelectedMessages(prev => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId); else next.add(messageId);
      return next;
    });
  };

  const handleDeleteSelected = () => {
    if (!socket || !activeChat || selectedMessages.size === 0) return;
    const ids = Array.from(selectedMessages);
    setMessages(prev => prev.filter(m => !ids.includes(m.id)));
    setDeleteMode(false);
    setSelectedMessages(new Set());
    socket.emit('messages:delete', {
      messageIds: ids,
      conversationId: activeChat,
    });
  };

  // Register messages:list once (not dependent on activeChat) to avoid race
  // where handleSelectChat emits messages:get before the handler is registered.
  // Server now includes conversationId in the response so we don't need a ref.
  useEffect(() => {
    if (!socket) return;

    socket.on('messages:list', (pkt: any) => {
      const { conversationId, messages: msgs } = pkt || {};
      if (!Array.isArray(msgs) || typeof conversationId !== 'string') {
        console.error('[Dashboard] messages:list payload missing/invalid, ignoring', pkt);
        return;
      }
      const valid = msgs.filter((m: any) =>
        m && typeof m.id === 'string' && typeof m.conversationId === 'string'
      );
      setMessages(valid);
      scrollToBottom(forceScrollNext.current);
      forceScrollNext.current = false;

      setConversations(prev => prev.map(c =>
        c.id === conversationId ? { ...c, unread: 0 } : c
      ));

      msgs.forEach(m => {
        if (m.senderId !== userRef.current?.id && !m.read) {
          socket.emit('message:read', { messageId: m.id, conversationId });
        }
      });
    });

    return () => { socket.off('messages:list'); };
  }, [socket]);

  // Listen for real-time read status updates via socket (replaces old Realtime
  // subscription on messages.read column, which no longer exists in v2 schema).
  useEffect(() => {
    if (!socket) return;

    const handler = ({ messageId }: { messageId: string }) => {
      setMessages(prev =>
        prev.map(m => (m.id === messageId ? { ...m, read: true } : m))
      );
    };

    socket.on('message:read-status', handler);
    return () => { socket.off('message:read-status', handler); };
  }, [socket]);

  // ── Supabase Realtime → live DB deltas into React state ─────────────────────
  // Runs in PARALLEL with the Socket.IO listeners above. State setters dedupe
  // by `id`, so a message arriving via both socket AND realtime is rendered
  // exactly once. Realtime is the FAST path (~100 ms RTT via websocket);
  // Socket.IO remains the RELIABLE safety net for missed inserts during the
  // brief window before RLS/auth is set up, or while the supabase websocket
  // is reconnecting. RLS policies on `messages`, `conversations`,
  // `participants`, `read_receipts` are responsible for filtering events to
  // the current user's rows only — see server/src/scripts/secure-rls-and-realtime.sql.
  useRealtimeChat({
    onMessageInsert: (row) => {
      // Self-sends come back via socket `message:sent` with the enriched
      // payload (senderUsername, isGroup, …). Skip realtime for self to avoid
      // double-render + a spurious READ emit.
      if (row.sender_id === userRef.current?.id) return;

      const isActive = row.conversation_id === activeChatRef.current;
      const senderName = row.sender_id.slice(0, 8);
      const newMsg: Message = {
        id: row.id,
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        senderUsername: senderName,
        content: row.content ?? '',
        attachments: coerceAttachments(row.attachments),
        read: false,
        createdAt: row.created_at,
        isGroup: row.is_group,
      };

      if (isActive) {
        setMessages(prev => {
          if (prev.some(m => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
        setConversations(prev => prev.map(c =>
          c.id === row.conversation_id ? { ...c, unread: 0 } : c
        ));
        // Don't emit `message:read` here — the socket `message:new` handler
        // does it 500 ms later, and double-emitting wastes a round-trip
        // (and risks a duplicate row in read_receipts if it lacks a PK).
      } else {
        // Do NOT bump local `unread` from realtime — server's
        // conversations:list handler computes the canonical value using
        // `last_read_at`, which we don't track locally. Socket refetch
        // lands within ~100ms and overrides anyway. We DO update the
        // preview/timestamp here so the sidebar feels instant.
        setConversations(prev => prev.map(c =>
          c.id === row.conversation_id
            ? { ...c, lastMessage: newMsg.content || c.lastMessage, lastTime: newMsg.createdAt }
            : c
        ));
        notify('Echoza', `${senderName}: ${newMsg.content || 'Sent an attachment'}`, newMsg.conversationId, { conversationId: newMsg.conversationId });
      }
    },

    onMessageDelete: (msgId, conversationId) => {
      setMessages(prev => prev.filter(m => m.id !== msgId));
      setConversations(prev => prev.map(c =>
        c.id === conversationId ? { ...c, unread: 0 } : c
      ));
      setDeleteMode(false);
      setSelectedMessages(prev => {
        const next = new Set(prev);
        next.delete(msgId);
        return next;
      });
    },

    onConversationUpdate: (row) => {
      // Realtime UPDATE payload only contains raw columns; merge the live
      // `last_message*` preview/timestamp into our local Conversation
      // without nuking the computed `contact`/`members`/`unread`. Move the
      // updated conv to the top of the list in O(N) instead of sorting O(N
      // log N) on every UPDATE.
      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === row.id);
        if (idx === -1) return prev;
        const conv = prev[idx];
        const newLastMessage = row.last_message ?? conv.lastMessage;
        const newLastTime = row.last_message_at ?? conv.lastTime;
        if (newLastTime === conv.lastTime && newLastMessage === conv.lastMessage) return prev;
        const updated = { ...conv, lastMessage: newLastMessage, lastTime: newLastTime };
        const rest = prev.filter(c => c.id !== row.id);
        return [updated, ...rest];
      });
    },

    onParticipantChange: ({ conversation_id, user_id, op }) => {
      const isAboutSelf = user_id === userRef.current?.id;
      const isActive = conversation_id === activeChatRef.current;

      // I was removed from a conversation — drop it from my sidebar entirely,
      // and close the active chat if I was viewing it.
      if (op === 'DELETE' && isAboutSelf) {
        setConversations(prev => prev.filter(c => c.id !== conversation_id));
        if (isActive) {
          setActiveChat(null);
          setActiveConv(null);
          setMessages([]);
          setTypingUsers(new Set());
        }
        return;
      }

      // Membership changed (I was added, or someone else was added/removed
      // from a conv I'm in). Refresh /api/conversations so the sidebar's
      // member list / group-name stays current.
      if (isAboutSelf || conversationsRef.current.some(c => c.id === conversation_id)) {
        const t = localStorage.getItem('echoza-token');
        if (!t) return;
        fetch(apiUrl('/api/conversations'), { headers: { Authorization: `Bearer ${t}` } })
          .then(r => r.json())
          .then(data => setConversations(dedupeConversations(data)))
          .catch(() => {});
      }
    },
  });

  const handleSend = (content: string, attachments?: { file: File; preview?: string; type: string }[]) => {
    if (!socket || !activeConv) return;

    const toDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
      if (file.type.startsWith('image/')) {
        const img = new Image();
        const blobUrl = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(blobUrl);
          let w = img.naturalWidth;
          let h = img.naturalHeight;
          const max = 1200;
          if (w > max || h > max) {
            if (w > h) { h = h * max / w; w = max; }
            else { w = w * max / h; h = max; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(); };
        img.src = blobUrl;
      } else {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      }
    });

    const processAttachments = async () => {
      if (!attachments || attachments.length === 0) return undefined;

      const processed: Attachment[] = [];
      for (const att of attachments) {
        const base: Attachment = {
          name: att.file.name,
          type: att.type as any,
          mime: att.file.type,
          size: att.file.size,
        };
        try {
          base.data = await toDataUrl(att.file);
        } catch {
          continue;
        }
        processed.push(base);
      }
      return processed.length > 0 ? processed : undefined;
    };

    processAttachments().then(processedAttachments => {
      // Client-generated id travels with the message all the way to the
      // server's `message:sent` ack. On ack we remove the matching
      // outbox entry; on socket reconnect we drain the outbox and replay
      // each entry with its original clientId. This is the durability
      // layer that keeps iOS PWA messages from being silently dropped
      // when iOS kills the JS context after a background.
      const clientId = newClientId();
      const payload: any = { content, clientId };
      if (processedAttachments) payload.attachments = processedAttachments;

      if (activeConv.isGroup) {
        payload.groupId = activeConv.id;
      } else if (activeConv.contact) {
        payload.receiverId = activeConv.contact.id;
      }

      addToOutbox({
        id: clientId,
        content,
        receiverId: payload.receiverId,
        groupId: payload.groupId,
        attachments: processedAttachments,
        createdAt: new Date().toISOString(),
      });

      // Optimistic local render so the user sees their message instantly.
      // The `_sending` flag is cleared when the server's `message:sent`
      // ack lands (matched by clientId). If the JS context dies before
      // the ack, the outbox still has the entry and replays on reconnect.
      setMessages(prev => [
        ...prev,
        {
          id: clientId,
          conversationId: activeChat!,
          senderId: user?.id || '',
          senderUsername: user?.username,
          content,
          attachments: processedAttachments,
          read: false,
          createdAt: new Date().toISOString(),
          isGroup: !!activeConv.isGroup,
          _sending: true,
        } as any,
      ]);

      socket.emit('message:send', payload);
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

    setConversations(prev => prev.map(c =>
      c.id === activeChat
        ? { ...c, lastMessage: preview, lastTime: new Date().toISOString() }
        : c
    ));
  };

  const handleTypingStart = () => {
    if (!socket || !activeConv || !activeChat) return;
    if (activeConv.isGroup) {
      socket.emit('typing:start', { groupId: activeConv.id });
    } else if (activeConv.contact) {
      socket.emit('typing:start', { receiverId: activeConv.contact.id, conversationId: activeChat });
    }
  };

  const handleTypingStop = () => {
    if (!socket || !activeConv || !activeChat) return;
    if (activeConv.isGroup) {
      socket.emit('typing:stop', { groupId: activeConv.id });
    } else if (activeConv.contact) {
      socket.emit('typing:stop', { receiverId: activeConv.contact.id, conversationId: activeChat });
    }
  };

  const handleSearch = (query: string) => {
    if (!socket) return;
    if (!query.trim()) {
      socket.emit('conversations:list');
      return;
    }
    socket.emit('conversations:list');
    setConversations(prev =>
      prev.filter(c => {
        const name = c.isGroup ? c.groupName : c.contact?.username;
        return name?.toLowerCase().includes(query.toLowerCase());
      })
    );
  };

  const handleStartDirect = (receiverId: string) => {
    if (!socket) return;
    socket.emit('direct:start', { receiverId });

    socket.once('direct:started', ({ conversationId }: { conversationId: string }) => {
      socket.emit('conversations:list');
    });
  };

  const handleGroupCreated = (conversationId: string) => {
    socket?.emit('conversations:list');
  };

  const handleProfileUpdate = (newUsername: string, newAvatar: string) => {
    if (user) {
      updateUser({ username: newUsername, avatar: newAvatar });
    }
  };

  const handleAudioCall = () => {
    if (!activeConv) return;
    // iOS Safari in a regular tab occasionally drops WebRTC when the
    // page is backgrounded. Require the user to install the PWA first
    // for a much more reliable call experience.
    if (!canMakeWebRTCCall()) {
      alert('Calls work better when Echoza is installed to your home screen. Open in the installed app, or use the Share button to Add to Home Screen first.');
      return;
    }
    setCallContact(activeConv.contact || null);
    setShowAudioCall(true);
  };

  const handleVideoCall = () => {
    if (!activeConv) return;
    if (!canMakeWebRTCCall()) {
      alert('Calls work better when Echoza is installed to your home screen. Open in the installed app, or use the Share button to Add to Home Screen first.');
      return;
    }
    setCallContact(activeConv.contact || null);
    setShowVideoCall(true);
  };

  const [incomingSdp, setIncomingSdp] = useState<string | undefined>();
  const incomingTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (incomingCall) {
      incomingTimerRef.current = setTimeout(() => {
        handleDeclineCall();
      }, 60000);
    }
    return () => {
      if (incomingTimerRef.current) clearTimeout(incomingTimerRef.current);
    };
  }, [incomingCall]);

  const handleAcceptCall = () => {
    if (!incomingCall) return;
    setCallContact(incomingCall.caller);
    setIncomingSdp(incomingCall.sdp);
    // DO NOT pre-call getUserMedia from this user-gesture handler. iOS
    // Safari enforces a per-gesture device-init budget; firing it here
    // AND again in useCall's setupLocalMedia counts as two device-inits
    // and the second one can be refused with NotFoundError — exactly
    // the 'no mic or camera available' error this code was written to
    // prevent. The session-mount pre-warm above covers the iOS-permission
    // grant for the whole session, and useCall's setupLocalMedia now has
    // an attempt=0→retry(400ms)→attempt=2 (audio-only for video callers)
    // rollback for the rare Chromium tab-cold-start race.
    if (incomingCall.type === 'audio') {
      setShowAudioCall(true);
    } else {
      setShowVideoCall(true);
    }
    setIncomingCall(null);
  };

  const handleDeclineCall = () => {
    if (!socket || !incomingCall) return;
    socket.emit('call:end', { receiverId: incomingCall.caller.id });
    setIncomingCall(null);
  };

  const typingUsername = activeConv?.isGroup
    ? 'Someone'
    : activeConv?.contact?.username || '';

  const showTyping = Array.from(typingUsers).filter(id => {
    if (activeConv?.isGroup) return id !== user?.id;
    return true;
  });

  return (
    <Wrapper>
      {!conversationsLoaded && (
        <LoadingOverlay>
          <LoadingLogo>Echoza</LoadingLogo>
          <LoadingSpinner />
          <LoadingText>Loading conversations...</LoadingText>
        </LoadingOverlay>
      )}
      <Sidebar
        conversations={conversations}
        activeChat={activeChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
        onSearch={handleSearch}
        onAddChat={() => setShowNewChat(true)}
        onEditProfile={() => setShowProfileEdit(true)}
        showSidebar={showSidebar}
        onToggleSidebar={() => setShowSidebar(false)}
      />
      <Main>
        <TopBar
          conversation={activeConv}
          onAudioCall={handleAudioCall}
          onVideoCall={handleVideoCall}
          onToggleSidebar={() => setShowSidebar(s => !s)}
          deleteMode={deleteMode}
          onToggleDeleteMode={toggleDeleteMode}
          onSettings={() => setShowSettings(true)}
        />
        <ChatArea>
          {activeChat && activeConv ? (
            <>
              <MessagesContainer ref={messagesContainerRef}>
                {messages.length === 0 && (
                  <EmptyChat>
                    <FiMessageSquare size={40} />
                    <p>No messages yet. Say hello!</p>
                  </EmptyChat>
                )}
                {messages.map((msg, i) => {
                  const msgDate = new Date(msg.createdAt).toLocaleDateString();
                  const prevDate = i > 0 ? new Date(messages[i-1].createdAt).toLocaleDateString() : null;
                  const showDate = !prevDate || msgDate !== prevDate;
                  return (
                    <React.Fragment key={msg.id}>
                      {showDate && (
                        <DateSeparator>
                          <DateLabel>{new Date(msg.createdAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</DateLabel>
                        </DateSeparator>
                      )}
                      <MessageBubble
                        message={msg}
                        showSenderName={!!activeConv.isGroup}
                        deleteMode={deleteMode}
                        isSelected={selectedMessages.has(msg.id)}
                        onToggleSelect={toggleSelectMessage}
                      />
                    </React.Fragment>
                  );
                })}
                {showTyping.map(uid => (
                  <TypingIndicator key={uid} username={
                    activeConv.isGroup
                      ? (messages.find(m => m.senderId === uid)?.senderUsername || 'Someone')
                      : typingUsername
                  } />
                ))}
                <MessagesEnd ref={messagesEndRef} />
              </MessagesContainer>
              <ChatInput
                key={activeChat}
                onSend={handleSend}
                onTypingStart={handleTypingStart}
                onTypingStop={handleTypingStop}
                deleteMode={deleteMode}
                selectedCount={selectedMessages.size}
                onToggleDeleteMode={toggleDeleteMode}
                onDeleteSelected={handleDeleteSelected}
              />
            </>
          ) : (
            <EmptyChat>
              <FiMessageSquare size={60} />
              <h3>Welcome to Echoza</h3>
              <p>Select a conversation or click + to start</p>
            </EmptyChat>
          )}
        </ChatArea>
      </Main>

      {showAudioCall && (activeConv?.contact || callContact) && (
        <AudioCallUI
          contact={callContact || activeConv!.contact!}
          onEnd={() => { setShowAudioCall(false); setCallContact(null); setIncomingSdp(undefined); }}
          socket={socket}
          user={user}
          direction={incomingSdp ? 'incoming' : 'outgoing'}
          initialSdp={incomingSdp}
        />
      )}

      {showVideoCall && (activeConv?.contact || callContact) && (
        <VideoCallUI
          contact={callContact || activeConv!.contact!}
          onEnd={() => { setShowVideoCall(false); setCallContact(null); setIncomingSdp(undefined); }}
          socket={socket}
          user={user}
          direction={incomingSdp ? 'incoming' : 'outgoing'}
          initialSdp={incomingSdp}
        />
      )}

      {incomingCall && (
        <IncomingCall
          caller={incomingCall.caller}
          type={incomingCall.type}
          onAccept={handleAcceptCall}
          onDecline={handleDeclineCall}
        />
      )}

      {showNewChat && socket && (
        <ConversationModal
          socket={socket}
          onClose={() => setShowNewChat(false)}
          onStartDirect={handleStartDirect}
          onGroupCreated={handleGroupCreated}
        />
      )}

      {showProfileEdit && socket && user && (
        <ProfileEditModal
          currentUsername={user.username}
          currentAvatar={user.avatar}
          socket={socket}
          onClose={() => setShowProfileEdit(false)}
          onUpdate={handleProfileUpdate}
        />
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
        />
      )}

      <PwaGuide />
      <InstallBanner />
      {!showAudioCall && !showVideoCall && !incomingCall && (
        <Footer>Programmed and Designed by Arnav Jugessur</Footer>
      )}
    </Wrapper>
  );
}

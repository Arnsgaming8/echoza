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





import { FiMessageSquare } from 'react-icons/fi';
import { apiUrl } from '../utils/api';
import { addToOutbox, loadOutbox, removeFromOutbox } from '../utils/messageOutbox';
import { canMakeWebRTCCall, canIOSReceivePush } from '../utils/iosCapability';





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

const InactivityBanner = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: ${({ theme }) => theme.colors.secondary.warmGray}22;
  border-bottom: 1px solid ${({ theme }) => theme.colors.secondary.warmGray}66;
  color: ${({ theme }) => theme.colors.text.primary};
  padding: 10px 14px;
  font-size: ${({ theme }) => theme.font.size.sm};
  line-height: 1.45;
  flex-shrink: 0;
`;

const InactivityBannerBody = styled.div`
  flex: 1;
  min-width: 0;

  strong {
    font-weight: ${({ theme }) => theme.font.weight.bold};
  }
`;

const InactivityBannerDismiss = styled.button`
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.text.primary};
  padding: 4px 10px;
  font-size: 12px;
  border-radius: ${({ theme }) => theme.radius.sm};
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    background: ${({ theme }) => theme.colors.bg.card};
  }
`;


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
  const [showInactivityBanner, setShowInactivityBanner] = useState(() => {
    try {
      const createdAtRaw = localStorage.getItem('echoza-accountCreatedAt');
      const dismissed = localStorage.getItem('echoza-inactivityBannerDismissed');
      if (!createdAtRaw || dismissed === '1') return false;
      const createdAt = new Date(createdAtRaw).getTime();
      if (!Number.isFinite(createdAt)) return false;
      const ageMs = Date.now() - createdAt;
      return ageMs >= 0 && ageMs < 14 * 24 * 60 * 60 * 1000;
    } catch {
      return false;
    }
  });
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
    
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, opts); } catch {}
    }
  }, []);

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  const [subscribeNonce, setSubscribeNonce] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!canIOSReceivePush()) return;
    
    
    
    
    if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return;

    
    
    
    
    
    
    
    
    const snapshotUserId = user.id;

    let cancelled = false;
    (async () => {
      try {
        
        
        
        
        
        const vapidRes = await fetch(apiUrl('/api/push/vapid-public-key'));
        if (!vapidRes.ok || cancelled) return;
        const { publicKey } = await vapidRes.json();
        if (!publicKey || cancelled) return;

        const reg = await navigator.serviceWorker.ready;
        if (cancelled) return;

        let sub = await reg.pushManager.getSubscription().catch(() => null);
        if (sub) {
          const currentKey = urlBase64ToUint8Array(publicKey);
          const subKey = sub.options?.applicationServerKey as ArrayBuffer | Uint8Array | undefined;
          const subKeyArr = subKey instanceof Uint8Array
            ? subKey
            : subKey instanceof ArrayBuffer
              ? new Uint8Array(subKey)
              : null;
          let needsNewSub = true;
          if (subKeyArr && subKeyArr.length === currentKey.length) {
            let keysMatch = true;
            for (let i = 0; i < currentKey.length; i++) {
              if (subKeyArr[i] !== currentKey[i]) { keysMatch = false; break; }
            }
            needsNewSub = !keysMatch;
          }
          if (needsNewSub) {
            await sub.unsubscribe().catch(() => {});
            sub = null;
          }
        }
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey) as any,
          });
          if (cancelled) {
            sub.unsubscribe().catch(() => {});
            return;
          }
        }

        
        
        
        
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
        if (r.ok) {
          const data = await r.json().catch(() => null);
          if (data && data.success === true) {
            console.log('Push subscribed');
          } else {
            console.error('Push subscribe POST reported failure:', r.status, data);
          }
        } else {
          const errBody = await r.text().catch(() => '');
          console.error('Push subscribe POST failed:', r.status, errBody);
        }
      } catch (err) {
        if (!cancelled) console.error('Push subscribe error:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id, subscribeNonce]);

  useEffect(() => {
    
    
    
    
    const onAppInstalled = () => setSubscribeNonce(n => n + 1);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => window.removeEventListener('appinstalled', onAppInstalled);
  }, []);

  useEffect(() => {
    
    
    
    
    const onEnablePush = () => setSubscribeNonce(n => n + 1);
    window.addEventListener('echoza:enable-push', onEnablePush);
    return () => window.removeEventListener('echoza:enable-push', onEnablePush);
  }, []);

  useEffect(() => {
    
    
    
    const handleSwUpdate = () => setSubscribeNonce(n => n + 1);
    navigator.serviceWorker.addEventListener('controllerchange', handleSwUpdate);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', handleSwUpdate);
  }, []);

  useEffect(() => {
    
    
    
    
    
    
    
    
    
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

  
  
  
  
  
  
  
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (deepLinkHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const deepLinkConvId = params.get('conv');
    
    
    if (!deepLinkConvId) {
      deepLinkHandledRef.current = true;
      return;
    }
    
    
    if (conversations.length === 0) return;
    const conv = conversations.find(c => c.id === deepLinkConvId);
    if (!conv) {
      
      
      
      window.history.replaceState({}, '', '/dashboard');
      deepLinkHandledRef.current = true;
      return;
    }
    handleSelectChatRef.current(deepLinkConvId, conv);
    
    
    window.history.replaceState({}, '', '/dashboard');
    deepLinkHandledRef.current = true;
  }, [conversations]);







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

  
  useEffect(() => {
    if (!socket) return;

    setConversationsLoaded(true);

    
    
    
    
    
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
      
      
      
      if (message.senderId === userRef.current?.id ||
          (message.senderUsername && message.senderUsername === userRef.current?.username)) return;

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

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  useEffect(() => {
    if (!socket) return;

    socket.on('participant:change', ({ groupId, userId: changedUserId, op }: { groupId: string; userId: string; op: 'INSERT' | 'DELETE' }) => {
      const isAboutSelf = changedUserId === userRef.current?.id;
      const isActive = groupId === activeChatRef.current;

      
      
      if (op === 'DELETE' && isAboutSelf) {
        setConversations(prev => prev.filter(c => c.id !== groupId));
        if (isActive) {
          setActiveChat(null);
          setActiveConv(null);
          setMessages([]);
          setTypingUsers(new Set());
        }
        return;
      }

      
      
      
      if (isAboutSelf || conversationsRef.current.some(c => c.id === groupId)) {
        const t = localStorage.getItem('echoza-token');
        if (!t) return;
        fetch(apiUrl('/api/conversations'), { headers: { Authorization: `Bearer ${t}` } })
          .then(r => r.json())
          .then(data => setConversations(dedupeConversations(data)))
          .catch(() => {});
      }
    });

    return () => {
      socket.off('participant:change');
    };
  }, [socket]);

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
        {showInactivityBanner && (
          <InactivityBanner role="status">
            <InactivityBannerBody>
              <strong>New here?</strong>{' '}
              Echoza accounts auto-delete after 2 weeks of inactivity — every conversation, message, and contact goes with it. Sign in regularly to keep your account.
            </InactivityBannerBody>
            <InactivityBannerDismiss
              onClick={() => {
                try { localStorage.setItem('echoza-inactivityBannerDismissed', '1'); } catch {}
                setShowInactivityBanner(false);
              }}
            >
              Got it
            </InactivityBannerDismiss>
          </InactivityBanner>
        )}
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

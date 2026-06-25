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
import PwaGuide from '../components/onboarding/PwaGuide';
import InstallBanner from '../components/onboarding/InstallBanner';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';
import { FiMessageSquare } from 'react-icons/fi';
import { apiUrl } from '../utils/api';

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
`;

const MessagesContainer = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${({ theme }) => theme.spacing.md};
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
  height: 1px;
`;

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
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
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

  useEffect(() => {
    const VAPID_PUBLIC_KEY = 'BElSJ3Xzq6nNIl8na-ElTbhqAjZ9vdvta-S7Vw-kTdObrRgaJVSkYeHwrf_6Pey6o9woj6ssE0lfe37EU3ZXX0E';

    // PushManager works independently of page-level Notification API (iOS PWA + desktop)
    const subscribePush = (force = false) => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !user) return;

      navigator.serviceWorker.ready.then(reg => {
        const maybeUnsub = force
          ? reg.pushManager.getSubscription().then(s => { s?.unsubscribe().catch(() => {}); })
          : Promise.resolve();
        maybeUnsub.then(() => {
          reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as any,
          }).then(sub => {
            fetch(apiUrl('/api/push/subscribe'), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + localStorage.getItem('echoza-token'),
              },
              body: JSON.stringify(sub.toJSON()),
            }).then(r => r.ok && console.log('Push subscribed'))
              .catch(e => console.warn('Push subscribe POST failed:', e));
          }).catch(err => console.warn('Push subscribe failed:', err));
        });
      });
    };

    // Always try push subscription (SW PushManager works without page Notification API)
    subscribePush();

    // Re-subscribe when SW updates (new deploy) — unsubscribes old first
    const handleSwUpdate = () => { subscribePush(true); };
    navigator.serviceWorker.addEventListener('controllerchange', handleSwUpdate);

    const requestNotifPermission = () => {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(perm => {
          if (perm === 'granted') subscribePush();
        });
      }
    };

    // Try permission on first gesture
    const onUserGesture = () => {
      document.removeEventListener('click', onUserGesture, true);
      document.removeEventListener('touchstart', onUserGesture, true);
      requestNotifPermission();
    };
    document.addEventListener('click', onUserGesture, true);
    document.addEventListener('touchstart', onUserGesture, true);

    // Also try after a short delay in case user never clicks
    setTimeout(requestNotifPermission, 3000);

    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'navigate-conversation') {
        const convId = event.data.conversationId;
        const conv = conversationsRef.current.find(c => c.id === convId);
        if (conv) handleSelectChatRef.current(convId, conv);
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    navigator.serviceWorker.addEventListener('controllerchange', handleSwUpdate);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      navigator.serviceWorker.removeEventListener('controllerchange', handleSwUpdate);
      document.removeEventListener('click', onUserGesture, true);
      document.removeEventListener('touchstart', onUserGesture, true);
    };
  }, [user]);



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

  // Register conversation:list handlers once (never cleaned up)
  useEffect(() => {
    if (!socket) {
      console.log('[Dashboard] useConversationEffect: no socket yet, skipping');
      return;
    }

    console.log('[Dashboard] useConversationEffect: registering handlers');
    socket.on('conversations:list', (data: Conversation[]) => {
      console.log('[Dashboard] conversations:list received, count:', data.length);
      setConversations(data);
      if (!conversationsLoaded) setConversationsLoaded(true);
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

    socket.emit('conversations:list');

    const poll = setInterval(() => socket.emit('conversations:list'), 5000);
    return () => {
      clearInterval(poll);
      socket.off('conversations:list');
      socket.off('conversation:update');
      socket.off('conversation:deleted');
      socket.off('messages:deleted');
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;

    // message:sent is echoed to the sender only — never triggers notification
    socket.on('message:sent', (message: any) => {
      if (message.conversationId === activeChatRef.current) {
        setMessages(prev => {
          if (prev.some(m => m.id === message.id)) return prev;
          return [...prev, message];
        });
      }
      socket.emit('conversations:list');
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

    socket.on('message:readReceipt', ({ messageId }: { messageId: string }) => {
      setMessages(prev =>
        prev.map(m => (m.id === messageId ? { ...m, read: true } : m))
      );
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

    return () => {
      socket.off('message:sent');
      socket.off('message:new');
      socket.off('message:readReceipt');
      socket.off('typing:start');
      socket.off('typing:stop');
      socket.off('call:offer');
      socket.off('call:end');
      socket.off('profile:updateResult');
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
    socket.emit('messages:delete', {
      messageIds: Array.from(selectedMessages),
      conversationId: activeChat,
    });
  };

  useEffect(() => {
    if (!socket || !activeChat) return;

    const handler = (data: Message[]) => {
      setMessages(data);
      scrollToBottom(forceScrollNext.current);
      forceScrollNext.current = false;

      setConversations(prev => prev.map(c =>
        c.id === activeChat ? { ...c, unread: 0 } : c
      ));

      data.forEach(m => {
        if (m.senderId !== user?.id && !m.read) {
          socket.emit('message:read', { messageId: m.id, conversationId: activeChat });
        }
      });
    };

    socket.on('messages:list', handler);
    return () => { socket.off('messages:list', handler); };
  }, [socket, activeChat, scrollToBottom, user?.id]);

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
      const payload: any = { content };
      if (processedAttachments) payload.attachments = processedAttachments;

      if (activeConv.isGroup) {
        payload.groupId = activeConv.id;
      } else if (activeConv.contact) {
        payload.receiverId = activeConv.contact.id;
      }

      socket.emit('message:send', payload);
    });

    const preview = attachments?.length
      ? `📎 ${attachments.length} file(s)`
      : content;

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

    socket.on('direct:started', ({ conversationId }: { conversationId: string }) => {
      socket.off('direct:started');
      socket.emit('conversations:list');
      setTimeout(() => {
        const conv = conversations.find(c => c.id === conversationId);
        if (conv) handleSelectChat(conversationId, conv);
      }, 300);
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
    setCallContact(activeConv.contact || null);
    setShowAudioCall(true);
  };

  const handleVideoCall = () => {
    if (!activeConv) return;
    setCallContact(activeConv.contact || null);
    setShowVideoCall(true);
  };

  const [incomingSdp, setIncomingSdp] = useState<string | undefined>();

  const handleAcceptCall = () => {
    if (!incomingCall) return;
    setCallContact(incomingCall.caller);
    setIncomingSdp(incomingCall.sdp);
    // Pre-warm media permission within user gesture (required by iOS Safari)
    const needsVideo = incomingCall.type === 'video';
    navigator.mediaDevices.getUserMedia({ audio: true, video: needsVideo })
      .then(stream => stream.getTracks().forEach(t => t.stop()))
      .catch(() => {});
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

      <PwaGuide />
      <InstallBanner />
    </Wrapper>
  );
}

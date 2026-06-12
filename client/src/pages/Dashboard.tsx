import { useState, useEffect, useRef, useCallback } from 'react';
import styled from 'styled-components';
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
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';
import { FiMessageSquare } from 'react-icons/fi';

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

const Wrapper = styled.div`
  display: flex;
  height: 100dvh;
  overflow: hidden;
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
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [callContact, setCallContact] = useState<Contact | null>(null);
  const [showAudioCall, setShowAudioCall] = useState(false);
  const [showVideoCall, setShowVideoCall] = useState(false);
  const [receivedOffer, setReceivedOffer] = useState<any>(null);
  const [incomingCall, setIncomingCall] = useState<{
    caller: { id: string; username: string; avatar: string };
    type: 'audio' | 'video';
    offer: any;
  } | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeConvRef = useRef(activeConv);
  activeConvRef.current = activeConv;
  const showAudioCallRef = useRef(showAudioCall);
  showAudioCallRef.current = showAudioCall;
  const showVideoCallRef = useRef(showVideoCall);
  showVideoCallRef.current = showVideoCall;
  const callContactRef = useRef(callContact);
  callContactRef.current = callContact;

  useEffect(() => {
    const VAPID_PUBLIC_KEY = 'BElSJ3Xzq6nNIl8na-ElTbhqAjZ9vdvta-S7Vw-kTdObrRgaJVSkYeHwrf_6Pey6o9woj6ssE0lfe37EU3ZXX0E';

    const subscribePush = () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !user) return;
      if (Notification.permission !== 'granted') return;

      navigator.serviceWorker.ready.then(reg => {
        reg.pushManager.getSubscription().then(existingSub => {
          if (existingSub) return;
          reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as any,
          }).then(sub => {
            fetch('/api/push/subscribe', {
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

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') subscribePush();
      });
    } else {
      subscribePush();
    }

    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'navigate-conversation') {
        const convId = event.data.conversationId;
        const conv = conversationsRef.current.find(c => c.id === convId);
        if (conv) handleSelectChatRef.current(convId, conv);
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleSwMessage);
  }, [user]);



  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }, []);

  // Register conversation:list handlers once (never cleaned up)
  useEffect(() => {
    if (!socket) return;

    socket.on('conversations:list', (data: Conversation[]) => {
      setConversations(data);
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

    return () => {
      socket.off('conversations:list');
      socket.off('conversation:update');
      socket.off('conversation:deleted');
      socket.off('messages:deleted');
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;

    socket.on('message:new', (message: Message) => {
      if (message.conversationId === activeChat) {
        setMessages(prev => {
          if (prev.some(m => m.id === message.id)) return prev;
          return [...prev, message];
        });
        if (document.visibilityState === 'visible' && message.senderId !== user?.id) {
          setConversations(prev => prev.map(c =>
            c.id === message.conversationId ? { ...c, unread: 0 } : c
          ));
          setTimeout(() => {
            socket.emit('message:read', { messageId: message.id, conversationId: message.conversationId });
          }, 500);
        }
      } else if (document.visibilityState !== 'visible' && message.senderId !== user?.id && 'Notification' in window) {
        const senderName = message.senderUsername || message.senderId.slice(0, 6);
        const body = senderName + ': ' + (message.content || 'Sent an attachment');
        if (Notification.permission === 'granted') {
          navigator.serviceWorker.ready.then(reg => {
            reg.showNotification('Echoza', {
              body,
              icon: '/vite.svg',
              tag: message.conversationId,
              data: { conversationId: message.conversationId, url: '/' },
            });
          }).catch(() => {
            try { new Notification('Echoza', { body, icon: '/vite.svg' }); } catch {}
          });
        }
      }
      socket.emit('conversations:list');
    });

    socket.on('message:readReceipt', ({ messageId }: { messageId: string }) => {
      setMessages(prev =>
        prev.map(m => (m.id === messageId ? { ...m, read: true } : m))
      );
    });

    socket.on('typing:start', ({ userId: typingUserId, conversationId }: { userId: string; conversationId: string }) => {
      if (conversationId === activeChat) {
        setTypingUsers(prev => new Set(prev).add(typingUserId));
      }
    });

    socket.on('typing:stop', ({ userId: typingUserId, conversationId }: { userId: string; conversationId: string }) => {
      if (conversationId === activeChat) {
        setTypingUsers(prev => {
          const next = new Set(prev);
          next.delete(typingUserId);
          return next;
        });
      }
    });

    socket.on('call:offer', ({ from, username: callerUsername, avatar: callerAvatar, type, offer }: { from: string; username: string; avatar: string; type: 'audio' | 'video'; offer: any }) => {
      setIncomingCall({
        caller: { id: from, username: callerUsername, avatar: callerAvatar },
        type: type || 'audio',
        offer,
      });

      if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
        const body = (type === 'video' ? 'Video call' : 'Audio call') + ' from ' + callerUsername;
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification('Echoza', {
            body,
            icon: '/vite.svg',
            tag: 'call-' + from,
            data: { url: '/' },
          });
        }).catch(() => {
          try { new Notification('Echoza', { body, icon: '/vite.svg' }); } catch {}
        });
      }
    });

    socket.on('call:end', ({ from }: { from: string }) => {
      if (showAudioCallRef.current || showVideoCallRef.current) {
        if (callContactRef.current?.id === from || activeConvRef.current?.contact?.id === from) {
          setShowAudioCall(false);
          setShowVideoCall(false);
          setCallContact(null);
          setReceivedOffer(null);
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
      socket.off('message:new');
      socket.off('message:readReceipt');
      socket.off('typing:start');
      socket.off('typing:stop');
      socket.off('call:offer');
      socket.off('call:end');
      socket.off('profile:updateResult');
    };
  }, [socket, activeChat, connected]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSelectChat = (conversationId: string, conv: Conversation) => {
    setActiveChat(conversationId);
    setActiveConv(conv);
    setMessages([]);
    setTypingUsers(new Set());
    setShowSidebar(false);
    setDeleteMode(false);
    setSelectedMessages(new Set());

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
      scrollToBottom();

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
        base.data = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(att.file);
        });
        processed.push(base);
      }
      return processed;
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
    setReceivedOffer(null);
    if (activeConv.isGroup && socket) {
      socket.emit('call:group-offer', { groupId: activeConv.id, type: 'audio', offer: {} });
    }
    setShowAudioCall(true);
  };

  const handleVideoCall = () => {
    if (!activeConv) return;
    setReceivedOffer(null);
    if (activeConv.isGroup && socket) {
      socket.emit('call:group-offer', { groupId: activeConv.id, type: 'video', offer: {} });
    }
    setShowVideoCall(true);
  };

  const handleAcceptCall = () => {
    if (!incomingCall) return;
    setCallContact(incomingCall.caller);
    setReceivedOffer(incomingCall.offer);
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
              <MessagesContainer>
                {messages.length === 0 && (
                  <EmptyChat>
                    <FiMessageSquare size={40} />
                    <p>No messages yet. Say hello!</p>
                  </EmptyChat>
                )}
                {messages.map(msg => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    showSenderName={!!activeConv.isGroup}
                    deleteMode={deleteMode}
                    isSelected={selectedMessages.has(msg.id)}
                    onToggleSelect={toggleSelectMessage}
                  />
                ))}
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
          onEnd={() => { setShowAudioCall(false); setCallContact(null); setReceivedOffer(null); }}
          socket={socket}
          user={user}
          isInitiator={!receivedOffer}
          remoteOffer={receivedOffer}
        />
      )}

      {showVideoCall && (activeConv?.contact || callContact) && (
        <VideoCallUI
          contact={callContact || activeConv!.contact!}
          onEnd={() => { setShowVideoCall(false); setCallContact(null); setReceivedOffer(null); }}
          socket={socket}
          user={user}
          isInitiator={!receivedOffer}
          remoteOffer={receivedOffer}
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
    </Wrapper>
  );
}

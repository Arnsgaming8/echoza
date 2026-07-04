import { useState, useRef, useEffect } from 'react';
import styled, { keyframes } from 'styled-components';
import { Avatar, Badge, StatusDot } from '../../common';
import { useAuth } from '../../../contexts/AuthContext';
import { useSocket } from '../../../contexts/SocketContext';
import { FiLogOut, FiSearch, FiMessageSquare, FiEdit3, FiPlus, FiUsers, FiX, FiTrash2 } from 'react-icons/fi';

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
  members?: { id: string; username: string; avatar: string; online?: boolean }[];
  lastMessage: string;
  lastTime: string;
  unread: number;
}

interface SidebarProps {
  conversations: Conversation[];
  activeChat: string | null;
  onSelectChat: (conversationId: string, conv: Conversation) => void;
  onDeleteChat: (conversationId: string) => void;
  onSearch: (query: string) => void;
  onAddChat: () => void;
  onEditProfile: () => void;
  showSidebar?: boolean;
  onToggleSidebar?: () => void;
}

const Backdrop = styled.div<{ $show: boolean }>`
  display: none;

  @media (max-width: 768px) {
    display: ${({ $show }) => ($show ? 'block' : 'none')};
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 99;
  }
`;

const Wrapper = styled.aside<{ $show: boolean }>`
  width: 320px;
  min-width: 320px;
  height: 100dvh;
  background: ${({ theme }) => theme.colors.bg.sidebar};
  border-right: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  flex-direction: column;
  animation: slideInLeft 0.3s ease;
  position: relative;
  z-index: 100;

  @media (max-width: 768px) {
    position: fixed;
    inset: 0;
    width: 100%;
    min-width: 0;
    transform: translateX(${({ $show }) => ($show ? '0' : '-100%')});
    transition: transform 0.3s ease;
    animation: none;
  }
`;

const CloseBtn = styled.button`
  display: none;

  @media (max-width: 768px) {
    display: flex;
    width: 34px;
    height: 34px;
    align-items: center;
    justify-content: center;
    border-radius: ${({ theme }) => theme.radius.sm};
    background: transparent;
    color: ${({ theme }) => theme.colors.text.secondary};
    font-size: 20px;
    transition: all ${({ theme }) => theme.transition};
    flex-shrink: 0;

    &:hover {
      background: ${({ theme }) => theme.colors.bg.hover};
      color: ${({ theme }) => theme.colors.text.primary};
    }
  }
`;

const ProfileSection = styled.div`
  padding: ${({ theme }) => theme.spacing.lg};
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const UserInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

function ChatNameContent({ text }: { text: string | undefined }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    if (ref.current && ref.current.parentElement) {
      setOverflows(ref.current.scrollWidth > ref.current.parentElement.clientWidth);
    }
  }, [text]);

  if (!text) return <>&nbsp;</>;

  if (!overflows) return <span ref={ref}>{text}</span>;

  const speed = Math.max(8, text.length * 0.4);

  return (
    <TickerInner $speed={speed}>
      <span style={{ paddingRight: 24 }}>{text}</span>
      <span style={{ paddingRight: 24 }}>{text}</span>
    </TickerInner>
  );
}

const Username = styled.h3`
  font-size: ${({ theme }) => theme.font.size.md};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.colors.text.primary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const StatusRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
`;

const StatusText = styled.span`
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const ActionBtns = styled.div`
  display: flex;
  gap: 4px;
`;

const IconBtn = styled.button<{ $color?: string }>`
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: ${({ $color }) => $color || 'transparent'};
  color: ${({ $color, theme }) => $color ? 'white' : theme.colors.text.secondary};
  font-size: 16px;
  transition: all ${({ theme }) => theme.transition};

  &:hover {
    background: ${({ $color, theme }) => $color || theme.colors.bg.hover};
    opacity: 0.9;
  }
`;

const SearchBar = styled.div`
  padding: ${({ theme }) => theme.spacing.md};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  gap: 8px;
  align-items: center;
`;

const SearchInput = styled.input`
  flex: 1;
  padding: 10px 14px 10px 36px;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.bg.input};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: ${({ theme }) => theme.font.size.sm};

  &::placeholder {
    color: ${({ theme }) => theme.colors.secondary.warmGray};
  }
`;

const SearchIcon = styled(FiSearch)`
  position: absolute;
  left: 28px;
  top: 50%;
  transform: translateY(-50%);
  color: ${({ theme }) => theme.colors.secondary.warmGray};
  font-size: 14px;
`;

const SearchWrapper = styled.div`
  position: relative;
  flex: 1;
`;

const ChatList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${({ theme }) => theme.spacing.sm};
`;

const ChatItem = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.md};
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: pointer;
  touch-action: manipulation;
  transition: all ${({ theme }) => theme.transition};
  background: ${({ $active, theme }) =>
    $active ? theme.colors.bg.hover : 'transparent'};
  border-left: 3px solid ${({ $active, theme }) =>
    $active ? theme.colors.primary.echoBlue : 'transparent'};

  @media (hover: hover) {
    &:hover {
      background: ${({ theme }) => theme.colors.bg.hover};
    }

    &:hover .delete-btn {
      opacity: 1;
    }
  }
`;

const DeleteBtn = styled.button`
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: ${({ theme }) => theme.radius.sm};
  color: ${({ theme }) => theme.colors.danger || '#e74c3c'};
  font-size: 14px;
  flex-shrink: 0;

  @media (hover: hover) {
    opacity: 0;
    transition: opacity 0.2s;

    &:hover {
      background: ${({ theme }) => theme.colors.bg.hover};
    }
  }
`;

const ChatInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const ticker = keyframes`
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
`;

const ChatName = styled.h4`
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.colors.text.primary};
  white-space: nowrap;
  overflow: hidden;
`;

const TickerInner = styled.span<{ $speed: number }>`
  display: inline-flex;
  animation: ${ticker} ${({ $speed }) => $speed}s linear infinite;
`;

const GroupLabel = styled.span`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  margin-left: 6px;
`;

const LastMessage = styled.p`
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.colors.text.secondary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
`;

const TimeBadge = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
`;

const Time = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.secondary.warmGray};
  white-space: nowrap;
`;

const GroupIcon = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.bg.hover};
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  font-size: 18px;
  flex-shrink: 0;
`;

const EmptyState = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.text.secondary};
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.xl};
  text-align: center;
`;

export default function Sidebar({
  conversations,
  activeChat,
  onSelectChat,
  onDeleteChat,
  onSearch,
  onAddChat,
  onEditProfile,
  showSidebar,
  onToggleSidebar,
}: SidebarProps) {
  const { user, logout } = useAuth();
  const { onlineUsers, selfOnline } = useSocket();
  const [searchQuery, setSearchQuery] = useState('');

  const isOnline = user ? selfOnline : false;

  const handleSearch = (val: string) => {
    setSearchQuery(val);
    onSearch(val);
  };

  const formatTime = (timeStr: string) => {
    if (!timeStr) return '';
    const date = new Date(timeStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <>
      <Backdrop $show={!!showSidebar} onClick={onToggleSidebar} />
      <Wrapper $show={!!showSidebar}>
        <ProfileSection>
          <Avatar
            username={user?.username}
            src={user?.avatar}
            size={44}
            online={isOnline}
          />
          <UserInfo>
            <Username>{user?.username || 'User'}</Username>
            <StatusRow>
              <StatusDot online={isOnline} />
              <StatusText>{isOnline ? 'Online' : 'Offline'}</StatusText>
            </StatusRow>
          </UserInfo>
          <ActionBtns>
            <CloseBtn onClick={onToggleSidebar}>
              <FiX />
            </CloseBtn>
            <IconBtn onClick={onEditProfile} title="Edit profile">
              <FiEdit3 />
            </IconBtn>
            <IconBtn onClick={logout} title="Log out">
              <FiLogOut />
            </IconBtn>
          </ActionBtns>
        </ProfileSection>

        <SearchBar>
          <SearchWrapper>
            <SearchIcon />
            <SearchInput
              placeholder="Search chats..."
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
            />
          </SearchWrapper>
          <IconBtn $color="#3A7BFF" onClick={onAddChat} title="New conversation">
            <FiPlus />
          </IconBtn>
        </SearchBar>

        <ChatList>
          {conversations.length === 0 ? (
            <EmptyState>
              <FiMessageSquare size={40} />
              <p>No conversations yet</p>
              <p style={{ fontSize: '12px' }}>Click + to start chatting</p>
            </EmptyState>
          ) : (
            conversations.map(conv => (
              <ChatItem
                key={conv.id}
                $active={activeChat === conv.id}
                onClick={() => onSelectChat(conv.id, conv)}
              >
                {conv.isGroup ? (
                  <GroupIcon>
                    <FiUsers />
                  </GroupIcon>
                ) : (
                  <Avatar
                    username={conv.contact?.username}
                    src={conv.contact?.avatar}
                    size={40}
                    online={conv.contact ? onlineUsers.includes(conv.contact.id) : false}
                  />
                )}
                <ChatInfo>
                  <ChatName>
                    <ChatNameContent text={conv.isGroup ? conv.groupName : conv.contact?.username} />
                    {conv.isGroup && <GroupLabel>group</GroupLabel>}
                  </ChatName>
                  <LastMessage>{conv.lastMessage || 'No messages yet'}</LastMessage>
                </ChatInfo>
                <TimeBadge>
                  <Time>{formatTime(conv.lastTime)}</Time>
                  <Badge count={conv.unread} />
                </TimeBadge>
                <DeleteBtn className="delete-btn" onClick={e => { e.stopPropagation(); onDeleteChat(conv.id); }}>
                  <FiTrash2 />
                </DeleteBtn>
              </ChatItem>
            ))
          )}
        </ChatList>
      </Wrapper>
    </>
  );
}

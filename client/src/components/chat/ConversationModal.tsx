import { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Avatar, Button } from '../common';
import { FiX, FiUsers, FiUserPlus, FiMessageSquare, FiCheck } from 'react-icons/fi';

interface User {
  id: string;
  username: string;
  avatar: string;
  online: boolean;
}

interface ConversationModalProps {
  socket: any;
  onClose: () => void;
  onStartDirect: (userId: string) => void;
  onGroupCreated: (conversationId: string) => void;
}

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
  animation: fadeIn 0.2s ease;
`;

const Modal = styled.div`
  width: 440px;
  max-width: 92vw;
  max-height: 80vh;
  background: ${({ theme }) => theme.colors.bg.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.lg};
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: fadeIn 0.3s ease;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${({ theme }) => theme.spacing.lg};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const Title = styled.h3`
  font-size: ${({ theme }) => theme.font.size.lg};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.colors.text.primary};
`;

const CloseBtn = styled.button`
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: transparent;
  color: ${({ theme }) => theme.colors.text.secondary};
  font-size: 18px;

  &:hover {
    background: ${({ theme }) => theme.colors.bg.hover};
  }
`;

const Tabs = styled.div`
  display: flex;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const Tab = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  color: ${({ $active, theme }) => $active ? theme.colors.primary.echoBlue : theme.colors.text.secondary};
  background: transparent;
  border-bottom: 2px solid ${({ $active, theme }) => $active ? theme.colors.primary.echoBlue : 'transparent'};
  transition: all ${({ theme }) => theme.transition};

  &:hover {
    background: ${({ theme }) => theme.colors.bg.hover};
  }
`;

const SearchSection = styled.div`
  padding: ${({ theme }) => theme.spacing.md};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const SearchInput = styled.input`
  width: 100%;
  padding: 10px 14px;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.bg.input};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: ${({ theme }) => theme.font.size.sm};

  &::placeholder {
    color: ${({ theme }) => theme.colors.secondary.warmGray};
  }
`;

const UserList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${({ theme }) => theme.spacing.sm};
`;

const UserItem = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.md};
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: pointer;
  transition: all ${({ theme }) => theme.transition};

  &:hover {
    background: ${({ theme }) => theme.colors.bg.hover};
  }
`;

const UserInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const UserName = styled.span`
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.colors.text.primary};
`;

const UserStatus = styled.span`
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-left: 8px;
`;

const Checkbox = styled.div<{ $checked: boolean }>`
  width: 22px;
  height: 22px;
  border-radius: ${({ theme }) => theme.radius.sm};
  border: 2px solid ${({ $checked, theme }) => $checked ? theme.colors.primary.echoBlue : theme.colors.border};
  background: ${({ $checked, theme }) => $checked ? theme.colors.primary.echoBlue : 'transparent'};
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 12px;
  flex-shrink: 0;
  transition: all ${({ theme }) => theme.transition};
`;

const GroupNameInput = styled.input`
  width: 100%;
  padding: 10px 14px;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.bg.input};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: ${({ theme }) => theme.font.size.sm};
  margin-bottom: ${({ theme }) => theme.spacing.sm};

  &::placeholder {
    color: ${({ theme }) => theme.colors.secondary.warmGray};
  }
`;

const Footer = styled.div`
  padding: ${({ theme }) => theme.spacing.md};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  justify-content: flex-end;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const EmptyText = styled.p`
  text-align: center;
  color: ${({ theme }) => theme.colors.text.secondary};
  padding: ${({ theme }) => theme.spacing.xl};
  font-size: ${({ theme }) => theme.font.size.sm};
`;

export default function ConversationModal({
  socket,
  onClose,
  onStartDirect,
  onGroupCreated,
}: ConversationModalProps) {
  const [tab, setTab] = useState<'direct' | 'group'>('direct');
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState('');

  useEffect(() => {
    if (!socket || !search.trim()) {
      setUsers([]);
      return;
    }
    const timer = setTimeout(() => {
      socket.emit('users:search', { query: search });
    }, 300);

    const handler = (data: User[]) => setUsers(data);
    socket.on('users:search', handler);

    return () => {
      clearTimeout(timer);
      socket.off('users:search', handler);
    };
  }, [socket, search]);

  const handleDirectStart = (targetId: string) => {
    onStartDirect(targetId);
    onClose();
  };

  const toggleMember = (id: string) => {
    setSelectedMembers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateGroup = () => {
    if (!socket || selectedMembers.size === 0) return;
    socket.emit('group:create', {
      name: groupName.trim() || `${selectedMembers.size + 1} members`,
      memberIds: Array.from(selectedMembers),
    });

    const handler = (data: { conversationId: string }) => {
      onGroupCreated(data.conversationId);
      socket.off('group:created', handler);
    };
    socket.on('group:created', handler);
    onClose();
  };

  return (
    <Overlay onClick={onClose}>
      <Modal onClick={e => e.stopPropagation()}>
        <Header>
          <Title>New Conversation</Title>
          <CloseBtn onClick={onClose}>
            <FiX />
          </CloseBtn>
        </Header>

        <Tabs>
          <Tab $active={tab === 'direct'} onClick={() => setTab('direct')}>
            <FiMessageSquare size={16} /> Direct
          </Tab>
          <Tab $active={tab === 'group'} onClick={() => setTab('group')}>
            <FiUsers size={16} /> Group
          </Tab>
        </Tabs>

        <SearchSection>
          <SearchInput
            placeholder={tab === 'direct' ? 'Search users...' : 'Search users to add...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </SearchSection>

        {tab === 'group' && (
          <SearchSection style={{ borderTop: 'none', paddingTop: 0 }}>
            <GroupNameInput
              placeholder="Group name (optional)"
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
            />
          </SearchSection>
        )}

        <UserList>
          {users.length === 0 ? (
            <EmptyText>
              {search ? 'No users found' : 'Type to search for users'}
            </EmptyText>
          ) : (
            users.map(u => (
              <UserItem
                key={u.id}
                onClick={() => tab === 'direct' ? handleDirectStart(u.id) : toggleMember(u.id)}
              >
                  <Avatar username={u.username} src={u.avatar} size={36} online={u.online} />
                <UserInfo>
                  <UserName>{u.username}</UserName>
                  <UserStatus>{u.online ? 'Online' : 'Offline'}</UserStatus>
                </UserInfo>
                {tab === 'group' && (
                  <Checkbox $checked={selectedMembers.has(u.id)}>
                    {selectedMembers.has(u.id) && <FiCheck />}
                  </Checkbox>
                )}
              </UserItem>
            ))
          )}
        </UserList>

        {tab === 'group' && (
          <Footer>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              disabled={selectedMembers.size === 0}
              onClick={handleCreateGroup}
            >
              <FiUserPlus /> Create Group ({selectedMembers.size + 1} members)
            </Button>
          </Footer>
        )}
      </Modal>
    </Overlay>
  );
}

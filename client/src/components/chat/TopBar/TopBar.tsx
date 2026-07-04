import styled from 'styled-components';
import { Avatar, StatusDot } from '../../common';
import { FiSettings, FiSun, FiMoon, FiPhone, FiVideo, FiUsers, FiMenu, FiTrash2 } from 'react-icons/fi';
import { useTheme } from '../../../contexts/ThemeContext';
import { useSocket } from '../../../contexts/SocketContext';

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
}

interface TopBarProps {
  conversation: Conversation | null;
  onAudioCall: () => void;
  onVideoCall: () => void;
  onToggleSidebar?: () => void;
  deleteMode?: boolean;
  onToggleDeleteMode?: () => void;
}

const Wrapper = styled.header`
  height: 64px;
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 ${({ theme }) => theme.spacing.lg};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bg.sidebar};

  @media (max-width: 768px) {
    padding: 0 ${({ theme }) => theme.spacing.sm};
  }
`;

const Left = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  min-width: 0;
`;

const Hamburger = styled.button`
  display: none;
  width: 36px;
  height: 36px;
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

  @media (max-width: 768px) {
    display: flex;
  }
`;

const Logo = styled.span`
  font-size: ${({ theme }) => theme.font.size.lg};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  letter-spacing: -0.5px;

  @media (max-width: 768px) {
    display: none;
  }
`;

const ContactInfo = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding-left: ${({ theme }) => theme.spacing.md};
  border-left: 1px solid ${({ theme }) => theme.colors.border};

  @media (max-width: 768px) {
    border-left: none;
    padding-left: 0;
  }
`;

const GroupIconBig = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.bg.hover};
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  font-size: 18px;
  flex-shrink: 0;
`;

const ContactName = styled.span`
  font-size: ${({ theme }) => theme.font.size.md};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.colors.text.primary};
`;

const StatusLabel = styled.span`
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const MemberCount = styled.span`
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const Right = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const IconBtn = styled.button<{ $active?: boolean }>`
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: ${({ $active, theme }) =>
    $active ? theme.colors.primary.echoBlue : 'transparent'};
  color: ${({ $active }) =>
    $active ? 'white' : 'inherit'};
  font-size: 18px;
  transition: all ${({ theme }) => theme.transition};

  &:hover {
    background: ${({ $active, theme }) =>
      $active ? theme.colors.primary.echoBlue : theme.colors.bg.hover};
    color: ${({ $active }) =>
      $active ? 'white' : 'inherit'};
  }
`;

export default function TopBar({ conversation, onAudioCall, onVideoCall, onToggleSidebar, deleteMode, onToggleDeleteMode }: TopBarProps) {
  const { isDark, toggleTheme } = useTheme();
  const { onlineUsers } = useSocket();
  const contactOnline = conversation?.contact ? onlineUsers.includes(conversation.contact.id) : false;

  const showCallButtons = !!conversation;

  return (
    <Wrapper>
      <Left>
        <Hamburger onClick={onToggleSidebar} title="Toggle sidebar">
          <FiMenu />
        </Hamburger>
        <Logo>Echoza</Logo>
        {conversation && (
          <ContactInfo>
            {conversation.isGroup ? (
              <GroupIconBig>
                <FiUsers />
              </GroupIconBig>
            ) : (
              <Avatar
                username={conversation.contact?.username}
                src={conversation.contact?.avatar}
                size={36}
                online={contactOnline}
              />
            )}
            <div>
              <ContactName>
                {conversation.isGroup ? conversation.groupName : conversation.contact?.username}
              </ContactName>
              {conversation.isGroup ? (
                <MemberCount>{conversation.members?.length || 0} members</MemberCount>
              ) : (
                <StatusLabel>
                  <StatusDot online={contactOnline} />
                  {' '}{contactOnline ? 'Online' : 'Offline'}
                </StatusLabel>
              )}
            </div>
          </ContactInfo>
        )}
      </Left>
      <Right>
        {showCallButtons && (
          <>
            <IconBtn onClick={onAudioCall} title="Audio call">
              <FiPhone />
            </IconBtn>
            <IconBtn onClick={onVideoCall} title="Video call">
              <FiVideo />
            </IconBtn>
          </>
        )}
        {conversation && (
          <IconBtn onClick={onToggleDeleteMode} title={deleteMode ? 'Cancel' : 'Delete messages'} $active={deleteMode}>
            <FiTrash2 />
          </IconBtn>
        )}
        <IconBtn onClick={toggleTheme} title="Toggle theme">
          {isDark ? <FiSun /> : <FiMoon />}
        </IconBtn>
        <IconBtn title="Settings">
          <FiSettings />
        </IconBtn>
      </Right>
    </Wrapper>
  );
}

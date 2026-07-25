import styled from 'styled-components';
import { Avatar, StatusDot } from '../../common';
import { FiSettings, FiSun, FiMoon, FiPhone, FiVideo, FiUsers, FiMenu } from 'react-icons/fi';
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
  onSettings?: () => void;
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
  overflow: hidden;

  @media (max-width: 768px) {
    padding: 0 ${({ theme }) => theme.spacing.xs};
  }
`;

const Left = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  min-width: 0;
  flex: 1;
  overflow: hidden;

  @media (min-width: 769px) {
    gap: ${({ theme }) => theme.spacing.md};
  }
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

const LogoWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;

  @media (max-width: 768px) {
    display: none;
  }
`;

const LogoImg = styled.img`
  width: 28px;
  height: 28px;
  flex-shrink: 0;
`;

const Logo = styled.span`
  font-size: ${({ theme }) => theme.font.size.lg};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  letter-spacing: -0.5px;
`;

const ContactInfo = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding-left: ${({ theme }) => theme.spacing.md};
  border-left: 1px solid ${({ theme }) => theme.colors.border};
  min-width: 0;
  overflow: hidden;

  @media (max-width: 768px) {
    border-left: none;
    padding-left: 0;
    gap: 6px;
  }

  @media (min-width: 769px) {
    gap: ${({ theme }) => theme.spacing.md};
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  max-width: 140px;

  @media (min-width: 769px) {
    max-width: 200px;
  }

  @media (min-width: 1024px) {
    max-width: 300px;
  }
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
  gap: 4px;
  flex-shrink: 0;

  @media (min-width: 769px) {
    gap: ${({ theme }) => theme.spacing.sm};
  }
`;

const IconBtn = styled.button<{ $active?: boolean; $hideOnMobile?: boolean }>`
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
  flex-shrink: 0;

  &:hover {
    background: ${({ $active, theme }) =>
      $active ? theme.colors.primary.echoBlue : theme.colors.bg.hover};
    color: ${({ $active }) =>
      $active ? 'white' : 'inherit'};
  }

  @media (max-width: 768px) {
    width: 32px;
    height: 32px;
    font-size: 16px;
    display: ${({ $hideOnMobile }) => ($hideOnMobile ? 'none' : 'flex')};
  }
`;

export default function TopBar({ conversation, onAudioCall, onVideoCall, onToggleSidebar, onSettings }: TopBarProps) {
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
        <LogoWrapper>
          <LogoImg src="/vite.svg" alt="Echoza" />
          <Logo>Echoza</Logo>
        </LogoWrapper>
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
            <div style={{ minWidth: 0, overflow: 'hidden' }}>
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
        <IconBtn onClick={toggleTheme} title="Toggle theme" $hideOnMobile>
          {isDark ? <FiSun /> : <FiMoon />}
        </IconBtn>
        <IconBtn onClick={onSettings} title="Settings">
          <FiSettings />
        </IconBtn>
      </Right>
    </Wrapper>
  );
}

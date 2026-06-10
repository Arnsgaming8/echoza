import styled from 'styled-components';
import { Avatar, StatusDot } from '../../common';
import { FiSettings, FiSun, FiMoon, FiPhone, FiVideo, FiUsers } from 'react-icons/fi';
import { useTheme } from '../../../contexts/ThemeContext';

interface Contact {
  id: string;
  username: string;
  avatar: string;
  online: boolean;
}

interface Conversation {
  id: string;
  isGroup?: boolean;
  contact?: Contact;
  groupName?: string;
  members?: { id: string; username: string; avatar: string; online: boolean }[];
}

interface TopBarProps {
  conversation: Conversation | null;
  onAudioCall: () => void;
  onVideoCall: () => void;
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
`;

const Left = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
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
  gap: ${({ theme }) => theme.spacing.md};
  padding-left: ${({ theme }) => theme.spacing.md};
  border-left: 1px solid ${({ theme }) => theme.colors.border};
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

const IconBtn = styled.button`
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: transparent;
  color: ${({ theme }) => theme.colors.text.secondary};
  font-size: 18px;
  transition: all ${({ theme }) => theme.transition};

  &:hover {
    background: ${({ theme }) => theme.colors.bg.hover};
    color: ${({ theme }) => theme.colors.text.primary};
  }
`;

export default function TopBar({ conversation, onAudioCall, onVideoCall }: TopBarProps) {
  const { isDark, toggleTheme } = useTheme();

  const showCallButtons = conversation && !conversation.isGroup;

  return (
    <Wrapper>
      <Left>
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
                size={36}
                online={conversation.contact?.online}
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
                  <StatusDot online={conversation.contact?.online || false} />
                  {' '}{conversation.contact?.online ? 'Online' : 'Offline'}
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

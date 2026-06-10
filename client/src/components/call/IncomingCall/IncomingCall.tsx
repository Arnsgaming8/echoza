import styled, { keyframes } from 'styled-components';
import { Avatar } from '../../common';
import { FiPhone, FiPhoneOff } from 'react-icons/fi';

const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(58, 123, 255, 0.6); }
  70% { box-shadow: 0 0 0 30px rgba(58, 123, 255, 0); }
  100% { box-shadow: 0 0 0 0 rgba(58, 123, 255, 0); }
`;

const ring = keyframes`
  0% { transform: rotate(0deg); }
  10% { transform: rotate(15deg); }
  20% { transform: rotate(-15deg); }
  30% { transform: rotate(15deg); }
  40% { transform: rotate(-15deg); }
  50% { transform: rotate(0deg); }
  100% { transform: rotate(0deg); }
`;

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
  animation: fadeIn 0.2s ease;
`;

const Card = styled.div`
  background: ${({ theme }) => theme.colors.bg.main};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.xl};
  padding: ${({ theme }) => theme.spacing.xl} ${({ theme }) => theme.spacing.xxl};
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.lg};
  box-shadow: ${({ theme }) => theme.shadow.glow};
  min-width: 300px;
`;

const RingIcon = styled.div`
  animation: ${ring} 1s ease infinite;
  font-size: 48px;
  color: ${({ theme }) => theme.colors.primary.echoBlue};
`;

const AvatarWrapper = styled.div`
  animation: ${pulse} 1.5s ease infinite;
  border-radius: 50%;
`;

const CallerName = styled.h3`
  margin: 0;
  font-size: ${({ theme }) => theme.font.size.xl};
  color: ${({ theme }) => theme.colors.text.primary};
`;

const CallType = styled.p`
  margin: 0;
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const Actions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.xl};
`;

const AcceptBtn = styled.button`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #22c55e;
  color: white;
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all ${({ theme }) => theme.transition};

  &:hover {
    transform: scale(1.1);
    background: #16a34a;
  }
`;

const DeclineBtn = styled.button`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #ef4444;
  color: white;
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all ${({ theme }) => theme.transition};

  &:hover {
    transform: scale(1.1);
    background: #dc2626;
  }
`;

interface IncomingCallProps {
  caller: { id: string; username: string; avatar: string };
  type: 'audio' | 'video';
  onAccept: () => void;
  onDecline: () => void;
}

export default function IncomingCall({ caller, type, onAccept, onDecline }: IncomingCallProps) {
  return (
    <Overlay>
      <Card>
        <AvatarWrapper>
          <Avatar username={caller.username} src={caller.avatar} size={80} />
        </AvatarWrapper>
        <RingIcon>
          {type === 'audio' ? <FiPhone /> : <FiPhone />}
        </RingIcon>
        <CallerName>{caller.username}</CallerName>
        <CallType>Incoming {type} call...</CallType>
        <Actions>
          <DeclineBtn onClick={onDecline} title="Decline">
            <FiPhoneOff />
          </DeclineBtn>
          <AcceptBtn onClick={onAccept} title="Accept">
            <FiPhone />
          </AcceptBtn>
        </Actions>
      </Card>
    </Overlay>
  );
}

import { useState, useEffect, useRef } from 'react';
import styled, { keyframes } from 'styled-components';
import { Avatar } from '../../common';
import { Socket } from 'socket.io-client';
import { FiMic, FiMicOff, FiVolume2, FiX } from 'react-icons/fi';

const bgAnim = keyframes`
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
`;

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: ${({ theme }) => theme.colors.bg.main};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.3s ease;
`;

const GradientBg = styled.div`
  position: absolute;
  inset: 0;
  background: linear-gradient(-45deg, #3A7BFF, #0F1A2F, #4FF3C2, #1C2333);
  background-size: 400% 400%;
  animation: ${bgAnim} 8s ease infinite;
  opacity: 0.3;
  pointer-events: none;
`;

const Content = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xl};
`;

const Timer = styled.div`
  font-size: ${({ theme }) => theme.font.size.xxl};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.colors.text.primary};
  font-variant-numeric: tabular-nums;
`;

const CallingText = styled.p`
  font-size: ${({ theme }) => theme.font.size.lg};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const Controls = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.lg};
`;

const ControlBtn = styled.button<{ $danger?: boolean; $active?: boolean }>`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  transition: all ${({ theme }) => theme.transition};
  background: ${({ $danger, $active, theme }) =>
    $danger ? theme.colors.danger : $active ? theme.colors.primary.echoBlue : theme.colors.bg.hover};
  color: ${({ $danger, $active }) =>
    $danger || $active ? 'white' : 'inherit'};

  &:hover {
    transform: scale(1.05);
  }
`;

interface AudioCallUIProps {
  contact: { id: string; username: string; avatar: string };
  onEnd: () => void;
  socket: Socket | null;
}

export default function AudioCallUI({ contact, onEnd, socket }: AudioCallUIProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [isCalling] = useState<boolean>(true);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setSeconds(s => s + 1);
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (socket && contact) {
      socket.emit('call:offer', { receiverId: contact.id, type: 'audio', offer: {} });
      return () => {
        socket.emit('call:end', { receiverId: contact.id });
      };
    }
  }, [socket, contact]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  return (
    <Overlay>
      <GradientBg />
      <Content>
        <Avatar username={contact.username} size={100} />
        <CallingText>{isCalling ? `Calling ${contact.username}...` : contact.username}</CallingText>
        <Timer>{formatTime(seconds)}</Timer>
        <Controls>
          <ControlBtn $active={!isMuted} onClick={() => setIsMuted(!isMuted)}>
            {isMuted ? <FiMicOff /> : <FiMic />}
          </ControlBtn>
          <ControlBtn $active>
            <FiVolume2 />
          </ControlBtn>
          <ControlBtn $danger onClick={onEnd}>
            <FiX size={28} />
          </ControlBtn>
        </Controls>
      </Content>
    </Overlay>
  );
}

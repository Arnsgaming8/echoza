import { useState, useEffect, useRef } from 'react';
import styled, { keyframes } from 'styled-components';
import { Avatar } from '../../common';
import { Socket } from 'socket.io-client';
import { FiMic, FiMicOff, FiVolume2, FiX } from 'react-icons/fi';

const METERED_DOMAIN = 'vanra.metered.live';

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
  padding: ${({ theme }) => theme.spacing.md};

  @media (max-width: 768px) {
    gap: ${({ theme }) => theme.spacing.lg};
  }
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

  @media (max-width: 768px) {
    width: 48px;
    height: 48px;
    font-size: 18px;
  }
`;

interface AudioCallUIProps {
  contact: { id: string; username: string; avatar: string };
  onEnd: () => void;
  socket: Socket | null;
  user: { id: string; username: string } | null;
  roomName: string;
}

export default function AudioCallUI({ contact, onEnd, socket, user, roomName }: AudioCallUIProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [connected, setConnected] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const meetingRef = useRef<MeteredMeeting | null>(null);
  const CALL_TIMEOUT = 120000;

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setSeconds(s => s + 1);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!user || !roomName || !window.Metered) return;

    const meeting = new window.Metered.Meeting();
    meetingRef.current = meeting;

    meeting.on('remoteTrackStarted', () => {
      console.log('[Metered] remoteTrackStarted');
      setConnected(true);
    });

    meeting.on('participantJoined', (p: any) => {
      console.log('[Metered] participantJoined:', p?.name);
      setConnected(true);
    });

    meeting.on('participantLeft', (p: any) => {
      console.log('[Metered] participantLeft:', p?.name);
      onEnd();
    });

    meeting.join({ roomURL: `${METERED_DOMAIN}/${roomName}`, name: user.username }).then(() => {
      console.log('[Metered] join resolved - starting audio');
      try { meeting.startAudio(); } catch (e) { console.warn('startAudio threw:', e); }
    }).catch((e: any) => console.warn('Metered join failed:', e));

    return () => {
      meeting.leaveMeeting();
    };
  }, []);

  const ringingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    ringingRef.current = setTimeout(() => {
      handleEnd();
    }, CALL_TIMEOUT);
    return () => { if (ringingRef.current) clearTimeout(ringingRef.current); };
  }, []);

  useEffect(() => {
    if (connected && ringingRef.current) {
      clearTimeout(ringingRef.current);
      ringingRef.current = null;
    }
  }, [connected]);

  const toggleMute = () => {
    const m = meetingRef.current;
    if (!m) return;
    if (isMuted) {
      m.startAudio().catch(console.warn);
    } else {
      m.stopAudio().catch(console.warn);
    }
    setIsMuted(!isMuted);
  };

  const handleEnd = () => {
    if (socket && contact) {
      socket.emit('call:end', { receiverId: contact.id });
    }
    onEnd();
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  return (
    <Overlay>
      <GradientBg />
      <Content>
        <Avatar username={contact.username} src={contact.avatar} size={100} />
        <CallingText>{connected ? contact.username : `Calling ${contact.username}...`}</CallingText>
        <Timer>{formatTime(seconds)}</Timer>
        <Controls>
          <ControlBtn $active={!isMuted} onClick={toggleMute}>
            {isMuted ? <FiMicOff /> : <FiMic />}
          </ControlBtn>
          <ControlBtn $active>
            <FiVolume2 />
          </ControlBtn>
          <ControlBtn $danger onClick={handleEnd}>
            <FiX size={28} />
          </ControlBtn>
        </Controls>
      </Content>
    </Overlay>
  );
}

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

const slideUp = keyframes`
  from { transform: translateY(30px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
`;

const wave = keyframes`
  0%, 100% { height: 6px; }
  50% { height: 40px; }
`;

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: linear-gradient(-45deg, #1a1a2e, #16213e, #0f0f1a, #1a1a2e);
  background-size: 400% 400%;
  animation: ${bgAnim} 12s ease infinite;
  display: flex;
  flex-direction: column;
  z-index: 1000;
`;

const TopArea = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 80px;
  gap: 8px;
`;

const Timer = styled.div`
  font-size: 52px;
  font-weight: 300;
  color: #fff;
  font-variant-numeric: tabular-nums;
  letter-spacing: 2px;
`;

const CallingText = styled.p`
  font-size: 20px;
  color: rgba(255,255,255,0.7);
  font-weight: 400;
  margin: 0;
`;

const ConnectionBadge = styled.div`
  font-size: 14px;
  color: rgba(255,255,255,0.5);
  font-weight: 400;
  background: rgba(255,255,255,0.06);
  padding: 4px 16px;
  border-radius: 20px;
`;

const CenterContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
`;

const WaveformContainer = styled.div<{ $show: boolean }>`
  display: none;
  align-items: center;
  gap: 4px;
  height: 50px;

  ${({ $show }) => $show && 'display: flex;'}
`;

const WaveBar = styled.div<{ $i: number }>`
  width: 4px;
  background: rgba(255,255,255,0.6);
  border-radius: 2px;
  animation: ${wave} 0.8s ease infinite;
  animation-delay: ${({ $i }) => $i * 0.1}s;
`;

const Controls = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 28px;
  padding: 30px 0 60px;
  animation: ${slideUp} 0.4s ease;
`;

const ControlBtn = styled.button<{ $danger?: boolean; $active?: boolean }>`
  width: 60px;
  height: 60px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  transition: all 0.15s ease;
  background: ${({ $danger, $active }) =>
    $danger ? '#ff3b30' : $active ? '#34c759' : 'rgba(255,255,255,0.12)'};
  color: white;

  &:hover {
    transform: scale(1.05);
  }

  &:active {
    transform: scale(0.92);
  }
`;

const ControlLabel = styled.span`
  font-size: 11px;
  color: rgba(255,255,255,0.6);
  text-align: center;
  margin-top: 4px;
  display: block;
`;

const ControlGroup = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const EndCallBtn = styled.button`
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: #ff3b30;
  color: white;
  font-size: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s ease, background 0.15s ease;
  box-shadow: 0 4px 24px rgba(255, 59, 48, 0.4);

  &:hover {
    transform: scale(1.08);
    background: #d62d20;
  }

  &:active {
    transform: scale(0.92);
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
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [connected, setConnected] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const meetingRef = useRef<MeteredMeeting | null>(null);
  const ringingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const toggleSpeaker = () => {
    const m = meetingRef.current;
    if (!m) return;
    setIsSpeaker(!isSpeaker);
    // Metered manages audio output routing; speaker toggle via SDK/enumerate
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
      <TopArea>
        <ConnectionBadge>
          {connected ? 'Connected' : 'Ringing...'}
        </ConnectionBadge>
      </TopArea>

      <CenterContent>
        <Avatar username={contact.username} src={contact.avatar} size={120} />
        <CallingText>{connected ? contact.username : `Calling ${contact.username}...`}</CallingText>
        <Timer>{formatTime(seconds)}</Timer>
        <WaveformContainer $show={connected}>
          {Array.from({ length: 5 }).map((_, i) => (
            <WaveBar key={i} $i={i} />
          ))}
        </WaveformContainer>
      </CenterContent>

      <Controls>
        <ControlGroup>
          <ControlBtn $active={!isMuted} onClick={toggleMute}>
            {isMuted ? <FiMicOff /> : <FiMic />}
          </ControlBtn>
          <ControlLabel>{isMuted ? 'Unmute' : 'Mute'}</ControlLabel>
        </ControlGroup>
        <ControlGroup>
          <ControlBtn $active={isSpeaker} onClick={toggleSpeaker}>
            <FiVolume2 />
          </ControlBtn>
          <ControlLabel>Speaker</ControlLabel>
        </ControlGroup>
        <ControlGroup>
          <EndCallBtn onClick={handleEnd}>
            <FiX />
          </EndCallBtn>
          <ControlLabel>End</ControlLabel>
        </ControlGroup>
      </Controls>
    </Overlay>
  );
}

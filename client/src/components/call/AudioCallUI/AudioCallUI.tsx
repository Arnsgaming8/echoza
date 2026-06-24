import { useState, useRef, useEffect } from 'react';
import styled, { keyframes } from 'styled-components';
import { Socket } from 'socket.io-client';
import { FiMic, FiMicOff, FiVolume2, FiX, FiSettings } from 'react-icons/fi';
import { useCall } from '../../../utils/useCall';

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const wave = keyframes`
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(0.4); }
`;

const pulse = keyframes`
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
`;

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: linear-gradient(160deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  animation: ${fadeIn} 0.3s ease;
  gap: 32px;
`;

const AvatarRing = styled.div<{ $connected: boolean }>`
  width: 160px;
  height: 160px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ${({ $connected }) => $connected ? 'none' : pulse} 1.5s ease infinite;
  box-shadow: 0 0 60px rgba(79, 70, 229, 0.3);
`;

const AvatarCircle = styled.div`
  width: 148px;
  height: 148px;
  border-radius: 50%;
  background: #2d2d44;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-size: 56px;
  font-weight: 600;
  color: white;
`;

const AvatarImg = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const ContactName = styled.h2`
  color: white;
  font-size: 28px;
  font-weight: 600;
  margin: 0;
`;

const StatusText = styled.p`
  color: rgba(255,255,255,0.5);
  font-size: 15px;
  font-weight: 400;
`;

const TimerText = styled.p`
  color: rgba(255,255,255,0.6);
  font-size: 17px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  margin: -16px 0 0;
`;

const ControlsRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  margin-top: 8px;
`;

const CtrlBtn = styled.button<{ $active?: boolean; $danger?: boolean; $bg?: string }>`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  transition: all 0.15s ease;
  background: ${({ $danger, $active, $bg }) =>
    $bg ? $bg :
    $danger ? '#ff3b30' :
    $active ? '#34c759' :
    'rgba(255,255,255,0.12)'};
  color: white;
  &:hover { transform: scale(1.08); }
  &:active { transform: scale(0.92); }
`;

const EndCallBtn = styled.button`
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: #ff3b30;
  color: white;
  font-size: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  box-shadow: 0 4px 20px rgba(255, 59, 48, 0.4);
  &:hover { transform: scale(1.08); background: #d62d20; }
  &:active { transform: scale(0.92); }
`;

const WaveformContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  height: 40px;
`;

const WaveBar = styled.div<{ $delay: number; $height: number }>`
  width: 4px;
  height: ${({ $height }) => $height}px;
  background: rgba(255,255,255,0.5);
  border-radius: 4px;
  animation: ${wave} 0.6s ease ${({ $delay }) => $delay}s infinite;
`;

const CallingTimer = styled.p`
  color: rgba(255,255,255,0.6);
  font-size: 18px;
  font-weight: 300;
`;

const SettingsPanel = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 300px;
  background: rgba(30,30,40,0.95);
  backdrop-filter: blur(20px);
  border-radius: 16px;
  padding: 20px;
  z-index: 20;
  box-shadow: 0 8px 40px rgba(0,0,0,0.5);
`;

const SettingsTitle = styled.h3`
  color: white;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
`;

const CloseBtn = styled.button`
  position: absolute;
  top: 12px;
  right: 12px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: rgba(255,255,255,0.5);
  font-size: 16px;
  &:hover { background: rgba(255,255,255,0.1); color: white; }
`;

const bars = Array.from({ length: 20 }, (_, i) => ({
  delay: i * 0.08,
  height: 12 + Math.sin(i * 0.8) * 14 + Math.random() * 4,
}));

interface AudioCallUIProps {
  contact: { id: string; username: string; avatar: string };
  onEnd: () => void;
  socket: Socket | null;
  user: { id: string; username: string } | null;
  direction: 'outgoing' | 'incoming';
  initialSdp?: string;
}

export default function AudioCallUI({ contact, onEnd, socket, user, direction, initialSdp }: AudioCallUIProps) {
  const {
    remoteStream, isMuted, connected, seconds,
    toggleMute, handleEnd, formatTime,
  } = useCall({ socket, contact, user, direction, initialSdp, type: 'audio', onEnd });

  const audioRef = useRef<HTMLAudioElement>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (audioRef.current && remoteStream) audioRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  return (
    <Overlay>
      <audio ref={audioRef} autoPlay />
      <AvatarRing $connected={connected}>
        <AvatarCircle>
          {contact.avatar ? (
            <AvatarImg src={contact.avatar} alt={contact.username} />
          ) : (
            contact.username[0].toUpperCase()
          )}
        </AvatarCircle>
      </AvatarRing>

      <ContactName>{contact.username}</ContactName>

      {!connected ? (
        <>
          <StatusText>Calling...</StatusText>
          <CallingTimer>{formatTime(seconds)}</CallingTimer>
        </>
      ) : (
        <>
          <TimerText>{formatTime(seconds)}</TimerText>
          <WaveformContainer>
            {bars.map((bar, i) => (
              <WaveBar key={i} $delay={bar.delay} $height={bar.height} />
            ))}
          </WaveformContainer>
        </>
      )}

      <ControlsRow>
        <CtrlBtn $active={!isMuted} onClick={toggleMute}>
          {isMuted ? <FiMicOff /> : <FiMic />}
        </CtrlBtn>
        <CtrlBtn onClick={() => setShowSettings(true)}>
          <FiSettings />
        </CtrlBtn>
        <CtrlBtn $bg="rgba(255,255,255,0.12)">
          <FiVolume2 />
        </CtrlBtn>
      </ControlsRow>

      <EndCallBtn onClick={handleEnd}>
        <FiX />
      </EndCallBtn>

      {showSettings && (
        <SettingsPanel onClick={e => e.stopPropagation()}>
          <CloseBtn onClick={() => setShowSettings(false)}><FiX /></CloseBtn>
          <SettingsTitle>Audio Settings</SettingsTitle>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Audio device selection is handled by your browser.</p>
        </SettingsPanel>
      )}
    </Overlay>
  );
}

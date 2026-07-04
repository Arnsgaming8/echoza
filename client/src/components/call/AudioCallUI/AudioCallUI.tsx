import { useState, useRef, useEffect, useCallback } from 'react';
import styled, { keyframes, css } from 'styled-components';
import { Socket } from 'socket.io-client';
import { FiMic, FiMicOff, FiVolume2, FiX, FiSettings, FiChevronDown } from 'react-icons/fi';
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
  position: relative;
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

const ringExpand = keyframes`
  from { transform: scale(1); opacity: 0.6; }
  to { transform: scale(1.8); opacity: 0; }
`;

const RingPulse = styled.div<{ $index: number; $active: boolean; $level: number }>`
  position: absolute;
  inset: -${({ $index }) => $index * 6}px;
  border-radius: 50%;
  border: 2px solid rgba(79, 70, 229, 0.5);
  animation: ${({ $active, $level }) => $active && $level > 0.05
    ? css`${ringExpand} ${Math.max(0.4, 1 - $level * 0.6)}s ease-out infinite`
    : 'none'};
  animation-delay: ${({ $index }) => $index * 0.15}s;
  pointer-events: none;
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

const BottomContent = styled.div`
  position: fixed;
  bottom: 80px;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  animation: ${fadeIn} 0.3s ease;
`;

const AvatarBottom = styled.div`
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: #2d2d44;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-size: 28px;
  font-weight: 600;
  color: white;
  box-shadow: 0 2px 16px rgba(0,0,0,0.3);
`;

const AvatarImgBottom = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const MissedText = styled.p`
  color: rgba(255,255,255,0.7);
  font-size: 16px;
  font-weight: 400;
  margin: 0;
  text-align: center;
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

const SettingRow = styled.div`
  margin-bottom: 14px;
`;

const SettingLabel = styled.label`
  display: block;
  color: rgba(255,255,255,0.6);
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const Select = styled.select`
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.15);
  background: rgba(255,255,255,0.08);
  color: white;
  font-size: 13px;
  outline: none;
  cursor: pointer;
  &:focus { border-color: ${({ theme }) => theme.colors.primary.echoBlue}; }
  option { background: #222; color: white; }
`;

const VolumeSlider = styled.input`
  width: 100%;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  border-radius: 2px;
  background: rgba(255,255,255,0.2);
  outline: none;
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: ${({ theme }) => theme.colors.primary.echoBlue};
    cursor: pointer;
  }
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
    remoteStream, isMuted, audioLevel, connected, callStatus, seconds,
    toggleMute, switchAudioDevice, resumePlayback, handleEnd, formatTime,
  } = useCall({ socket, contact, user, direction, initialSdp, type: 'audio', onEnd });

  const audioRef = useRef<HTMLAudioElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('');
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    resumePlayback();
  }, [resumePlayback]);

  useEffect(() => {
    resumePlayback();
  }, [resumePlayback]);

  useEffect(() => {
    if (audioRef.current && remoteStream) {
      audioRef.current.srcObject = remoteStream;
      audioRef.current.play().catch(() => {});
    }
  }, [remoteStream]);

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(devices => {
      setAudioInputs(devices.filter(d => d.kind === 'audioinput'));
      setAudioOutputs(devices.filter(d => d.kind === 'audiooutput'));
      const savedMic = localStorage.getItem('echoza-mic');
      const savedSpeaker = localStorage.getItem('echoza-speaker');
      if (savedMic && devices.some(d => d.deviceId === savedMic)) setSelectedMic(savedMic);
      if (savedSpeaker && devices.some(d => d.deviceId === savedSpeaker)) setSelectedSpeaker(savedSpeaker);
    });
  }, []);

  const handleMicChange = useCallback((deviceId: string) => {
    setSelectedMic(deviceId);
    localStorage.setItem('echoza-mic', deviceId);
    switchAudioDevice(deviceId);
  }, [switchAudioDevice]);

  const handleSpeakerChange = useCallback((deviceId: string) => {
    setSelectedSpeaker(deviceId);
    localStorage.setItem('echoza-speaker', deviceId);
    if (audioRef.current && 'setSinkId' in audioRef.current) {
      (audioRef.current as any).setSinkId(deviceId).catch(() => {});
    }
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  }, []);

  const ended = callStatus === 'missed' || callStatus === 'declined';

  return (
    <Overlay>
      <audio ref={audioRef} autoPlay playsInline />
      {!ended && (
        <AvatarRing $connected={connected}>
          {(connected || callStatus === 'ringing') && [0, 1, 2].map(i => (
            <RingPulse key={i} $index={i} $active={connected || callStatus === 'ringing'} $level={callStatus === 'ringing' ? 0.5 : audioLevel} />
          ))}
          <AvatarCircle>
            {contact.avatar ? (
              <AvatarImg src={contact.avatar} alt={contact.username} />
            ) : (
              contact.username[0].toUpperCase()
            )}
          </AvatarCircle>
        </AvatarRing>
      )}

      {!ended && <ContactName>{contact.username}</ContactName>}

      {callStatus === 'ringing' ? (
        <>
          <StatusText>Calling...</StatusText>
          <CallingTimer>{formatTime(seconds)}</CallingTimer>
        </>
      ) : callStatus === 'missed' ? (
        <BottomContent>
          <AvatarBottom>
            {contact.avatar ? (
              <AvatarImgBottom src={contact.avatar} alt={contact.username} />
            ) : (
              contact.username[0].toUpperCase()
            )}
          </AvatarBottom>
          <MissedText>{contact.username} is not available</MissedText>
        </BottomContent>
      ) : callStatus === 'declined' ? (
        <BottomContent>
          <AvatarBottom>
            {contact.avatar ? (
              <AvatarImgBottom src={contact.avatar} alt={contact.username} />
            ) : (
              contact.username[0].toUpperCase()
            )}
          </AvatarBottom>
          <MissedText>{contact.username} declined</MissedText>
        </BottomContent>
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

      {!ended && (
        <>
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
        </>
      )}

      {showSettings && (
        <SettingsPanel onClick={e => e.stopPropagation()}>
          <CloseBtn onClick={() => setShowSettings(false)}><FiX /></CloseBtn>
          <SettingsTitle>Audio Settings</SettingsTitle>
          <SettingRow>
            <SettingLabel>Microphone</SettingLabel>
            <Select value={selectedMic} onChange={e => handleMicChange(e.target.value)}>
              {audioInputs.map(d => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 8)}`}</option>
              ))}
            </Select>
          </SettingRow>
          <SettingRow>
            <SettingLabel>Speaker</SettingLabel>
            <Select value={selectedSpeaker} onChange={e => handleSpeakerChange(e.target.value)}>
              {audioOutputs.map(d => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${d.deviceId.slice(0, 8)}`}</option>
              ))}
            </Select>
          </SettingRow>
          <SettingRow>
            <SettingLabel>Volume</SettingLabel>
            <VolumeSlider type="range" min="0" max="1" step="0.05" value={volume} onChange={handleVolumeChange} />
          </SettingRow>
        </SettingsPanel>
      )}
    </Overlay>
  );
}

import { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { Socket } from 'socket.io-client';
import { FiMic, FiMicOff, FiCamera, FiCameraOff, FiMonitor, FiX, FiSettings } from 'react-icons/fi';

const METERED_DOMAIN = 'vanra.metered.live';

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: #000;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  animation: fadeIn 0.3s ease;
`;

const RemoteVideo = styled.video`
  flex: 1;
  width: 100%;
  object-fit: contain;
  background: #1a1a1a;
`;

const LocalVideo = styled.video`
  position: absolute;
  bottom: 100px;
  right: 20px;
  width: 200px;
  height: 140px;
  border-radius: ${({ theme }) => theme.radius.md};
  object-fit: contain;
  background: #333;
  border: 2px solid rgba(255,255,255,0.2);
  box-shadow: ${({ theme }) => theme.shadow.lg};
  cursor: grab;
  transform: scaleX(-1);

  @media (max-width: 768px) {
    width: 120px;
    height: 90px;
  }
`;

const Controls = styled.div`
  position: absolute;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.lg};
  padding: ${({ theme }) => theme.spacing.md} ${({ theme }) => theme.spacing.lg};
  background: rgba(0, 0, 0, 0.6);
  border-radius: ${({ theme }) => theme.radius.xl};
  backdrop-filter: blur(10px);
`;

const ControlBtn = styled.button<{ $danger?: boolean; $active?: boolean }>`
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  transition: all ${({ theme }) => theme.transition};
  background: ${({ $danger, $active }) =>
    $danger ? '#FF3B5C' : $active ? '#3A7BFF' : 'rgba(255,255,255,0.1)'};
  color: white;

  &:hover {
    transform: scale(1.05);
    background: ${({ $danger }) =>
      $danger ? '#FF3B5C' : 'rgba(255,255,255,0.2)'};
  }
`;

const ContactLabel = styled.div`
  position: absolute;
  top: 40px;
  left: 50%;
  transform: translateX(-50%);
  color: white;
  font-size: ${({ theme }) => theme.font.size.lg};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  text-shadow: 0 2px 8px rgba(0,0,0,0.5);
`;

const SettingsPanel = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 300px;
  background: #222;
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: ${({ theme }) => theme.spacing.lg};
  z-index: 10;
  box-shadow: ${({ theme }) => theme.shadow.lg};
`;

const SettingsTitle = styled.h3`
  color: white;
  font-size: ${({ theme }) => theme.font.size.md};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const SettingsRow = styled.div`
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const SettingsLabel = styled.label`
  display: block;
  color: rgba(255,255,255,0.7);
  font-size: ${({ theme }) => theme.font.size.xs};
  margin-bottom: 4px;
`;

const SettingsSelect = styled.select`
  width: 100%;
  padding: 8px 10px;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: #333;
  color: white;
  border: 1px solid rgba(255,255,255,0.1);
  font-size: ${({ theme }) => theme.font.size.sm};
`;

const SettingsClose = styled.button`
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: rgba(255,255,255,0.5);
  font-size: 16px;

  &:hover {
    background: rgba(255,255,255,0.1);
    color: white;
  }
`;

interface VideoCallUIProps {
  contact: { id: string; username: string; avatar: string };
  onEnd: () => void;
  socket: Socket | null;
  user: { id: string; username: string } | null;
  roomName: string;
}

export default function VideoCallUI({ contact, onEnd, socket, user, roomName }: VideoCallUIProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [connected, setConnected] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedInput, setSelectedInput] = useState('');
  const [selectedOutput, setSelectedOutput] = useState('');
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const meetingRef = useRef<MeteredMeeting | null>(null);
  const CALL_TIMEOUT = 120000;

  useEffect(() => {
    if (!user || !roomName || !window.Metered) return;

    const meeting = new window.Metered.Meeting();
    meetingRef.current = meeting;

    meeting.on('localTrackStarted', (item: any) => {
      if (item.type === 'video' && localVideoRef.current) {
        localVideoRef.current.srcObject = new MediaStream([item.track]);
      }
    });

    meeting.on('remoteTrackStarted', (item: any) => {
      setConnected(true);
      if (item.type === 'video' && remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = new MediaStream([item.track]);
      }
    });

    meeting.on('participantJoined', () => {
      setConnected(true);
    });

    meeting.on('participantLeft', () => {
      onEnd();
    });

    meeting.join({ roomURL: `${METERED_DOMAIN}/${roomName}`, name: user.username }).then(() => {
      meeting.startVideo().catch((e: any) => console.warn('startVideo failed:', e));
      meeting.startAudio().catch((e: any) => console.warn('startAudio failed:', e));
    }).catch((e: any) => console.warn('Metered join failed:', e));

    return () => {
      meeting.leaveMeeting();
    };
  }, []);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timeoutRef.current = setTimeout(() => {
      if (socket && contact) {
        socket.emit('call:end', { receiverId: contact.id });
      }
      onEnd();
    }, CALL_TIMEOUT);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, []);

  useEffect(() => {
    if (connected && timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
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

  const toggleCamera = () => {
    const m = meetingRef.current;
    if (!m) return;
    if (isCameraOn) {
      m.stopVideo().catch(console.warn);
    } else {
      m.startVideo().catch(console.warn);
    }
    setIsCameraOn(!isCameraOn);
  };

  const handleScreenShare = async () => {
    const m = meetingRef.current;
    if (!m) return;
    try {
      await m.startScreenShare();
    } catch {
      console.warn('Screen share cancelled');
    }
  };

  const handleEnd = () => {
    if (socket && contact) {
      socket.emit('call:end', { receiverId: contact.id });
    }
    onEnd();
  };

  const openSettings = async () => {
    setShowSettings(true);
    const m = meetingRef.current;
    if (!m) return;
    try {
      const inputs = await m.listAudioInputDevices();
      const outputs = await m.listAudioOutputDevices();
      setAudioInputs(inputs);
      setAudioOutputs(outputs);
      if (!selectedInput && inputs.length) setSelectedInput(inputs[0].deviceId);
      if (!selectedOutput && outputs.length) setSelectedOutput(outputs[0].deviceId);
    } catch {}
  };

  const changeAudioInput = async (deviceId: string) => {
    setSelectedInput(deviceId);
    const m = meetingRef.current;
    if (!m) return;
    try {
      await m.chooseAudioInputDevice(deviceId);
    } catch {}
  };

  const changeAudioOutput = (deviceId: string) => {
    setSelectedOutput(deviceId);
    const m = meetingRef.current;
    if (!m) return;
    m.chooseAudioOutputDevice(deviceId).catch(() => {});
  };

  return (
    <Overlay>
      <RemoteVideo ref={remoteVideoRef} autoPlay playsInline />
      {isCameraOn && <LocalVideo ref={localVideoRef} autoPlay playsInline muted />}
      <ContactLabel>{connected ? contact.username : `Calling ${contact.username}...`}</ContactLabel>

      {showSettings && (
        <SettingsPanel>
          <SettingsClose onClick={() => setShowSettings(false)}>
            <FiX />
          </SettingsClose>
          <SettingsTitle>Audio Settings</SettingsTitle>
          <SettingsRow>
            <SettingsLabel>Microphone</SettingsLabel>
            <SettingsSelect value={selectedInput} onChange={e => changeAudioInput(e.target.value)}>
              {audioInputs.map(d => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${d.deviceId.slice(0, 8)}`}</option>
              ))}
            </SettingsSelect>
          </SettingsRow>
          <SettingsRow>
            <SettingsLabel>Speaker</SettingsLabel>
            <SettingsSelect value={selectedOutput} onChange={e => changeAudioOutput(e.target.value)}>
              {audioOutputs.map(d => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${d.deviceId.slice(0, 8)}`}</option>
              ))}
            </SettingsSelect>
          </SettingsRow>
        </SettingsPanel>
      )}

      <Controls>
        <ControlBtn $active={!isMuted} onClick={toggleMute}>
          {isMuted ? <FiMicOff /> : <FiMic />}
        </ControlBtn>
        <ControlBtn $active={isCameraOn} onClick={toggleCamera}>
          {isCameraOn ? <FiCamera /> : <FiCameraOff />}
        </ControlBtn>
        <ControlBtn $active onClick={handleScreenShare}>
          <FiMonitor />
        </ControlBtn>
        <ControlBtn $active={showSettings} onClick={openSettings}>
          <FiSettings />
        </ControlBtn>
        <ControlBtn $danger onClick={handleEnd}>
          <FiX size={24} />
        </ControlBtn>
      </Controls>
    </Overlay>
  );
}

import { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { Socket } from 'socket.io-client';
import { FiMic, FiMicOff, FiCamera, FiCameraOff, FiMonitor, FiX, FiSettings } from 'react-icons/fi';
import { getIceServers } from '../../../utils/iceConfig';

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
  isInitiator: boolean;
  remoteOffer: any;
}

export default function VideoCallUI({ contact, onEnd, socket, user, isInitiator, remoteOffer }: VideoCallUIProps) {
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
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const CALL_TIMEOUT = 120000;

  useEffect(() => {
    if (!socket || !user) return;

    const receiverId = contact.id;
    let pc: RTCPeerConnection | null = null;
    let localStream: MediaStream | null = null;
    const candidateQueue: RTCIceCandidateInit[] = [];

    const handleAnswer = ({ from, answer }: { from: string; answer: any }) => {
      if (from === receiverId && pc && pc.signalingState === 'have-local-offer') {
        pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    };

    const handleIceCandidate = ({ from, candidate }: { from: string; candidate: any }) => {
      if (from !== receiverId || !candidate) return;
      console.log('Received remote ICE candidate:', candidate.type || candidate.candidate?.substring(0, 60));
      if (pc && pc.remoteDescription) {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      } else {
        candidateQueue.push(candidate);
      }
    };

    if (isInitiator) {
      socket.on('call:answer', handleAnswer);
    }
    socket.on('call:ice-candidate', handleIceCandidate);

    async function setupCall() {
      try {
        try {
          localStream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 640, max: 854 },
              height: { ideal: 480, max: 480 },
              frameRate: { ideal: 24, max: 30 },
            },
            audio: true,
          });
        } catch (mediaErr) {
          console.warn('Video + audio getUserMedia failed, trying audio only:', mediaErr);
          localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          setIsCameraOn(false);
        }
        localStreamRef.current = localStream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }

        const iceServers = await getIceServers();
        pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'relay' });
        pcRef.current = pc;

        localStream.getTracks().forEach(track => pc!.addTrack(track, localStream!));

        const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (videoSender) {
          videoSender.setParameters({
            ...videoSender.getParameters() as RTCRtpSendParameters,
            encodings: [{ maxBitrate: 500000 }],
          });
        }

        pc.onicecandidate = (e) => {
          if (e.candidate) {
            if (e.candidate.type === 'relay') console.log('TURN relay candidate:', e.candidate.candidate);
            if (socket) {
              socket.emit('call:ice-candidate', { receiverId, candidate: e.candidate.toJSON() });
            }
          }
        };

        pc.oniceconnectionstatechange = () => {
          console.log('ICE state:', pc?.iceConnectionState);
        };

        pc.onicegatheringstatechange = () => {
          console.log('ICE gathering state:', pc?.iceGatheringState);
        };

        pc.ontrack = (e) => {
          console.log('Remote track received');
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = e.streams[0];
            remoteVideoRef.current.play().catch(() => {});
            setConnected(true);
          }
        };

        if (isInitiator) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket!.emit('call:offer', { receiverId, type: 'video', offer: pc.localDescription!.toJSON() });
        } else if (remoteOffer) {
          await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket!.emit('call:answer', { receiverId, answer: pc.localDescription!.toJSON() });
        }

        while (candidateQueue.length) {
          const c = candidateQueue.shift()!;
          try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
        }
      } catch (err) {
        console.warn('Video call setup failed:', err);
      }
    }

    setupCall();

    return () => {
      if (localStream) localStream.getTracks().forEach(t => t.stop());
      if (pc) pc.close();
      socket.off('call:answer', handleAnswer);
      socket.off('call:ice-candidate', handleIceCandidate);
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
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
      setIsMuted(!isMuted);
    }
  };

  const toggleCamera = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
      setIsCameraOn(!isCameraOn);
    }
  };

  const handleScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
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
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioInputs(devices.filter(d => d.kind === 'audioinput'));
      setAudioOutputs(devices.filter(d => d.kind === 'audiooutput'));
      if (!selectedInput && devices.find(d => d.kind === 'audioinput')) {
        setSelectedInput(devices.find(d => d.kind === 'audioinput')!.deviceId);
      }
      if (!selectedOutput && devices.find(d => d.kind === 'audiooutput')) {
        setSelectedOutput(devices.find(d => d.kind === 'audiooutput')!.deviceId);
      }
    } catch {}
  };

  const changeAudioInput = async (deviceId: string) => {
    setSelectedInput(deviceId);
    if (!localStreamRef.current || !pcRef.current) return;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
      const newTrack = newStream.getAudioTracks()[0];
      const oldTrack = localStreamRef.current.getAudioTracks()[0];
      if (oldTrack) {
        localStreamRef.current.removeTrack(oldTrack);
        oldTrack.stop();
      }
      localStreamRef.current.addTrack(newTrack);
      const sender = pcRef.current.getSenders().find(s => s.track?.kind === 'audio');
      if (sender) await sender.replaceTrack(newTrack);
    } catch {}
  };

  const changeAudioOutput = (deviceId: string) => {
    setSelectedOutput(deviceId);
    if (remoteVideoRef.current && 'setSinkId' in remoteVideoRef.current) {
      (remoteVideoRef.current as any).setSinkId(deviceId).catch(() => {});
    }
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

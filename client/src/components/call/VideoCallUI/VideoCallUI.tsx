import { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { Socket } from 'socket.io-client';
import { FiMic, FiMicOff, FiCamera, FiCameraOff, FiMonitor, FiX } from 'react-icons/fi';
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
  object-fit: cover;
  background: #1a1a1a;
`;

const LocalVideo = styled.video`
  position: absolute;
  bottom: 100px;
  right: 20px;
  width: 200px;
  height: 140px;
  border-radius: ${({ theme }) => theme.radius.md};
  object-fit: cover;
  background: #333;
  border: 2px solid rgba(255,255,255,0.2);
  box-shadow: ${({ theme }) => theme.shadow.lg};
  cursor: grab;

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
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    if (!socket || !user) return;

    const receiverId = contact.id;
    let pc: RTCPeerConnection | null = null;
    let localStream: MediaStream | null = null;

    const handleAnswer = ({ from, answer }: { from: string; answer: any }) => {
      if (from === receiverId && pc && pc.signalingState === 'have-local-offer') {
        pc.setRemoteDescription(new RTCSessionDescription(answer));
        setConnected(true);
      }
    };

    const handleIceCandidate = ({ from, candidate }: { from: string; candidate: any }) => {
      if (from === receiverId && pc && pc.remoteDescription && candidate) {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      }
    };

    if (isInitiator) {
      socket.on('call:answer', handleAnswer);
    }
    socket.on('call:ice-candidate', handleIceCandidate);

    async function setupCall() {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = localStream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }

        const iceServers = await getIceServers();
        pc = new RTCPeerConnection({ iceServers });
        pcRef.current = pc;

        localStream.getTracks().forEach(track => pc!.addTrack(track, localStream!));

        pc.onicecandidate = (e) => {
          if (e.candidate && socket) {
            socket.emit('call:ice-candidate', { receiverId, candidate: e.candidate.toJSON() });
          }
        };

        pc.oniceconnectionstatechange = () => {
          console.log('ICE state:', pc?.iceConnectionState);
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

  return (
    <Overlay>
      <RemoteVideo ref={remoteVideoRef} autoPlay playsInline />
      <LocalVideo ref={localVideoRef} autoPlay playsInline muted />
      <ContactLabel>{connected ? contact.username : `Calling ${contact.username}...`}</ContactLabel>
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
        <ControlBtn $danger onClick={handleEnd}>
          <FiX size={24} />
        </ControlBtn>
      </Controls>
    </Overlay>
  );
}

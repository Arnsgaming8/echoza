import { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { Socket } from 'socket.io-client';
import { FiMic, FiMicOff, FiCamera, FiCameraOff, FiMonitor, FiX } from 'react-icons/fi';

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
}

export default function VideoCallUI({ contact, onEnd, socket }: VideoCallUIProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    async function startLocalStream() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch {
        console.warn('Could not access camera/microphone');
      }
    }

    startLocalStream();

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (socket && contact) {
      socket.emit('call:offer', { receiverId: contact.id, offer: {} });
      return () => {
        socket.emit('call:end', { receiverId: contact.id });
      };
    }
  }, [socket, contact]);

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => {
        t.enabled = !t.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleCamera = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(t => {
        t.enabled = !t.enabled;
      });
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

  return (
    <Overlay>
      <RemoteVideo ref={remoteVideoRef} autoPlay playsInline muted />
      <LocalVideo ref={localVideoRef} autoPlay playsInline muted />
      <ContactLabel>{contact.username}</ContactLabel>
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
        <ControlBtn $danger onClick={onEnd}>
          <FiX size={24} />
        </ControlBtn>
      </Controls>
    </Overlay>
  );
}

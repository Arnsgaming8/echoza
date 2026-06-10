import { useState, useEffect, useRef } from 'react';
import styled, { keyframes } from 'styled-components';
import { Avatar } from '../../common';
import { Socket } from 'socket.io-client';
import { FiMic, FiMicOff, FiVolume2, FiX } from 'react-icons/fi';
import { getIceServers } from '../../../utils/iceConfig';

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
  isInitiator: boolean;
  remoteOffer: any;
}

export default function AudioCallUI({ contact, onEnd, socket, user, isInitiator, remoteOffer }: AudioCallUIProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [connected, setConnected] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setSeconds(s => s + 1);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

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
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStreamRef.current = localStream;

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
          console.log('Remote audio track received');
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = e.streams[0];
            remoteAudioRef.current.play().catch(() => {});
            setConnected(true);
          }
        };

        if (isInitiator) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket!.emit('call:offer', { receiverId, type: 'audio', offer: pc.localDescription!.toJSON() });
        } else if (remoteOffer) {
          await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket!.emit('call:answer', { receiverId, answer: pc.localDescription!.toJSON() });
        }
      } catch (err) {
        console.warn('Audio call setup failed:', err);
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
      <audio ref={remoteAudioRef} autoPlay />
      <Content>
        <Avatar username={contact.username} size={100} />
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

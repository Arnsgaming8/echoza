import { useState, useRef, useCallback, useEffect } from 'react';
import styled, { keyframes } from 'styled-components';
import { Socket } from 'socket.io-client';
import { FiMic, FiMicOff, FiCamera, FiCameraOff, FiRotateCw, FiX, FiSettings } from 'react-icons/fi';
import { useCall } from '../../../utils/useCall';

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: #000;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  animation: ${fadeIn} 0.3s ease;
  touch-action: none;
`;

const RemoteVideo = styled.video`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #1a1a1a;
`;

const LocalVideo = styled.video<{ $x: number; $y: number }>`
  position: absolute;
  width: 160px;
  height: 220px;
  border-radius: 20px;
  object-fit: cover;
  background: #333;
  box-shadow: 0 4px 24px rgba(0,0,0,0.6);
  transform: scaleX(-1);
  cursor: grab;
  left: ${({ $x }) => $x}px;
  top: ${({ $y }) => $y}px;
  z-index: 5;
  border: 2px solid rgba(255,255,255,0.15);
  transition: left 0.2s ease, top 0.2s ease;

  &:active { cursor: grabbing; transition: none; }
`;

const TopStatusBar = styled.div<{ $visible: boolean }>`
  position: absolute;
  top: 0; left: 0; right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 52px 20px 20px;
  background: linear-gradient(180deg, rgba(0,0,0,0.5) 0%, transparent 100%);
  z-index: 10;
  opacity: ${({ $visible }) => $visible ? 1 : 0};
  transition: opacity 0.3s ease;
  pointer-events: ${({ $visible }) => $visible ? 'auto' : 'none'};
`;

const StatusPill = styled.div`
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(12px);
  border-radius: 24px;
  padding: 8px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
`;

const StatusName = styled.span`
  color: #fff;
  font-size: 16px;
  font-weight: 600;
`;

const StatusTimer = styled.span`
  color: rgba(255,255,255,0.8);
  font-size: 15px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
`;

const StatusDot = styled.span<{ $connected: boolean }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $connected }) => $connected ? '#34c759' : '#ff9f0a'};
  display: inline-block;
`;

const BottomControlsBar = styled.div<{ $visible: boolean }>`
  position: absolute;
  bottom: 0; left: 0; right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 20px 20px 48px;
  background: linear-gradient(0deg, rgba(0,0,0,0.6) 0%, transparent 100%);
  z-index: 10;
  opacity: ${({ $visible }) => $visible ? 1 : 0};
  transition: opacity 0.3s ease;
  pointer-events: ${({ $visible }) => $visible ? 'auto' : 'none'};
`;

const CtrlBtn = styled.button<{ $danger?: boolean; $active?: boolean; $bg?: string }>`
  width: 50px;
  height: 50px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  transition: all 0.15s ease;
  background: ${({ $danger, $active, $bg }) =>
    $bg ? $bg :
    $danger ? '#ff3b30' :
    $active ? '#34c759' :
    'rgba(255,255,255,0.15)'};
  color: white;
  &:hover { transform: scale(1.08); }
  &:active { transform: scale(0.92); }
`;

const EndCallBtn = styled.button`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #ff3b30;
  color: white;
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s ease;
  box-shadow: 0 4px 20px rgba(255, 59, 48, 0.4);
  &:hover { transform: scale(1.08); background: #d62d20; }
  &:active { transform: scale(0.92); }
`;

const CallingOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.7);
  z-index: 8;
  gap: 12px;
`;

const CallingText = styled.p`
  color: #fff;
  font-size: 22px;
  font-weight: 500;
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

const TapHint = styled.div`
  position: absolute;
  bottom: 120px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255,255,255,0.3);
  font-size: 13px;
  z-index: 9;
  pointer-events: none;
`;

type SnapCorner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
const CORNER_PADDING = 20;

function getCornerPos(corner: SnapCorner): { x: number; y: number } {
  const ww = window.innerWidth;
  const wh = window.innerHeight;
  switch (corner) {
    case 'bottom-right': return { x: ww - 180, y: wh - 260 };
    case 'bottom-left': return { x: CORNER_PADDING, y: wh - 260 };
    case 'top-right': return { x: ww - 180, y: 80 };
    case 'top-left': return { x: CORNER_PADDING, y: 80 };
  }
}

function nearestCorner(x: number, y: number): SnapCorner {
  const ww = window.innerWidth;
  const wh = window.innerHeight;
  const corners: { key: SnapCorner; x: number; y: number }[] = [
    { key: 'bottom-right', x: ww - 180, y: wh - 260 },
    { key: 'bottom-left', x: CORNER_PADDING, y: wh - 260 },
    { key: 'top-right', x: ww - 180, y: 80 },
    { key: 'top-left', x: CORNER_PADDING, y: 80 },
  ];
  let best = corners[0];
  let bestDist = Infinity;
  for (const c of corners) {
    const d = Math.hypot(x - c.x, y - c.y);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best.key;
}

interface VideoCallUIProps {
  contact: { id: string; username: string; avatar: string };
  onEnd: () => void;
  socket: Socket | null;
  user: { id: string; username: string } | null;
  direction: 'outgoing' | 'incoming';
  initialSdp?: string;
}

export default function VideoCallUI({ contact, onEnd, socket, user, direction, initialSdp }: VideoCallUIProps) {
  const {
    localStream, remoteStream, isMuted, isCameraOn, connected, callStatus, seconds,
    toggleMute, toggleCamera, flipCamera, handleEnd, formatTime,
  } = useCall({ socket, contact, user, direction, initialSdp, type: 'video', onEnd });

  const [controlsVisible, setControlsVisible] = useState(true);
  const [localPos, setLocalPos] = useState(() => getCornerPos('bottom-right'));
  const [showSettings, setShowSettings] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const snapCornerRef = useRef<SnapCorner>('bottom-right');
  const tapHintRef = useRef<HTMLDivElement>(null);

  const hideControlsTimeout = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (connected) {
      controlsTimerRef.current = setTimeout(() => setControlsVisible(false), 4000);
    }
  }, [connected]);

  useEffect(() => { hideControlsTimeout(); return () => { if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current); }; }, [connected, hideControlsTimeout]);

  useEffect(() => {
    if (connected && tapHintRef.current) {
      tapHintRef.current.style.opacity = '1';
      setTimeout(() => { if (tapHintRef.current) tapHintRef.current.style.opacity = '0'; }, 3000);
    }
  }, [connected]);

  // Attach streams to video elements
  useEffect(() => { if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream; }, [localStream]);
  useEffect(() => { if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream; }, [remoteStream]);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    dragStartRef.current = { x: e.clientX, y: e.clientY, left: localPos.x, top: localPos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    setLocalPos({
      x: dragStartRef.current.left + e.clientX - dragStartRef.current.x,
      y: dragStartRef.current.top + e.clientY - dragStartRef.current.y,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    const corner = nearestCorner(localPos.x, localPos.y);
    snapCornerRef.current = corner;
    setLocalPos(getCornerPos(corner));
    dragStartRef.current = null;
  };

  return (
    <Overlay onClick={() => { setControlsVisible(true); hideControlsTimeout(); }}>
      {callStatus === 'ringing' && (
        <CallingOverlay>
          <CallingText>Calling {contact.username}...</CallingText>
          <CallingTimer>{formatTime(seconds)}</CallingTimer>
        </CallingOverlay>
      )}
      {callStatus === 'missed' && (
        <CallingOverlay>
          <CallingText>{contact.username} is not available</CallingText>
        </CallingOverlay>
      )}
      {callStatus === 'declined' && (
        <CallingOverlay>
          <CallingText>{contact.username} declined</CallingText>
        </CallingOverlay>
      )}

      <RemoteVideo ref={remoteVideoRef} autoPlay playsInline />

      {isCameraOn && localStream && (
        <LocalVideo
          ref={localVideoRef}
          autoPlay playsInline muted
          $x={localPos.x} $y={localPos.y}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{ touchAction: 'none' }}
        />
      )}

      <TopStatusBar $visible={controlsVisible && connected}>
        <StatusPill>
          <StatusDot $connected={connected} />
          <StatusName>{contact.username}</StatusName>
          <StatusTimer>{formatTime(seconds)}</StatusTimer>
        </StatusPill>
      </TopStatusBar>

      <div ref={tapHintRef}><TapHint>Tap anywhere for controls</TapHint></div>

      <BottomControlsBar $visible={controlsVisible}>
        <CtrlBtn $active={!isMuted} onClick={e => { e.stopPropagation(); toggleMute(); }}>
          {isMuted ? <FiMicOff /> : <FiMic />}
        </CtrlBtn>
        <CtrlBtn $active={isCameraOn} onClick={e => { e.stopPropagation(); toggleCamera(); }}>
          {isCameraOn ? <FiCamera /> : <FiCameraOff />}
        </CtrlBtn>
        <CtrlBtn $active onClick={e => { e.stopPropagation(); flipCamera(); }}>
          <FiRotateCw />
        </CtrlBtn>
        <CtrlBtn $bg="rgba(255,255,255,0.15)" onClick={e => { e.stopPropagation(); setShowSettings(true); }}>
          <FiSettings />
        </CtrlBtn>
        <EndCallBtn onClick={e => { e.stopPropagation(); handleEnd(); }}>
          <FiX />
        </EndCallBtn>
      </BottomControlsBar>

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

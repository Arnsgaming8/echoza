import { useState, useEffect, useRef, useCallback } from 'react';
import styled, { keyframes } from 'styled-components';
import { Socket } from 'socket.io-client';
import { FiMic, FiMicOff, FiCamera, FiCameraOff, FiRotateCw, FiMaximize2, FiMinimize2, FiX, FiSettings, FiMonitor } from 'react-icons/fi';

const METERED_DOMAIN = 'vanra.metered.live';

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const fadeOut = keyframes`
  from { opacity: 1; }
  to { opacity: 0; }
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

const LocalVideo = styled.video<{ $x: number; $y: number; $controlsVisible: boolean }>`
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
  transition: left 0.2s ease, top 0.2s ease, width 0.2s ease, height 0.2s ease;

  &:active {
    cursor: grabbing;
    transition: none;
  }

  @media (max-width: 768px) {
    width: ${({ $controlsVisible }) => $controlsVisible ? '120px' : '140px'};
    height: ${({ $controlsVisible }) => $controlsVisible ? '170px' : '200px'};
  }
`;

const TopStatusBar = styled.div<{ $visible: boolean }>`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
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
  bottom: 0;
  left: 0;
  right: 0;
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

  &:hover {
    transform: scale(1.08);
  }

  &:active {
    transform: scale(0.92);
  }
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
  transition: transform 0.15s ease, background 0.15s ease;
  box-shadow: 0 4px 20px rgba(255, 59, 48, 0.4);

  &:hover {
    transform: scale(1.08);
    background: #d62d20;
  }

  &:active {
    transform: scale(0.92);
  }
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

const TapHint = styled.div`
  position: absolute;
  bottom: 120px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255,255,255,0.3);
  font-size: 13px;
  z-index: 9;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.5s ease;
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

const SettingsRow = styled.div`
  margin-bottom: 14px;
`;

const SettingsLabel = styled.label`
  display: block;
  color: rgba(255,255,255,0.6);
  font-size: 12px;
  margin-bottom: 6px;
`;

const SettingsSelect = styled.select`
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255,255,255,0.08);
  color: white;
  border: 1px solid rgba(255,255,255,0.1);
  font-size: 14px;
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

type SnapCorner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

const CORNER_PADDING = 20;

function getCornerPos(corner: SnapCorner, controlsVisible: boolean): { x: number; y: number } {
  const ww = window.innerWidth;
  const wh = window.innerHeight;
  const pw = controlsVisible ? 130 : 160;
  const ph = controlsVisible ? 180 : 220;

  switch (corner) {
    case 'bottom-right':
      return { x: ww - pw - CORNER_PADDING, y: wh - ph - (controlsVisible ? 110 : 40) };
    case 'bottom-left':
      return { x: CORNER_PADDING, y: wh - ph - (controlsVisible ? 110 : 40) };
    case 'top-right':
      return { x: ww - pw - CORNER_PADDING, y: 80 };
    case 'top-left':
      return { x: CORNER_PADDING, y: 80 };
  }
}

function nearestCorner(x: number, y: number, controlsVisible: boolean): SnapCorner {
  const ww = window.innerWidth;
  const wh = window.innerHeight;
  const pw = controlsVisible ? 130 : 160;
  const ph = controlsVisible ? 180 : 220;
  const corners: { key: SnapCorner; x: number; y: number }[] = [
    { key: 'bottom-right', x: ww - pw - CORNER_PADDING, y: wh - ph - (controlsVisible ? 110 : 40) },
    { key: 'bottom-left', x: CORNER_PADDING, y: wh - ph - (controlsVisible ? 110 : 40) },
    { key: 'top-right', x: ww - pw - CORNER_PADDING, y: 80 },
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

export default function VideoCallUI({ contact, onEnd, socket, user, roomName }: VideoCallUIProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [connected, setConnected] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedInput, setSelectedInput] = useState('');
  const [selectedOutput, setSelectedOutput] = useState('');
  const [pipMode, setPipMode] = useState(false);
  const [localPos, setLocalPos] = useState<{ x: number; y: number }>(() =>
    getCornerPos('bottom-right', true));
  const snapCornerRef = useRef<SnapCorner>('bottom-right');
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const meetingRef = useRef<MeteredMeeting | null>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapHintRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const CALL_TIMEOUT = 120000;

  const hideControlsTimeout = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (connected) {
      controlsTimerRef.current = setTimeout(() => {
        if (!showSettings) setControlsVisible(false);
      }, 4000);
    }
  }, [connected, showSettings]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    hideControlsTimeout();
  }, [hideControlsTimeout]);

  useEffect(() => {
    hideControlsTimeout();
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [connected, hideControlsTimeout]);

  useEffect(() => {
    if (connected && tapHintRef.current) {
      tapHintRef.current.style.opacity = '1';
      setTimeout(() => {
        if (tapHintRef.current) tapHintRef.current.style.opacity = '0';
      }, 3000);
    }
  }, [connected]);

  // Timers
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => {
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Metered
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
      console.log('[Metered] remoteTrackStarted type=' + item.type);
      setConnected(true);
      if (item.type === 'video' && remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = new MediaStream([item.track]);
      }
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
      console.log('[Metered] join resolved - starting media');
      try { meeting.startVideo(); } catch (e) { console.warn('startVideo threw:', e); }
      try { meeting.startAudio(); } catch (e) { console.warn('startAudio threw:', e); }
    }).catch((e: any) => console.warn('Metered join failed:', e));

    return () => {
      meeting.leaveMeeting();
    };
  }, []);

  // Ringing timeout
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    timeoutRef.current = setTimeout(() => {
      if (socket && contact) socket.emit('call:end', { receiverId: contact.id });
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

  // Snap local preview when controls visibility changes
  useEffect(() => {
    if (!pipMode) {
      const pos = getCornerPos(snapCornerRef.current, controlsVisible);
      setLocalPos(pos);
    }
  }, [controlsVisible, pipMode]);

  const toggleMute = () => {
    const m = meetingRef.current;
    if (!m) return;
    if (isMuted) { m.startAudio().catch(console.warn); }
    else { m.stopAudio().catch(console.warn); }
    setIsMuted(!isMuted);
    showControls();
  };

  const toggleCamera = () => {
    const m = meetingRef.current;
    if (!m) return;
    if (isCameraOn) { m.stopVideo().catch(console.warn); }
    else { m.startVideo().catch(console.warn); }
    setIsCameraOn(!isCameraOn);
    showControls();
  };

  const flipCamera = () => {
    const m = meetingRef.current;
    if (!m) return;
    m.switchCamera().catch(console.warn);
    showControls();
  };

  const togglePip = () => {
    setPipMode(!pipMode);
    if (!pipMode) {
      setLocalPos(getCornerPos(snapCornerRef.current, controlsVisible));
    }
    showControls();
  };

  const handleEnd = () => {
    if (socket && contact) socket.emit('call:end', { receiverId: contact.id });
    onEnd();
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  // Drag handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      left: localPos.x,
      top: localPos.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setLocalPos({
      x: dragStartRef.current.left + dx,
      y: dragStartRef.current.top + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    const corner = nearestCorner(localPos.x, localPos.y, controlsVisible);
    snapCornerRef.current = corner;
    const snapped = getCornerPos(corner, controlsVisible);
    setLocalPos(snapped);
    dragStartRef.current = null;
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
    showControls();
  };

  const changeAudioInput = async (deviceId: string) => {
    setSelectedInput(deviceId);
    const m = meetingRef.current;
    if (!m) return;
    try { await m.chooseAudioInputDevice(deviceId); } catch {}
  };

  const changeAudioOutput = (deviceId: string) => {
    setSelectedOutput(deviceId);
    const m = meetingRef.current;
    if (!m) return;
    m.chooseAudioOutputDevice(deviceId).catch(() => {});
  };

  return (
    <Overlay onClick={showControls}>
      {!connected && (
        <CallingOverlay>
          <CallingText>Calling {contact.username}...</CallingText>
          <CallingTimer>{formatTime(seconds)}</CallingTimer>
        </CallingOverlay>
      )}

      <RemoteVideo ref={remoteVideoRef} autoPlay playsInline />

      {isCameraOn && (
        <LocalVideo
          ref={localVideoRef}
          autoPlay playsInline
          muted
          $x={localPos.x}
          $y={localPos.y}
          $controlsVisible={controlsVisible}
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

      <div ref={tapHintRef}>
        <TapHint>Tap anywhere for controls</TapHint>
      </div>

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
        <CtrlBtn $active={pipMode} onClick={e => { e.stopPropagation(); togglePip(); }}>
          {pipMode ? <FiMaximize2 /> : <FiMinimize2 />}
        </CtrlBtn>
        <CtrlBtn $bg="rgba(255,255,255,0.15)" onClick={e => { e.stopPropagation(); openSettings(); }}>
          <FiSettings />
        </CtrlBtn>
        <EndCallBtn onClick={e => { e.stopPropagation(); handleEnd(); }}>
          <FiX />
        </EndCallBtn>
      </BottomControlsBar>

      {showSettings && (
        <SettingsPanel onClick={e => e.stopPropagation()}>
          <CloseBtn onClick={() => setShowSettings(false)}>
            <FiX />
          </CloseBtn>
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
    </Overlay>
  );
}

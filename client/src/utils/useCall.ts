import { useState, useEffect, useRef, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { apiUrl } from './api';

const FALLBACK_ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: ['turn:161.153.65.53:3478', 'turn:161.153.65.53:3478?transport=tcp'], username: 'echoza', credential: 'echoza123' },
  ],
};

interface UseCallOptions {
  socket: Socket | null;
  contact: { id: string; username: string; avatar: string };
  user: { id: string; username: string } | null;
  direction: 'outgoing' | 'incoming';
  initialSdp?: string;
  type: 'audio' | 'video';
  onEnd: () => void;
}

export function useCall({ socket, contact, user, direction, initialSdp, type, onEnd }: UseCallOptions) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [connected, setConnected] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [callStatus, setCallStatus] = useState<'ringing' | 'missed' | 'declined' | 'connected'>('ringing');

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const ringingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const missedRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const CALL_TIMEOUT = 60000;

  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  const toggleMute = useCallback(() => {
    const pc = pcRef.current;
    if (!pc) return;
    const senders = pc.getSenders();
    for (const sender of senders) {
      if (sender.track?.kind === 'audio') {
        sender.track.enabled = isMuted;
      }
    }
    setIsMuted(!isMuted);
  }, [isMuted]);

  const toggleCamera = useCallback(() => {
    const pc = pcRef.current;
    if (!pc) return;
    const senders = pc.getSenders();
    for (const sender of senders) {
      if (sender.track?.kind === 'video') {
        sender.track.enabled = !isCameraOn;
      }
    }
    setIsCameraOn(!isCameraOn);
  }, [isCameraOn]);

  const flipCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;
    const { facingMode } = videoTrack.getSettings();
    const newFacing = facingMode === 'user' ? 'environment' : 'user';
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: newFacing },
    }).then(newStream => {
      const newTrack = newStream.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');
      sender?.replaceTrack(newTrack);
      videoTrack.stop();
      stream.removeTrack(videoTrack);
      stream.addTrack(newTrack);
      setIsCameraOn(true);
    }).catch(() => {});
  }, []);

  const startRingtone = useCallback(() => {
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      oscRef.current = osc;
      gainRef.current = gain;
      const now = ctx.currentTime;
      const step = 0.25;
      const vol = 0.08;
      for (let i = 0; i < 200; i++) {
        const p = i % 10;
        const t = now + i * step;
        if (p === 0) {
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(vol, t + 0.05);
          osc.frequency.setValueAtTime(523, t);
        } else if (p === 1) {
          gain.gain.linearRampToValueAtTime(0, t + 0.05);
        } else if (p === 4) {
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(vol, t + 0.05);
          osc.frequency.setValueAtTime(659, t);
        } else if (p === 5) {
          gain.gain.linearRampToValueAtTime(0, t + 0.05);
        }
      }
    } catch {}
  }, []);

  const stopRingtone = useCallback(() => {
    try {
      oscRef.current?.stop();
      gainRef.current?.disconnect();
      audioCtxRef.current?.close();
      oscRef.current = null;
      gainRef.current = null;
      audioCtxRef.current = null;
    } catch {}
  }, []);

  const handleEnd = useCallback(() => {
    stopRingtone();
    if (endTimerRef.current) { clearTimeout(endTimerRef.current); endTimerRef.current = null; }
    const pc = pcRef.current;
    if (pc) { pc.close(); pcRef.current = null; }
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    if (socket && contact) {
      socket.emit('call:end', { receiverId: contact.id });
    }
    onEndRef.current();
  }, [socket, contact, stopRingtone]);

  const delayedEnd = useCallback((status: 'missed' | 'declined') => {
    setCallStatus(status);
    endTimerRef.current = setTimeout(() => handleEnd(), 2000);
  }, [handleEnd]);

  // Timer
  useEffect(() => {
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Ringing timeout
  useEffect(() => {
    if (callStatus !== 'ringing') return;
    ringingRef.current = setTimeout(() => {
      if (!connected && !missedRef.current) {
        missedRef.current = true;
        if (socket && contact) {
          socket.emit('call:missed', { receiverId: contact.id, type });
        }
        delayedEnd('missed');
      }
    }, CALL_TIMEOUT);
    return () => { if (ringingRef.current) clearTimeout(ringingRef.current); };
  }, [connected, callStatus, socket, contact, type, delayedEnd]);

  // Ringtone
  useEffect(() => {
    if (callStatus === 'ringing') startRingtone();
    else stopRingtone();
  }, [callStatus, startRingtone, stopRingtone]);

  // Setup peer connection + media
  useEffect(() => {
    if (!user || !socket) return;

    let cancelled = false;

    const run = async () => {
      let config: RTCConfiguration = FALLBACK_ICE_CONFIG;
      try {
        const res = await fetch(apiUrl('/api/ice-config'));
        const data = await res.json();
        if (data.iceServers) config = { iceServers: data.iceServers };
      } catch {}

      if (cancelled) return;

      const pc = new RTCPeerConnection(config);
      pcRef.current = pc;
      let cleanupStream: MediaStream | null = null;

      const setupLocalMedia = async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === 'video',
        });
        setLocalStream(stream);
        localStreamRef.current = stream;
        cleanupStream = stream;
        stream.getTracks().forEach(track => {
          pc.addTrack(track, stream);
        });
      };

      const handleIceCandidate = (e: RTCPeerConnectionIceEvent) => {
        if (e.candidate && socket) {
          const c = e.candidate;
          socket.emit('call:ice-candidate', {
            receiverId: contact.id,
            candidate: { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex },
          });
        }
      };

      const handleTrack = (e: RTCTrackEvent) => {
        if (!remoteStreamRef.current) remoteStreamRef.current = new MediaStream();
        remoteStreamRef.current.addTrack(e.track);
        setRemoteStream(new MediaStream(remoteStreamRef.current.getTracks()));
        setConnected(true);
        setCallStatus('connected');
      };

      pc.onicecandidate = handleIceCandidate;
      pc.ontrack = handleTrack;

      if (direction === 'outgoing') {
        setupLocalMedia().then(() => {
          return pc.createOffer();
        }).then(offer => {
          return pc.setLocalDescription(offer);
        }).then(() => {
          socket.emit('call:offer', {
            receiverId: contact.id,
            type,
            sdp: pc.localDescription?.sdp || '',
          });
        }).catch(err => console.warn('Outgoing call setup failed:', err));

        const onAnswer = ({ from, sdp }: { from: string; sdp: string }) => {
          if (from !== contact.id) return;
          pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
          socket.off('call:answer', onAnswer);
        };
        socket.on('call:answer', onAnswer);

        const onIce = ({ from, candidate }: { from: string; candidate: any }) => {
          if (from !== contact.id) return;
          pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
        };
        socket.on('call:ice-candidate', onIce);

        const onEnd = ({ from }: { from: string }) => {
          if (from !== contact.id) return;
          if (endTimerRef.current) return;
          if (!missedRef.current && !remoteStreamRef.current) {
            missedRef.current = true;
            socket.emit('call:missed', { receiverId: contact.id, type });
            delayedEnd('declined');
          } else {
            handleEnd();
          }
        };
        socket.on('call:end', onEnd);

        cleanupRef.current = () => {
          socket.off('call:answer', onAnswer);
          socket.off('call:ice-candidate', onIce);
          socket.off('call:end', onEnd);
        };
        return;
      }

      if (!initialSdp) return;

      const offer = new RTCSessionDescription({ type: 'offer', sdp: initialSdp });
      pc.setRemoteDescription(offer).then(() => {
        return setupLocalMedia();
      }).then(() => {
        return pc.createAnswer();
      }).then(answer => {
        return pc.setLocalDescription(answer);
      }).then(() => {
        socket.emit('call:answer', {
          receiverId: contact.id,
          sdp: pc.localDescription?.sdp || '',
        });
      }).catch(err => {
        console.warn('Incoming call setup failed:', err);
      });

      const onIce = ({ from, candidate }: { from: string; candidate: any }) => {
        if (from !== contact.id) return;
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      };
      socket.on('call:ice-candidate', onIce);

      cleanupRef.current = () => {
        socket.off('call:ice-candidate', onIce);
      };
    };

    run();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      if (endTimerRef.current) { clearTimeout(endTimerRef.current); endTimerRef.current = null; }
      const pc = pcRef.current;
      if (pc) { pc.close(); pcRef.current = null; }
      const cleanup = localStreamRef.current;
      if (cleanup) cleanup.getTracks().forEach(t => t.stop());
    };
  }, []);

  const switchAudioDevice = useCallback(async (deviceId: string) => {
    const pc = pcRef.current;
    if (!pc) return;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
      const newTrack = newStream.getAudioTracks()[0];
      const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
      if (sender) {
        await sender.replaceTrack(newTrack);
      }
      const old = localStreamRef.current;
      if (old) old.getAudioTracks().forEach(t => { t.stop(); old.removeTrack(t); });
      if (old) old.addTrack(newTrack);
      setLocalStream(null);
      setLocalStream(old);
    } catch {}
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  return {
    localStream,
    remoteStream,
    isMuted,
    isCameraOn,
    connected,
    callStatus,
    seconds,
    toggleMute,
    toggleCamera,
    flipCamera,
    switchAudioDevice,
    handleEnd,
    formatTime,
  };
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { isIOS } from './iosCapability';
import { apiUrl } from './api';

let cachedIceConfig: { config: RTCConfiguration; ts: number } | null = null;
const ICE_CACHE_TTL = 5 * 60 * 1000;

async function getIceConfig(): Promise<RTCConfiguration> {
  if (cachedIceConfig && Date.now() - cachedIceConfig.ts < ICE_CACHE_TTL) {
    return cachedIceConfig.config;
  }
  try {
    const res = await fetch(apiUrl('/api/ice-config'), { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (data?.iceServers && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      const config: RTCConfiguration = { iceServers: data.iceServers };
      cachedIceConfig = { config, ts: Date.now() };
      return config;
    }
  } catch {}
  return { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
}

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
  const [callStatus, setCallStatus] = useState<'ringing' | 'missed' | 'declined' | 'connected' | 'failed'>('ringing');
  const [audioLevel, setAudioLevel] = useState(0);
  const [callError, setCallError] = useState<string | null>(null);
  
  
  
  const [receiverReachable, setReceiverReachable] = useState<boolean | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const ringingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const missedRef = useRef(false);
  
  
  
  
  
  const pendingIceCandidatesRef = useRef<RTCIceCandidate[]>([]);
  const flushPendingIceCandidatesRef = useRef<(() => void) | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const playbackGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
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
      if (!newTrack) throw new Error('No video track from new facing mode');
      const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');
      sender?.replaceTrack(newTrack);
      videoTrack.stop();
      stream.removeTrack(videoTrack);
      stream.addTrack(newTrack);
      setIsCameraOn(true);
    }).catch((err) => {
      console.warn('[useCall] flipCamera failed:', err);
      setCallError('Unable to flip camera — device may have only one camera');
      setCallStatus('failed');
      setTimeout(() => {
        setCallError(null);
        setCallStatus(prev => prev === 'failed' ? 'connected' : prev);
      }, 2500);
    });
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
      for (let i = 0; i < 240; i++) {
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

  const delayedEnd = useCallback((status: 'missed' | 'declined' | 'failed') => {
    setCallStatus(status);
    endTimerRef.current = setTimeout(() => handleEnd(), 2000);
  }, [handleEnd]);

  
  
  
  
  
  const failCall = useCallback((err: any) => {
    if (missedRef.current) return;
    missedRef.current = true;

    const name = err?.name as string | undefined;
    let reason: string;
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      reason = 'Microphone/camera permission denied';
    } else if (name === 'NotFoundError') {
      reason = type === 'video'
        ? 'No microphone or camera available'
        : 'No microphone available';
    } else if (name === 'NotReadableError') {
      reason = 'Mic or camera is in use by another app';
    } else if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
      reason = 'No device matches the required settings';
    } else {
      reason = 'Unable to start the call';
    }

    setCallStatus('failed');
    setCallError(reason);
    console.warn('[useCall] setup failed:', err);

    if (socket && contact) {
      socket.emit('call:end', { receiverId: contact.id });
    }

    if (endTimerRef.current) clearTimeout(endTimerRef.current);
    endTimerRef.current = setTimeout(() => handleEnd(), 2500);
  }, [socket, contact, type, handleEnd]);

  
  useEffect(() => {
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  
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

  
  useEffect(() => {
    if (callStatus === 'ringing') startRingtone();
    else stopRingtone();
    return () => stopRingtone();
  }, [callStatus, startRingtone, stopRingtone]);

  
  useEffect(() => {
    if (!user || !socket) return;

    let cancelled = false;

    const run = async () => {
      if (cancelled) return;

      const iceConfig = await getIceConfig();
      const pc = new RTCPeerConnection(iceConfig);
      pcRef.current = pc;
      let cleanupStream: MediaStream | null = null;

      function isPcAlive(): boolean {
        return pcRef.current === pc && pcRef.current !== null;
      }

      
      
      
      
      
      
      
      const setupLocalMedia = async (attempt = 0): Promise<void> => {
        if (!isPcAlive()) throw new DOMException('Peer connection closed during setup');
        const wantVideo = type === 'video' && attempt < 2;
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: wantVideo,
          });
          if (!isPcAlive()) { stream.getTracks().forEach(t => t.stop()); throw new DOMException('Peer connection closed during setup'); }
          setLocalStream(stream);
          localStreamRef.current = stream;
          cleanupStream = stream;
          stream.getTracks().forEach(track => {
            const live = pcRef.current;
            if (live) live.addTrack(track, stream);
          });
          if (!wantVideo && type === 'video') {
            
            
            console.warn('[useCall] camera unavailable, proceeding audio-only');
          }
          return;
        } catch (err: any) {
          if (err?.name === 'NotFoundError') {
            if (attempt === 0) {
              
              
              await new Promise(r => setTimeout(r, 400));
              return setupLocalMedia(1);
            }
            if (attempt === 1 && type === 'video') {
              
              
              return setupLocalMedia(2);
            }
          }
          throw err;
        }
      };

      let localCandCount = 0;
      const handleIceCandidate = (e: RTCPeerConnectionIceEvent) => {
        if (e.candidate && socket) {
          const c = e.candidate;
          const type = c.type || c.candidate?.split(' ')[7] || 'unknown';
          localCandCount++;
          socket.emit('call:ice-candidate', {
            receiverId: contact.id,
            candidate: { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex },
          });
        } else {
          console.log('[useCall] local candidates gathered total=' + localCandCount);
        }
      };

      pc.onicecandidateerror = (e: any) => {
        if (e && e.errorCode) {
          console.warn('[useCall] ICE candidate error: code=' + e.errorCode + ' text=' + (e.errorText || '') + ' url=' + (e.url || 'none'));
        }
      };

      const handleTrack = (e: RTCTrackEvent) => {
        if (!remoteStreamRef.current) remoteStreamRef.current = new MediaStream();
        remoteStreamRef.current.addTrack(e.track);
        setRemoteStream(new MediaStream(remoteStreamRef.current.getTracks()));
        if (playbackCtxRef.current && e.track.kind === 'audio') {
          try {
            const src = playbackCtxRef.current.createMediaStreamSource(new MediaStream([e.track]));
            if (analyserRef.current) src.connect(analyserRef.current);
            if (playbackGainRef.current) src.connect(playbackGainRef.current);
          } catch {}
        }
        setConnected(true);
        setCallStatus('connected');
      };

      pc.onicecandidate = handleIceCandidate;
      pc.ontrack = handleTrack;      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'connected') {
          stopRingtone();
        }
        if (pc.iceConnectionState === 'failed') {
          failCall(new Error('Network path could not be established'));
        }
      };

      const flushPendingIceCandidates = () => {
        const pcNow = pcRef.current;
        if (!pcNow) return;
        const queued = pendingIceCandidatesRef.current;
        if (queued.length === 0) return;
        pendingIceCandidatesRef.current = [];
        for (const candidate of queued) {
          pcNow.addIceCandidate(candidate).catch(() => {});
        }
      };
      flushPendingIceCandidatesRef.current = flushPendingIceCandidates;

      if (direction === 'outgoing') {
        
        
        
        
        
        
        setupLocalMedia().then(() => {
          if (!isPcAlive()) return;
          return pcRef.current!.createOffer();
        }).then(offer => {
          if (!offer || !isPcAlive()) return;
          if (isIOS() && offer.sdp && !offer.sdp.includes('a=extmap-allow-mixed')) {
            const lines = offer.sdp.split(/\r\n|\n/);
            let insertIdx = lines.length;
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].startsWith('m=')) { insertIdx = i; break; }
            }
            lines.splice(insertIdx, 0, 'a=extmap-allow-mixed');
            return pcRef.current!.setLocalDescription({ type: offer.type, sdp: lines.join('\r\n') });
          }
          return pcRef.current!.setLocalDescription(offer);
        }).then(() => {
          if (!isPcAlive()) return;
          socket.emit('call:offer', {
            receiverId: contact.id,
            type,
            sdp: pcRef.current!.localDescription?.sdp || '',
          });
        }).catch(err => {
          if (!isPcAlive()) return;
          console.warn('Outgoing call setup failed:', err);
          if (!missedRef.current) failCall(err);
        });

        
        
        
        
        const onSocketReconnect = () => {
          const live = pcRef.current;
          if (live?.localDescription?.sdp) {
            socket.emit('call:offer', {
              receiverId: contact.id,
              type,
              sdp: live.localDescription.sdp,
            });
          }
        };
        socket.io.on('reconnect', onSocketReconnect);

        
        
        const onRingingAck = ({ offline }: { offline: boolean }) => {
          setReceiverReachable(!offline);
        };
        socket.on('call:ringing', onRingingAck);

        const onAnswer = ({ from, sdp }: { from: string; sdp: string }) => {
          if (from !== contact.id) return;
          console.log('[useCall] received answer from ' + from + ', setting remote description, sdp length=' + (sdp ? sdp.length : 0));
          pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }))
            .then(() => {
              console.log('[useCall] remote description set, flushing ' + pendingIceCandidatesRef.current.length + ' pending candidates');
              flushPendingIceCandidatesRef.current?.();
            })
            .catch((err: any) => console.warn('[useCall] setRemoteDescription error:', err?.message || err));
          socket.off('call:answer', onAnswer);
        };
        socket.on('call:answer', onAnswer);

        let remoteCandCount = 0;
        const onIce = ({ from, candidate }: { from: string; candidate: any }) => {
          if (from !== contact.id) return;
          remoteCandCount++;
          const pcNow = pcRef.current;
          if (!pcNow) return;
          const c = new RTCIceCandidate(candidate);
          if (!pcNow.remoteDescription && !pcNow.currentRemoteDescription) {
            pendingIceCandidatesRef.current.push(c);
            console.log('[useCall] queued remote candidate #' + remoteCandCount + ' pending=' + pendingIceCandidatesRef.current.length);
            return;
          }
          pcNow.addIceCandidate(c).catch(() => {});
          console.log('[useCall] added remote candidate #' + remoteCandCount);
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
          socket.off('call:ringing', onRingingAck);
          socket.io.off('reconnect', onSocketReconnect);
        };
        return;
      }

      if (!initialSdp) return;

      const offer = new RTCSessionDescription({ type: 'offer', sdp: initialSdp });
      pcRef.current!.setRemoteDescription(offer).then(() => {
        if (!isPcAlive()) return;
        flushPendingIceCandidatesRef.current?.();
        return setupLocalMedia();
      }).then(() => {
        if (!isPcAlive()) return;
        return pcRef.current!.createAnswer();
      }).then(answer => {
        if (!answer || !isPcAlive()) return;
        return pcRef.current!.setLocalDescription(answer);
      }).then(() => {
        if (!isPcAlive()) return;
        flushPendingIceCandidatesRef.current?.();
        socket.emit('call:answer', {
          receiverId: contact.id,
          sdp: pcRef.current!.localDescription?.sdp || '',
        });
      }).catch(err => {
        if (!isPcAlive()) return;
        failCall(err);
      });

      let remoteCandCount = 0;
      const onIce = ({ from, candidate }: { from: string; candidate: any }) => {
        if (from !== contact.id) return;
        remoteCandCount++;
        const pcNow = pcRef.current;
        if (!pcNow) return;
        const c = new RTCIceCandidate(candidate);
        if (!pcNow.remoteDescription && !pcNow.currentRemoteDescription) {
          pendingIceCandidatesRef.current.push(c);
          console.log('[useCall] (incoming) queued remote candidate #' + remoteCandCount + ' pending=' + pendingIceCandidatesRef.current.length);
          return;
        }
        pcNow.addIceCandidate(c).catch(() => {});
        console.log('[useCall] (incoming) added remote candidate #' + remoteCandCount);
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
      playbackCtxRef.current?.close();
      playbackCtxRef.current = null;
      playbackGainRef.current = null;
      analyserRef.current = null;
      cancelAnimationFrame(rafRef.current);
      pendingIceCandidatesRef.current = [];
      flushPendingIceCandidatesRef.current = null;
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

  const resumePlayback = useCallback(() => {
    try {
      if (playbackCtxRef.current?.state === 'suspended') {
        playbackCtxRef.current.resume();
      }
      if (!playbackCtxRef.current) {
        const ctx = new AudioContext();
        const gain = ctx.createGain();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        gain.connect(ctx.destination);
        playbackCtxRef.current = ctx;
        playbackGainRef.current = gain;
        analyserRef.current = analyser;
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
          setAudioLevel(avg);
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      }
    } catch {}
  }, []);

  const setPlaybackVolume = useCallback((v: number) => {
    if (playbackGainRef.current) playbackGainRef.current.gain.value = v;
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
    audioLevel,
    connected,
    callStatus,
    callError,
    seconds,
    receiverReachable,
    toggleMute,
    toggleCamera,
    flipCamera,
    switchAudioDevice,
    resumePlayback,
    setPlaybackVolume,
    handleEnd,
    formatTime,
  };
}

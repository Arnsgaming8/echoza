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
  const [callStatus, setCallStatus] = useState<'ringing' | 'missed' | 'declined' | 'connected' | 'failed'>('ringing');
  const [audioLevel, setAudioLevel] = useState(0);
  const [callError, setCallError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const ringingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const missedRef = useRef(false);
  // Buffer remote ICE candidates that arrive BEFORE we've set the remote
  // description. addIceCandidate throws InvalidStateError when called
  // without one; queuing them and draining after setRemoteDescription
  // resolves means host/srflx/relay candidates from the peer don't get
  // silently dropped during the offer→answer chain.
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

  // Surface a setup failure for the CALLEE side (incoming) so the caller
  // knows the callee can't pick up. The OUTGOING side intentionally does
  // NOT call this — when the caller has no mic/camera, the other party's
  // phone keeps ringing (just like before) and the caller can hang up
  // manually or hit the 60s ringing timeout.
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
      // ICE pre-warm: Dashboard mounts fetch /api/ice-config and stashes
      // it on window._echozaIce. Use it instantly so we don't pay the
      // 100–500 ms round-trip on every call. Fall back to FALLBACK_ICE_CONFIG
      // if the cache is missing or the endpoint errored silently.
      if ((window as any)._echozaIce) {
        config = { iceServers: (window as any)._echozaIce };
      } else {
        try {
          const res = await fetch(apiUrl('/api/ice-config'));
          const data = await res.json();
          if (data.iceServers) {
            config = { iceServers: data.iceServers };
            (window as any)._echozaIce = data.iceServers;
          }
        } catch {}
      }

      if (cancelled) return;

      const pc = new RTCPeerConnection(config);
      pcRef.current = pc;
      let cleanupStream: MediaStream | null = null;

      // Setup local media with progressive constraint relaxation. NotFoundError
      // on the first pass is the most common 'no mic/camera' symptom — it's
      // triggered by (a) Chromium's tab-cold-start device-enumeration race,
      // or (b) a hardware-with-no-camera plus an outgoing video call. We
      // retry once after a short delay, then if STILL failing AND this is
      // a video call, drop the video constraint and accept an audio-only
      // call as a graceful fallback instead of failing the call entirely.
      const setupLocalMedia = async (attempt = 0): Promise<void> => {
        const wantVideo = type === 'video' && attempt < 2;
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: wantVideo,
          });
          setLocalStream(stream);
          localStreamRef.current = stream;
          cleanupStream = stream;
          stream.getTracks().forEach(track => {
            pc.addTrack(track, stream);
          });
          if (!wantVideo && type === 'video') {
            // Camera unavailable but proceeding audio-only. Caller and
            // peer both know the call is voice-only.
            console.warn('[useCall] camera unavailable, proceeding audio-only');
          }
          return;
        } catch (err: any) {
          if (err?.name === 'NotFoundError') {
            if (attempt === 0) {
              // First NotFoundError: Chromium's tab-cold-start race.
              // Wait briefly and retry — devices usually reappear.
              await new Promise(r => setTimeout(r, 400));
              return setupLocalMedia(1);
            }
            if (attempt === 1 && type === 'video') {
              // Video caller's camera is genuinely missing. Drop video
              // and run as audio-only so the call still succeeds.
              return setupLocalMedia(2);
            }
          }
          throw err;
        }
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
        if (e.track.kind === 'audio' && playbackCtxRef.current && analyserRef.current) {
          try {
            const src = playbackCtxRef.current.createMediaStreamSource(new MediaStream([e.track]));
            src.connect(analyserRef.current);
            analyserRef.current.connect(playbackGainRef.current!);
          } catch {}
        }
        setConnected(true);
        setCallStatus('connected');
      };

      pc.onicecandidate = handleIceCandidate;
      pc.ontrack = handleTrack;

      // ICE failure recovery. WebRTC's standard fix is restartIce() — the
      // browser re-gathers using the existing ICE config and (re)negotiates.
      // This is what actually achieves the "100% reach" goal when one side
      // is behind a NAT that needed a relay candidate that wasn't ready at
      // the original gathering time.
      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') {
          try { pc.restartIce(); } catch {}
          // After 6s, if still failed, surface as a setup error so the
          // caller sees the same UX as a permission/mic failure rather than
          // a silent hang.
          setTimeout(() => {
            const cur = pcRef.current;
            if (cur && cur.iceConnectionState === 'failed') {
              failCall(new Error('Network path could not be established'));
            }
          }, 6000);
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
          return pc.createOffer();
        }).then(offer => {
          return pc.setLocalDescription(offer);
        }).then(() => {
          socket.emit('call:offer', {
            receiverId: contact.id,
            type,
            sdp: pc.localDescription?.sdp || '',
          });
        }).catch(err => {
          console.warn('Outgoing call setup failed:', err);
          // Surface the failure to the caller too — previously the chain
          // swallowed setup errors and the UI stuck on a silent 'Calling...'
          // with no progress indication. failCall() emits call:end to
          // release the receiver (so they don't see a phantom ring) and
          // shows a friendly error overlay on the caller side.
          if (!missedRef.current) failCall(err);
        });

        // Re-emit the offer if the socket cycles mid-ringing. The receiver
        // path is unaffected, but our local SDP is still valid, and a fresh
        // socket means the server's pending-call timer tied to the old
        // socket id may have been orphaned. Replaying the offer re-binds it.
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

        const onAnswer = ({ from, sdp }: { from: string; sdp: string }) => {
          if (from !== contact.id) return;
          pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }))
            .then(() => flushPendingIceCandidatesRef.current?.());
          socket.off('call:answer', onAnswer);
        };
        socket.on('call:answer', onAnswer);

        const onIce = ({ from, candidate }: { from: string; candidate: any }) => {
          if (from !== contact.id) return;
          const pcNow = pcRef.current;
          if (!pcNow) return;
          const c = new RTCIceCandidate(candidate);
          // No remote description yet → queue; flushPendingIceCandidates()
          // drains when the offer→answer setRemoteDescription completes.
          if (!pcNow.remoteDescription && !pcNow.currentRemoteDescription) {
            pendingIceCandidatesRef.current.push(c);
            return;
          }
          pcNow.addIceCandidate(c).catch(() => {});
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
          socket.io.off('reconnect', onSocketReconnect);
        };
        return;
      }

      if (!initialSdp) return;

      const offer = new RTCSessionDescription({ type: 'offer', sdp: initialSdp });
      pc.setRemoteDescription(offer).then(() => {
        flushPendingIceCandidatesRef.current?.();
        return setupLocalMedia();
      }).then(() => {
        return pc.createAnswer();
      }).then(answer => {
        return pc.setLocalDescription(answer);
      }).then(() => {
        flushPendingIceCandidatesRef.current?.();
        socket.emit('call:answer', {
          receiverId: contact.id,
          sdp: pc.localDescription?.sdp || '',
        });
      }).catch(err => {
        failCall(err);
      });

      const onIce = ({ from, candidate }: { from: string; candidate: any }) => {
        if (from !== contact.id) return;
        const pcNow = pcRef.current;
        if (!pcNow) return;
        const c = new RTCIceCandidate(candidate);
        if (!pcNow.remoteDescription && !pcNow.currentRemoteDescription) {
          pendingIceCandidatesRef.current.push(c);
          return;
        }
        pcNow.addIceCandidate(c).catch(() => {});
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

import { useState, useEffect, useRef, useCallback } from 'react';
import { Socket } from 'socket.io-client';

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:76.155.153.25:3478', username: 'echoza', credential: 'echoza123' },
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

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const ringingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const CALL_TIMEOUT = 120000;

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

  const handleEnd = useCallback(() => {
    const pc = pcRef.current;
    if (pc) { pc.close(); pcRef.current = null; }
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    if (socket && contact) {
      socket.emit('call:end', { receiverId: contact.id });
    }
    onEnd();
  }, [socket, contact, onEnd]);

  // Timer
  useEffect(() => {
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Ringing timeout
  useEffect(() => {
    ringingRef.current = setTimeout(() => {
      if (!connected) handleEnd();
    }, CALL_TIMEOUT);
    return () => { if (ringingRef.current) clearTimeout(ringingRef.current); };
  }, [connected, handleEnd]);

  // Setup peer connection + media
  useEffect(() => {
    if (!user || !socket) return;

    const pc = new RTCPeerConnection(ICE_CONFIG);
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
        socket.emit('call:ice-candidate', {
          receiverId: contact.id,
          candidate: e.candidate.toJSON(),
        });
      }
    };

    const handleTrack = (e: RTCTrackEvent) => {
      setRemoteStream(new MediaStream([e.track]));
      setConnected(true);
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

      return () => {
        socket.off('call:answer', onAnswer);
        socket.off('call:ice-candidate', onIce);
        pc.close();
        pcRef.current = null;
        cleanupStream?.getTracks().forEach(t => t.stop());
      };
    } else {
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

      return () => {
        socket.off('call:ice-candidate', onIce);
        pc.close();
        pcRef.current = null;
        cleanupStream?.getTracks().forEach(t => t.stop());
      };
    }
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
    seconds,
    toggleMute,
    toggleCamera,
    flipCamera,
    handleEnd,
    formatTime,
  };
}

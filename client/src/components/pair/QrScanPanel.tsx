import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled, { keyframes, css } from 'styled-components';
import QrScanner from 'qr-scanner';
import { FiCamera, FiCameraOff, FiAlertCircle, FiX } from 'react-icons/fi';

const fadeIn = keyframes`from { opacity: 0; } to { opacity: 1; }`;

const Page = styled.div`
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: #000;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  animation: ${fadeIn} 0.18s ease;
`;

const Video = styled.video`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #000;
`;

const Overlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  pointer-events: none;
`;

const Frame = styled.div`
  width: min(72vw, 280px);
  aspect-ratio: 1 / 1;
  position: relative;
  border-radius: 18px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
  &::before, &::after {
    content: '';
    position: absolute;
    width: 32px;
    height: 32px;
    border: 3px solid #fff;
  }
  &::before { top: -2px; left: -2px; border-right: none; border-bottom: none; border-top-left-radius: 14px; }
  &::after { bottom: -2px; right: -2px; border-left: none; border-top: none; border-bottom-right-radius: 14px; }
`;

const Hint = styled.div`
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  text-align: center;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
  padding: 0 20px;
  line-height: 1.4;
`;

const SubHint = styled.div`
  color: rgba(255, 255, 255, 0.8);
  font-size: 12px;
  text-align: center;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  padding: 0 24px;
  line-height: 1.4;
  max-width: 320px;
`;

const TopBar = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  padding-top: max(16px, env(safe-area-inset-top));
  pointer-events: auto;
`;

const Title = styled.div`
  color: #fff;
  font-size: 17px;
  font-weight: 600;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
`;

const IconBtn = styled.button`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.18);
  border: none;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  backdrop-filter: blur(8px);
  &:hover { background: rgba(255, 255, 255, 0.28); }
`;

const BottomBar = styled.div`
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  padding-bottom: max(18px, env(safe-area-inset-bottom));
  pointer-events: auto;
`;

const CancelBtn = styled.button`
  background: rgba(255, 255, 255, 0.18);
  border: none;
  color: #fff;
  font-weight: 600;
  font-size: 14px;
  padding: 12px 22px;
  border-radius: 999px;
  cursor: pointer;
  backdrop-filter: blur(8px);
  &:hover { background: rgba(255, 255, 255, 0.28); }
`;

const FallbackPanel = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 32px;
  background: linear-gradient(160deg, #0f172a 0%, #1e293b 100%);
  color: #fff;
  text-align: center;
`;

const FallbackTitle = styled.div`
  font-size: 18px;
  font-weight: 700;
`;

const FallbackBody = styled.div<{ $mono?: boolean }>`
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  line-height: 1.5;
  max-width: 320px;
  ${({ $mono }) => $mono && css`font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: rgba(255,255,255,0.55); word-break: break-all;`}
`;

const FallbackHint = styled.div`
  font-size: 12px;
  color: rgba(255,255,255,0.6);
  line-height: 1.5;
  max-width: 320px;
`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function releaseCamera(video: HTMLVideoElement | null) {
  const stream = video?.srcObject as MediaStream | null;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    if (video) video.srcObject = null;
  }
}

function extractSessionId(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed, window.location.origin);
    const sid = u.searchParams.get('session');
    if (sid && UUID_RE.test(sid)) return sid;
    const pathSeg = u.pathname.split('/').filter(Boolean).pop();
    if (pathSeg && UUID_RE.test(pathSeg)) return pathSeg;
  } catch {
  }
  if (UUID_RE.test(trimmed)) return trimmed;
  return null;
}

interface QrScanPanelProps {
  onClose: () => void;
}

export default function QrScanPanel({ onClose }: QrScanPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const handledRef = useRef(false);
  const navigate = useNavigate();
  const [error, setError] = useState<{ title: string; body: string; hint?: string; raw?: string } | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let scanner: QrScanner | null = null;

    const handleResult = (result: QrScanner.ScanResult) => {
      if (handledRef.current) return;
      const sid = extractSessionId(result.data || '');
      if (!sid) {
        setError({
          title: 'Not an Echoza pairing code',
          body: 'The QR code we scanned doesn’t look like an Echoza device-pairing link. Make sure you’re pointing at the QR shown on the other device’s “Pair a new device” screen.',
        });
        return;
      }
      handledRef.current = true;
      scanner?.stop();
      navigate(`/login?session=${encodeURIComponent(sid)}`, { replace: true });
    };

    const handleError = (err: unknown) => {
      const name = (err as Error)?.name || '';
      const msg = (err as Error)?.message || String(err);
      if (/NotAllowed|Permission/i.test(name + msg)) {
        setError({
          title: 'Camera access blocked',
          body: 'We need camera access to scan the QR code.',
          hint: 'In your browser, allow camera access for this site, then tap “Try again”.',
        });
      } else if (/NotFound|Requested device/i.test(name + msg)) {
        setError({
          title: 'No camera found',
          body: 'This device doesn’t seem to have a working camera. Try signing in with your password instead, or use a different device.',
        });
      } else if (/NotReadable|TrackStartError|InUse/i.test(name + msg)) {
        setError({
          title: 'Camera is busy',
          body: 'Another app or tab is using this camera. Close it and try again.',
        });
      } else {
        setError({
          title: 'Camera failed to start',
          body: msg || 'Unknown error.',
          hint: 'Reload the page, or sign in with your password.',
        });
      }
      setStarting(false);
    };

    scanner = new QrScanner(
      video,
      handleResult,
      {
        highlightScanRegion: true,
        highlightCodeOutline: true,
        preferredCamera: 'environment',
        returnDetailedScanResult: true,
        maxScansPerSecond: 12,
        calculateScanRegion: (v) => {
          const w = v.videoWidth || 1;
          const h = v.videoHeight || 1;
          const size = Math.min(w, h) * 0.6;
          return {
            x: (w - size) / 2,
            y: (h - size) / 2,
            width: size,
            height: size,
          };
        },
      }
    );

    scannerRef.current = scanner;
    scanner.start()
      .then(() => setStarting(false))
      .catch(handleError);

    return () => {
      scanner?.stop();
      releaseCamera(video);
      scannerRef.current = null;
    };
  }, [navigate]);

  const handleClose = () => {
    scannerRef.current?.stop();
    releaseCamera(videoRef.current);
    scannerRef.current = null;
    onClose();
  };

  const retryingRef = useRef(false);
  const handleRetry = () => {
    if (retryingRef.current) return;
    retryingRef.current = true;
    setError(null);
    setStarting(true);
    handledRef.current = false;
    scannerRef.current?.start()
      .then(() => { setStarting(false); retryingRef.current = false; })
      .catch((err) => {
        const msg = (err as Error)?.message || String(err);
        setError({ title: 'Camera still blocked', body: msg });
        setStarting(false);
        retryingRef.current = false;
      });
  };

  return (
    <Page role="dialog" aria-modal="true" aria-label="Scan QR code">
      <Video ref={videoRef} playsInline muted autoPlay />

      {!error && (
        <>
          <TopBar>
            <Title>Scan pairing QR</Title>
            <IconBtn type="button" onClick={handleClose} aria-label="Close scanner">
              <FiX size={20} />
            </IconBtn>
          </TopBar>

          <Overlay>
            <Frame />
            <Hint>Point at the QR code on your other device</Hint>
            <SubHint>
              On that device, open <strong>Settings → Pair a new device</strong> and aim its QR here.
            </SubHint>
          </Overlay>

          <BottomBar>
            <CancelBtn type="button" onClick={handleClose}>Cancel</CancelBtn>
          </BottomBar>
        </>
      )}

      {error && (
        <FallbackPanel>
          {/blocked|busy|fail/i.test(error.title) ? <FiCameraOff size={56} /> : <FiAlertCircle size={56} />}
          <FallbackTitle>{error.title}</FallbackTitle>
          <FallbackBody>{error.body}</FallbackBody>
          {error.hint && <FallbackHint>{error.hint}</FallbackHint>}
          {error.raw && <FallbackBody $mono>{error.raw}</FallbackBody>}
          <BottomBar>
            {/blocked|did not start/i.test(error.title) ? (
              <CancelBtn type="button" onClick={handleRetry}>Try again</CancelBtn>
            ) : null}
            <CancelBtn type="button" onClick={handleClose}>Back to sign in</CancelBtn>
          </BottomBar>
        </FallbackPanel>
      )}

      {starting && !error && (
        <FallbackPanel style={{ background: 'rgba(0,0,0,0.55)' }}>
          <FiCamera size={48} />
          <FallbackTitle>Starting camera…</FallbackTitle>
          <FallbackHint>If your browser asks, allow camera access.</FallbackHint>
        </FallbackPanel>
      )}
    </Page>
  );
}

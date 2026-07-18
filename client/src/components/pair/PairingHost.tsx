import { useState, useEffect, useRef, useCallback } from 'react';
import styled, { keyframes } from 'styled-components';
import QRCode from 'qrcode';
import { FiX, FiCheck, FiSlash, FiSmartphone, FiAlertCircle } from 'react-icons/fi';
import { useSocket } from '../../contexts/SocketContext';

interface PairingHostProps {
  onClose: () => void;
}

interface PairStartedData {
  sessionId: string;
  code: string;
  pairingUrl: string;
  expiresAt: number;
}

interface PairRequestData {
  sessionId: string;
  deviceLabel: string;
  waitMs?: number;
}

interface PairCompletedData {
  ok: boolean;
  sessionId: string;
  denied?: boolean;
  cancelled?: boolean;
  reason?: string;
}

const fadeIn = keyframes`from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); }`;

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  animation: fadeIn 0.18s ease;
`;

const Modal = styled.div`
  width: 460px;
  max-width: 94vw;
  max-height: 92vh;
  overflow-y: auto;
  background: ${({ theme }) => theme.colors.bg.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.lg};
  animation: ${fadeIn} 0.22s ease;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${({ theme }) => theme.spacing.lg};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const Title = styled.h3`
  font-size: ${({ theme }) => theme.font.size.md};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.colors.text.primary};
  display: flex;
  align-items: center;
  gap: 8px;
`;

const CloseBtn = styled.button`
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: transparent;
  color: ${({ theme }) => theme.colors.text.secondary};
  font-size: 18px;
  &:hover { background: ${({ theme }) => theme.colors.bg.hover}; }
`;

const Body = styled.div`
  padding: ${({ theme }) => theme.spacing.lg};
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
`;

const QrBox = styled.div`
  padding: 16px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 0 0 1px ${({ theme }) => theme.colors.border};
`;

const QrCanvas = styled.canvas`
  display: block;
  width: 240px;
  height: 240px;
`;

const CodeLabel = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
  text-align: center;
`;

const CodeDisplay = styled.div`
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 36px;
  font-weight: 700;
  letter-spacing: 8px;
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  background: ${({ theme }) => theme.colors.bg.hover};
  padding: 14px 24px;
  border-radius: 12px;
  user-select: all;
`;

const Countdown = styled.div<{ $low?: boolean }>`
  font-size: 12px;
  color: ${({ $low, theme }) => ($low ? theme.colors.danger || '#FF3B5C' : theme.colors.text.secondary)};
  font-weight: ${({ $low }) => ($low ? 600 : 400)};
`;

const StatusRow = styled.div<{ $kind: 'ok' | 'err' | 'info' }>`
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  text-align: center;
  width: 100%;
  background: ${({ $kind }) =>
    $kind === 'ok' ? 'rgba(34, 197, 94, 0.10)'
    : $kind === 'err' ? 'rgba(239, 68, 68, 0.10)'
    : 'rgba(58, 123, 255, 0.10)'};
  color: ${({ $kind }) =>
    $kind === 'ok' ? '#22C55E'
    : $kind === 'err' ? '#EF4444'
    : 'inherit'};
`;

const RequestCard = styled.div`
  width: 100%;
  background: ${({ theme }) => theme.colors.bg.hover};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const RequestHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const DeviceLabel = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.secondary};
  word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
`;

const ActionRow = styled.div`
  display: flex;
  gap: 10px;
  width: 100%;
  justify-content: flex-end;
`;

const ApproveBtn = styled.button`
  flex: 1;
  padding: 12px;
  border-radius: 10px;
  border: none;
  background: ${({ theme }) => theme.colors.primary.echoBlue};
  color: white;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  &:hover { filter: brightness(1.08); }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;

const DenyBtn = styled.button`
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: transparent;
  color: ${({ theme }) => theme.colors.text.primary};
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  &:hover { background: ${({ theme }) => theme.colors.bg.hover}; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;

const CancelBtn = styled.button`
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.colors.text.secondary};
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  margin-top: 6px;
  &:hover { color: ${({ theme }) => theme.colors.text.primary}; }
`;

const Spinner = styled.div`
  width: 32px;
  height: 32px;
  border: 3px solid ${({ theme }) => theme.colors.border};
  border-top-color: ${({ theme }) => theme.colors.primary.echoBlue};
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
`;

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'expired';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function PairingHost({ onClose }: PairingHostProps) {
  const { socket } = useSocket();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [session, setSession] = useState<PairStartedData | null>(null);
  const [request, setRequest] = useState<PairRequestData | null>(null);
  const [completed, setCompleted] = useState<PairCompletedData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>('');
  const [msRemaining, setMsRemaining] = useState<number>(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!socket) return;

    setBusy(true);
    setError('');
    cancelledRef.current = false;
    socket.emit('pair:start');

    const onStarted = (data: PairStartedData) => {
      if (cancelledRef.current) return;
      setSession(data);
      setBusy(false);
      setMsRemaining(Math.max(0, data.expiresAt - Date.now()));
    };
    const onRequest = (data: PairRequestData) => {
      if (cancelledRef.current) return;
      setRequest(data);
    };
    const onCompleted = (data: PairCompletedData) => {
      if (cancelledRef.current) return;
      setCompleted(data);
      setBusy(false);
      setRequest(null);
    };

    socket.on('pair:started', onStarted);
    socket.on('pair:request', onRequest);
    socket.on('pair:completed', onCompleted);

    return () => {
      socket.off('pair:started', onStarted);
      socket.off('pair:request', onRequest);
      socket.off('pair:completed', onCompleted);
    };
  }, [socket]);

  useEffect(() => {
    if (!canvasRef.current || !session?.pairingUrl) return;
    QRCode.toCanvas(canvasRef.current, session.pairingUrl, {
      width: 256,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    }).catch((err) => console.error('[PairingHost] QR render error:', err));
  }, [session?.pairingUrl]);

  useEffect(() => {
    if (!session || completed || msRemaining <= 0) return;
    const t = setInterval(() => {
      setMsRemaining((r) => {
        if (r <= 1000) {
          if (!cancelledRef.current && socket && session) {
            socket.emit('pair:cancel', { sessionId: session.sessionId });
          }
          setCompleted({ ok: false, sessionId: session.sessionId, cancelled: true, reason: 'expired' });
          return 0;
        }
        return r - 1000;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [session, completed, msRemaining, socket]);

  const handleApprove = useCallback(() => {
    if (!socket || !request) return;
    setBusy(true);
    socket.emit('pair:approve', { sessionId: request.sessionId });
  }, [socket, request]);

  const handleDeny = useCallback(() => {
    if (!socket || !request) return;
    setBusy(true);
    socket.emit('pair:deny', { sessionId: request.sessionId });
  }, [socket, request]);

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    if (socket && session) {
      socket.emit('pair:cancel', { sessionId: session.sessionId });
    }
    onClose();
  }, [socket, session, onClose]);

  const lowTime = msRemaining > 0 && msRemaining < 30_000;

  return (
    <Overlay onClick={(e) => { if (e.target === e.currentTarget) handleCancel(); }}>
      <Modal onClick={(e) => e.stopPropagation()}>
        <Header>
          <Title>
            <FiSmartphone /> Pair a New Device
          </Title>
          <CloseBtn onClick={handleCancel} aria-label="Close pairing">
            <FiX />
          </CloseBtn>
        </Header>

        <Body>
          {error && <StatusRow $kind="err">{error}</StatusRow>}

          {busy && !session && (
            <>
              <Spinner />
              <CodeLabel>Preparing a pairing session…</CodeLabel>
            </>
          )}

          {session && !completed && !request && (
            <>
              <QrBox>
                <QrCanvas ref={canvasRef} />
              </QrBox>
              <CodeLabel>Open the camera on the new device and scan this code, or visit:</CodeLabel>
              <DeviceLabel>{session.pairingUrl}</DeviceLabel>
              <CodeLabel>Then enter this 6-digit code on the new device:</CodeLabel>
              <CodeDisplay>{session.code}</CodeDisplay>
              <Countdown $low={lowTime}>
                {lowTime ? `Code expires in ${formatRemaining(msRemaining)}` : `Expires in ${formatRemaining(msRemaining)}`}
              </Countdown>
            </>
          )}

          {request && (
            <RequestCard>
              <RequestHeader>
                <FiSmartphone /> A new device wants to pair
              </RequestHeader>
              <DeviceLabel>{request.deviceLabel}</DeviceLabel>
              {lowTime && (
                <StatusRow $kind="err">
                  Session expiring soon — approve quickly.
                </StatusRow>
              )}
              <ActionRow>
                <DenyBtn onClick={handleDeny} disabled={busy}>
                  <FiSlash /> Deny
                </DenyBtn>
                <ApproveBtn onClick={handleApprove} disabled={busy}>
                  <FiCheck /> {busy ? 'Approving…' : 'Approve'}
                </ApproveBtn>
              </ActionRow>
            </RequestCard>
          )}

          {completed && (
            <>
              {completed.ok ? (
                <StatusRow $kind="ok">
                  <FiCheck style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  The other device is now logged in to your account.
                </StatusRow>
              ) : completed.denied ? (
                <StatusRow $kind="info">Pairing denied.</StatusRow>
              ) : completed.reason === 'expired' || completed.cancelled ? (
                <StatusRow $kind="err">
                  <FiAlertCircle style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  The session expired or was cancelled.
                </StatusRow>
              ) : (
                <StatusRow $kind="err">
                  <FiAlertCircle style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  Pairing failed: {completed.reason || 'unknown'}
                </StatusRow>
              )}
              <CancelBtn onClick={onClose}>Done</CancelBtn>
            </>
          )}

          {!completed && session && (
            <CancelBtn onClick={handleCancel}>Cancel pairing</CancelBtn>
          )}
        </Body>
      </Modal>
    </Overlay>
  );
}

import { useState, useEffect, useRef, useCallback } from 'react';
import styled, { keyframes } from 'styled-components';
import QRCode from 'qrcode';
import { useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { FiCheck, FiX, FiAlertCircle, FiSmartphone } from 'react-icons/fi';
import { apiUrl } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';

type Status = 'connecting' | 'generating' | 'waiting' | 'code_accepted' | 'approved' | 'denied' | 'expired' | 'cancelled' | 'invalid' | 'error';

interface PairStartedData {
  sessionId: string;
  code: string;
  pairingUrl: string;
  expiresAt: number;
}

interface UserRecord {
  id: string;
  username: string;
  avatar: string;
  online: boolean;
}

const fadeIn = keyframes`from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); }`;

const Page = styled.div`
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: ${({ theme }) => theme.colors.bg.main};
`;

const Card = styled.div`
  width: 460px;
  max-width: 96vw;
  background: ${({ theme }) => theme.colors.bg.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.lg};
  padding: ${({ theme }) => theme.spacing.xl};
  display: flex;
  flex-direction: column;
  gap: 18px;
  align-items: center;
  animation: ${fadeIn} 0.25s ease;
`;

const Title = styled.h2`
  font-size: 22px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
  text-align: center;
  margin: 0;
`;

const Sub = styled.p`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text.secondary};
  text-align: center;
  margin: 0;
  line-height: 1.5;
`;

const QrBox = styled.div`
  padding: 14px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 0 0 1px ${({ theme }) => theme.colors.border};
`;

const QrCanvas = styled.canvas`
  display: block;
  width: 240px;
  height: 240px;
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
  text-align: center;
`;

const Countdown = styled.div<{ $low?: boolean }>`
  font-size: 12px;
  color: ${({ $low, theme }) => ($low ? theme.colors.danger || '#FF3B5C' : theme.colors.text.secondary)};
  font-weight: ${({ $low }) => ($low ? 600 : 400)};
  text-align: center;
`;

const UrlLabel = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text.secondary};
  word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-align: center;
  opacity: 0.7;
`;

const ErrorText = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.danger || '#EF4444'};
  text-align: center;
  background: rgba(239, 68, 68, 0.08);
  padding: 10px 14px;
  border-radius: 8px;
  width: 100%;
`;

const Spinner = styled.div`
  width: 36px;
  height: 36px;
  border: 3px solid ${({ theme }) => theme.colors.border};
  border-top-color: ${({ theme }) => theme.colors.primary.echoBlue};
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
`;

const BtnRow = styled.div`
  display: flex;
  gap: 10px;
  width: 100%;
  justify-content: center;
`;

const GhostBtn = styled.button`
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: transparent;
  color: ${({ theme }) => theme.colors.text.primary};
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  &:hover { background: ${({ theme }) => theme.colors.bg.hover}; }
`;

const InfoPill = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.secondary};
  text-align: center;
`;

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'expired';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function ErrorMessage({ status, customText }: { status: Status; customText?: string }) {
  switch (status) {
    case 'denied':
      return <ErrorText>The pairing request was denied on the other device.</ErrorText>;
    case 'expired':
      return <ErrorText>The pairing code expired. Ask your other device to start a new pairing session.</ErrorText>;
    case 'cancelled':
      return <ErrorText>The pairing session was cancelled.</ErrorText>;
    case 'invalid':
      return <ErrorText>This QR link is invalid. Reload the page and try again.</ErrorText>;
    case 'error':
      return <ErrorText>{customText || 'Pairing failed. Please try again.'}</ErrorText>;
    default:
      return null;
  }
}

interface HostPairPanelProps {
  onBack: () => void;
}

export default function HostPairPanel({ onBack }: HostPairPanelProps) {
  const navigate = useNavigate();
  const { login } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const cancelledRef = useRef(false);
  const [status, setStatus] = useState<Status>('connecting');
  const [session, setSession] = useState<PairStartedData | null>(null);
  const [targetUsername, setTargetUsername] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [msRemaining, setMsRemaining] = useState<number>(0);

  const cleanup = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    const sock = io(apiUrl('/'), {
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: 10_000,
    });
    socketRef.current = sock;

    sock.on('connect', () => {
      if (cancelledRef.current) return;
      setStatus('generating');
      sock.emit('pair:start');
    });

    sock.on('pair:started', (data: PairStartedData) => {
      if (cancelledRef.current) return;
      setSession(data);
      setMsRemaining(Math.max(0, data.expiresAt - Date.now()));
      setStatus('waiting');
    });

    sock.on('pair:status', (_data: { kind: string; sessionId: string }) => {
      if (cancelledRef.current) return;
      if (_data?.kind === 'awaiting_approval') {
        setStatus('code_accepted');
      }
    });

    sock.on('pair:result', (data: { ok: boolean; reason?: string; access_token?: string; refresh_token?: string; user?: { id: string; username: string; avatar: string; online?: boolean } }) => {
      if (cancelledRef.current) return;
      if (data?.ok && data.access_token && data.refresh_token && data.user) {
        setStatus('approved');
        setTargetUsername(data.user.username || '');
        const u: UserRecord = {
          id: data.user.id,
          username: data.user.username,
          avatar: data.user.avatar || '',
          online: !!data.user.online,
        };
        login(data.access_token, data.refresh_token, u);
        setTimeout(() => {
          navigate('/dashboard', { replace: true });
        }, 700);
        cleanup();
      } else {
        const reason = data?.reason || 'unknown';
        if (reason === 'denied') setStatus('denied');
        else if (reason === 'expired') setStatus('expired');
        else if (reason === 'cancelled') setStatus('cancelled');
        else { setStatus('error'); setError(reason); }
        cleanup();
      }
    });

    sock.on('pair:completed', () => {});

    sock.on('connect_error', (err) => {
      if (cancelledRef.current) return;
      setStatus('error');
      setError(err?.message || 'Could not reach the server.');
    });

    return () => {
      cancelledRef.current = true;
      cleanup();
    };
  }, [cleanup, login, navigate]);

  useEffect(() => {
    if (!canvasRef.current || !session?.pairingUrl) return;
    QRCode.toCanvas(canvasRef.current, session.pairingUrl, {
      width: 256,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    }).catch((err) => console.error('[HostPairPanel] QR render error:', err));
  }, [session?.pairingUrl]);

  useEffect(() => {
    if (!session || status === 'approved' || status === 'denied' || status === 'expired' || status === 'cancelled' || status === 'invalid' || status === 'error') return;
    if (msRemaining <= 0) return;
    const t = setInterval(() => {
      setMsRemaining((r) => {
        if (r <= 1000) {
          setStatus('expired');
          cleanup();
          return 0;
        }
        return r - 1000;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [session, status, msRemaining, cleanup]);

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    const sock = socketRef.current;
    if (sock && session) {
      sock.emit('pair:cancel', { sessionId: session.sessionId });
    }
    onBack();
  }, [session, onBack]);

  const lowTime = msRemaining > 0 && msRemaining < 30_000;

  const renderContent = () => {
    switch (status) {
      case 'connecting':
      case 'generating':
        return (
          <>
            <Spinner />
            <Title>Preparing a pairing code…</Title>
            <Sub>This will take a moment.</Sub>
          </>
        );
      case 'waiting':
        return (
          <>
            <Title>Scan with your other device</Title>
            <Sub>
              On a phone or device where you're already signed in, open the camera and scan this code.
              You'll be asked to enter the 6-digit code below to finish signing you in here.
            </Sub>
            <QrBox>
              <QrCanvas ref={canvasRef} />
            </QrBox>
            <CodeDisplay>{session?.code}</CodeDisplay>
            {session?.pairingUrl && (
              <UrlLabel>or open: {session.pairingUrl}</UrlLabel>
            )}
            <Countdown $low={lowTime}>
              {lowTime
                ? `Code expires in ${formatRemaining(msRemaining)}`
                : `Expires in ${formatRemaining(msRemaining)}`}
            </Countdown>
          </>
        );
      case 'code_accepted':
        return (
          <>
            <Spinner />
            <Title>Waiting for approval…</Title>
            <Sub>
              Your other device entered the code. Tap <strong>Approve</strong> there to finish signing you in here.
            </Sub>
          </>
        );
      case 'approved':
        return (
          <>
            <FiCheck size={48} color="#22C55E" />
            <Title>
              You're now signed in{targetUsername ? ` as ${targetUsername}` : ''}
            </Title>
            <Sub>Redirecting to your dashboard…</Sub>
          </>
        );
      case 'denied':
      case 'expired':
      case 'cancelled':
      case 'invalid':
      case 'error':
        return (
          <>
            {status === 'denied' || status === 'expired' || status === 'cancelled' || status === 'invalid' || status === 'error' ? (
              <FiAlertCircle size={48} color="#EF4444" />
            ) : null}
            <Title>Pairing didn't complete</Title>
            <ErrorMessage status={status} customText={error} />
            <BtnRow>
              <GhostBtn onClick={() => window.location.reload()}>
                <FiSmartphone /> Generate a new QR
              </GhostBtn>
              <GhostBtn onClick={onBack}>
                <FiX /> Back to sign in
              </GhostBtn>
            </BtnRow>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <Page>
      <Card>
        {renderContent()}
        {(status === 'connecting' || status === 'generating' || status === 'waiting' || status === 'code_accepted') && (
          <GhostBtn onClick={handleCancel}>
            Sign in with password instead
          </GhostBtn>
        )}
        <InfoPill>Echoza · Device pairing</InfoPill>
      </Card>
    </Page>
  );
}

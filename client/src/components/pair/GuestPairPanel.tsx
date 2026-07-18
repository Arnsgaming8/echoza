import { useState, useEffect, useRef, FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import { io, Socket } from 'socket.io-client';
import { FiCheck, FiX, FiAlertCircle, FiLoader } from 'react-icons/fi';
import { apiUrl } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';

type PairStatus =
  | 'connecting'
  | 'preflight'
  | 'code'
  | 'submitting'
  | 'approved'
  | 'denied'
  | 'expired'
  | 'cancelled'
  | 'invalid'
  | 'already_logged_in'
  | 'error';

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
  width: 440px;
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
  margin: 0 0 6px;
  line-height: 1.5;
`;

const CodeForm = styled.form`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  width: 100%;
`;

const CodeInput = styled.input`
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 36px;
  font-weight: 700;
  letter-spacing: 12px;
  text-align: center;
  width: 100%;
  max-width: 280px;
  padding: 16px 12px;
  border: 2px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.bg.main};
  color: ${({ theme }) => theme.colors.text.primary};
  text-transform: uppercase;
  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary.echoBlue};
  }
  &::placeholder { color: ${({ theme }) => theme.colors.text.secondary}; opacity: 0.4; }
`;

const SubmitBtn = styled.button`
  width: 100%;
  max-width: 280px;
  padding: 14px;
  border-radius: 10px;
  border: none;
  background: ${({ theme }) => theme.colors.primary.echoBlue};
  color: white;
  font-weight: 700;
  font-size: 15px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  &:hover:not(:disabled) { filter: brightness(1.08); }
  &:disabled { opacity: 0.55; cursor: not-allowed; }
`;

const ConfirmBtn = styled(SubmitBtn)`
  background: ${({ theme }) => theme.colors.danger || '#EF4444'};
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

const ErrorText = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.danger || '#EF4444'};
  text-align: center;
  background: rgba(239, 68, 68, 0.08);
  padding: 10px 14px;
  border-radius: 8px;
  width: 100%;
`;

const InfoPill = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.secondary};
  text-align: center;
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

const CardBox = styled.div`
  background: ${({ theme }) => theme.colors.bg.hover};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  padding: 14px 16px;
  width: 100%;
  text-align: center;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const Strong = styled.strong`
  color: ${({ theme }) => theme.colors.text.primary};
`;

function ErrorMessage({ status, customText }: { status: PairStatus; customText?: string }) {
  switch (status) {
    case 'denied':
      return <ErrorText>The pairing request was denied on the other device.</ErrorText>;
    case 'expired':
      return <ErrorText>The pairing code expired. Start a new session on your other device and try again.</ErrorText>;
    case 'cancelled':
      return <ErrorText>The pairing session was cancelled.</ErrorText>;
    case 'invalid':
      return <ErrorText>This pairing link is no longer valid. Open a fresh one from Settings on your other device.</ErrorText>;
    case 'error':
      return <ErrorText>{customText || 'Pairing failed. Please try again.'}</ErrorText>;
    default:
      return null;
  }
}

export default function GuestPairPanel() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login, logout, user, isAuthenticated } = useAuth();
  const [status, setStatus] = useState<PairStatus>('connecting');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [msRemaining, setMsRemaining] = useState(0);
  const [targetUsername, setTargetUsername] = useState<string>('');
  const [confirmingSwap, setConfirmingSwap] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const sessionId = params.get('session') || '';

  const cleanup = () => {
    const s = socketRef.current;
    if (s) {
      s.disconnect();
      socketRef.current = null;
    }
  };

  useEffect(() => {
    if (!sessionId) {
      setStatus('invalid');
      setError('No pairing session ID. Scan the QR code on your other device.');
      return;
    }

    const sock = io(apiUrl('/'), {
      auth: { pairSessionId: sessionId },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = sock;

    sock.on('pair:connected', (data: { ok: boolean; reason?: string; msRemaining?: number }) => {
      if (!data?.ok) {
        setStatus('invalid');
        setError(data?.reason || 'Could not connect to the pairing session.');
        sock.disconnect();
        return;
      }
      setMsRemaining(data.msRemaining || 0);
      setStatus(isAuthenticated ? 'already_logged_in' : 'code');
    });

    sock.on('pair:code-error', ({ remaining }: { remaining: number }) => {
      setStatus('code');
      setError(`Wrong code. ${remaining} attempt${remaining === 1 ? '' : 's'} left.`);
    });

    sock.on('pair:code-accepted', () => {
      setStatus('submitting');
      setError('');
    });

    sock.on('pair:result', (data: any) => {
      if (data?.ok) {
        setStatus('approved');
        setTargetUsername(data?.user?.username || '');
        const u: UserRecord = {
          id: data.user.id,
          username: data.user.username,
          avatar: data.user.avatar || '',
          online: false,
        };
        if (user && user.id !== u.id) {
          logout();
        }
        login(data.access_token, data.refresh_token, u);
        setTimeout(() => {
          navigate('/dashboard', { replace: true });
        }, 700);
        sock.disconnect();
      } else {
        if (data?.reason === 'denied') setStatus('denied');
        else if (data?.reason === 'expired') setStatus('expired');
        else if (data?.reason === 'cancelled') setStatus('cancelled');
        else if (data?.reason === 'too_many_attempts') {
          setStatus('error');
          setError('Too many wrong attempts. Start a new session.');
        } else {
          setStatus('error');
          setError(data?.reason || 'Pairing failed.');
        }
        sock.disconnect();
      }
    });

    sock.on('connect_error', (err) => {
      setStatus('error');
      setError(err?.message || 'Could not reach the server.');
    });

    return () => {
      sock.disconnect();
      socketRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (status !== 'code' || msRemaining <= 0) return;
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
  }, [status, msRemaining]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!socketRef.current || !code.trim() || status !== 'code') return;
    setError('');
    socketRef.current.emit('pair:code-submit', { code: code.trim() });
  };

  const handleAcceptSwap = async () => {
    setConfirmingSwap(true);
    try {
      const sock = socketRef.current;
      if (sock && sock.connected && code.trim()) {
        sock.emit('pair:code-submit', { code: code.trim() });
      }
    } catch { /* handled below */ }
  };

  const handleCancel = () => navigate('/login', { replace: true });

  const remainingLabel =
    msRemaining > 0 ? `${Math.floor(msRemaining / 60000)}:${Math.floor((msRemaining % 60000) / 1000).toString().padStart(2, '0')}` : '';

  return (
    <Page>
      <Card>
        {status === 'connecting' && (
          <>
            <Spinner />
            <Title>Connecting to your other device…</Title>
          </>
        )}

        {status === 'preflight' && (
          <>
            <Spinner />
            <Title>Loading…</Title>
          </>
        )}

        {status === 'already_logged_in' && (
          <>
            <Title>Switch accounts?</Title>
            <Sub>
              You're currently signed in as <Strong>{user?.username || 'this account'}</Strong>.
              Continuing will sign you out of that account and sign you in to the account that started the pairing session on your other device.
            </Sub>
            {error && <ErrorText>{error}</ErrorText>}
            <BtnRow>
              <GhostBtn onClick={handleCancel}>Cancel</GhostBtn>
              <ConfirmBtn disabled={confirmingSwap} onClick={handleAcceptSwap}>
                {confirmingSwap ? <FiLoader /> : <FiCheck />}
                Sign in to the other account
              </ConfirmBtn>
            </BtnRow>
            <InfoPill>Then enter the code on the next screen.</InfoPill>
          </>
        )}

        {status === 'code' && (
          <>
            <Title>Enter the pairing code</Title>
            <Sub>
              On your other device, open Settings → Log In Any Other Device → Start Device Log In,
              and enter the 6-digit code shown there.
            </Sub>
            <CodeForm onSubmit={handleSubmit}>
              <CodeInput
                type="text"
                inputMode="text"
                autoFocus
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                placeholder="------"
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              />
              {error && <ErrorText>{error}</ErrorText>}
              <SubmitBtn type="submit" disabled={code.length !== 6}>
                <FiCheck /> Submit code
              </SubmitBtn>
              {msRemaining > 0 && (
                <InfoPill>Code expires in {remainingLabel}</InfoPill>
              )}
            </CodeForm>
            <GhostBtn onClick={handleCancel}>Sign in with password instead</GhostBtn>
          </>
        )}

        {status === 'submitting' && (
          <>
            <Spinner />
            <Title>Confirming on your other device…</Title>
            <Sub>Tap <Strong>Approve</Strong> on the device that started the pairing.</Sub>
          </>
        )}

        {status === 'approved' && (
          <>
            <FiCheck size={48} color="#22C55E" />
            <Title>You're now signed in{targetUsername ? ` as ${targetUsername}` : ''}</Title>
            <Sub>Redirecting to your dashboard…</Sub>
          </>
        )}

        {(status === 'denied' || status === 'expired' || status === 'cancelled' ||
          status === 'invalid' || status === 'error') && (
          <>
            <FiAlertCircle size={48} color="#EF4444" />
            <Title>Pairing didn't complete</Title>
            <ErrorMessage status={status} customText={error} />
            <BtnRow>
              <GhostBtn onClick={() => navigate('/login', { replace: true })}>
                <FiX /> Back to sign in
              </GhostBtn>
            </BtnRow>
          </>
        )}

        <InfoPill>Echoza · Device pairing</InfoPill>
      </Card>
    </Page>
  );
}

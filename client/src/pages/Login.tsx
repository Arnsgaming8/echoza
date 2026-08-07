import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import { FiCamera } from 'react-icons/fi';
import { Button, Input, PasswordInput } from '../components/common';
import { useAuth } from '../contexts/AuthContext';
import { apiUrl } from '../utils/api';
import { withDeviceHeaders } from '../utils/deviceId';
import GuestPairPanel from '../components/pair/GuestPairPanel';
import QrScanPanel from '../components/pair/QrScanPanel';

const Wrapper = styled.div`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${({ theme }) => theme.spacing.xl};
  background: ${({ theme }) => theme.colors.bg.main};
`;

const Card = styled.div`
  width: 100%;
  max-width: 420px;
  padding: ${({ theme }) => theme.spacing.xl};
  border-radius: ${({ theme }) => theme.radius.lg};
  background: ${({ theme }) => theme.colors.bg.card};
  box-shadow: ${({ theme }) => theme.shadow.md};
  animation: fadeIn 0.4s ease;
  backdrop-filter: blur(12px);
  border: 1px solid ${({ theme }) => theme.colors.border};

  @media (max-width: 480px) {
    padding: ${({ theme }) => theme.spacing.lg} ${({ theme }) => theme.spacing.md};
  }
`;

const LogoImg = styled.img`
  width: 48px;
  height: 48px;
  display: block;
  margin: 0 auto 16px;
  filter: drop-shadow(0 4px 16px rgba(58, 123, 255, 0.3));
`;

const Title = styled.h2`
  font-size: ${({ theme }) => theme.font.size.xxl};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.colors.text.primary};
  text-align: center;
  margin-bottom: ${({ theme }) => theme.spacing.xs};

  @media (max-width: 480px) {
    font-size: ${({ theme }) => theme.font.size.xl};
  }
`;

const Subtitle = styled.p`
  text-align: center;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-bottom: ${({ theme }) => theme.spacing.xl};
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const StyledLink = styled(Link)`
  display: block;
  text-align: center;
  margin-top: ${({ theme }) => theme.spacing.md};
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  font-weight: ${({ theme }) => theme.font.weight.medium};

  &:hover {
    text-decoration: underline;
  }
`;

const Divider = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin: ${({ theme }) => theme.spacing.lg} 0 ${({ theme }) => theme.spacing.md};

  &::before, &::after {
    content: '';
    flex: 1;
    height: 1px;
    background: ${({ theme }) => theme.colors.border};
  }

  span {
    font-size: ${({ theme }) => theme.font.size.xs};
    color: ${({ theme }) => theme.colors.text.secondary};
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: ${({ theme }) => theme.font.weight.semibold};
  }
`;

const QrButton = styled.button`
  width: 100%;
  padding: 14px;
  border-radius: ${({ theme }) => theme.radius.md};
  border: 1px solid ${({ theme }) => theme.colors.primary.echoBlue};
  background: ${({ theme }) => theme.colors.primary.echoBlue}10;
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  font-size: ${({ theme }) => theme.font.size.md};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: background 0.15s ease, filter 0.15s ease;

  &:hover {
    background: ${({ theme }) => theme.colors.primary.echoBlue}22;
    filter: brightness(1.04);
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const ErrorMsg = styled.div`
  background: ${({ theme }) => theme.colors.danger}15;
  color: ${({ theme }) => theme.colors.danger};
  padding: 10px 14px;
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: ${({ theme }) => theme.font.size.sm};
  text-align: center;
`;

const InfoMsg = styled.div`
  background: ${({ theme }) => theme.colors.primary.echoBlue}10;
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  padding: 10px 14px;
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: ${({ theme }) => theme.font.size.sm};
  text-align: center;
  line-height: 1.4;
`;

const ForgotLink = styled.button`
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  display: block;
  text-align: center;
  margin: ${({ theme }) => theme.spacing.md} auto 0;
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  font-weight: ${({ theme }) => theme.font.weight.medium};

  &:hover { text-decoration: underline; }
  &:disabled { color: ${({ theme }) => theme.colors.text.secondary}; cursor: not-allowed; }
`;

const AdminLink = styled.button`
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  display: block;
  text-align: center;
  margin: ${({ theme }) => theme.spacing.md} auto 0;
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  font-weight: ${({ theme }) => theme.font.weight.medium};

  &:hover { text-decoration: underline; }
  &:disabled { color: ${({ theme }) => theme.colors.text.secondary}; cursor: not-allowed; }
`;



const fadeIn = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`;
const slideUp = keyframes`
  from { opacity: 0; transform: translateY(20px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0)    scale(1); }
`;

const ModalBackdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${({ theme }) => theme.spacing.xl};
  animation: ${fadeIn} 0.25s ease;
`;

const Modal = styled.div`
  width: 100%;
  max-width: 420px;
  padding: ${({ theme }) => theme.spacing.xl};
  border-radius: ${({ theme }) => theme.radius.lg};
  background: ${({ theme }) => theme.colors.bg.card};
  box-shadow: ${({ theme }) => theme.shadow.lg};
  border: 1px solid ${({ theme }) => theme.colors.border};
  animation: ${slideUp} 0.32s ease;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};

  @media (max-width: 480px) {
    padding: ${({ theme }) => theme.spacing.lg} ${({ theme }) => theme.spacing.md};
  }
`;

const ModalHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: ${({ theme }) => theme.spacing.md};
`;

const ModalTitle = styled.h3`
  font-size: ${({ theme }) => theme.font.size.xl};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.colors.text.primary};
  margin: 0;
`;

const ModalClose = styled.button`
  background: none;
  border: none;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.text.secondary};
  padding: 4px 8px;
  border-radius: ${({ theme }) => theme.radius.sm};
  transition: background 0.15s ease;
  &:hover {
    background: ${({ theme }) => theme.colors.bg.hover};
    color: ${({ theme }) => theme.colors.text.primary};
  }
`;

const ModalBody = styled.p`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
  line-height: 1.5;
  margin: 0;
`;

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [qrScanMode, setQrScanMode] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  
  
  
  
  
  const [searchParams] = useSearchParams();
  const nextParam = searchParams.get('next');
  
  
  const postLoginRedirect = nextParam && !nextParam.startsWith('/login')
    ? nextParam
    : '/dashboard';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');

    if (!username || !password) {
      setServerError('Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      
      
      
      const res = await fetch(
        apiUrl('/api/auth/login'),
        withDeviceHeaders({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username.trim(), password: password.trim() }),
        }),
      );
      const data = await res.json();

      if (!res.ok) {
        setServerError(data.error || 'Login failed');
        return;
      }

      login(data.token, data.refresh_token, data.user);
      if ((window.navigator as any).standalone) {
        window.location.href = postLoginRedirect;
      } else {
        navigate(postLoginRedirect);
      }
    } catch {
      setServerError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const sessionParam = searchParams.get('session');

  if (sessionParam) {
    return <GuestPairPanel />;
  }

  if (qrScanMode) {
    return <QrScanPanel onClose={() => setQrScanMode(false)} />;
  }

  return (
    <Wrapper>
      <Card>
        <LogoImg src="/vite.svg" alt="Echoza" />
        <Title>Welcome Back</Title>
        <Subtitle>Enter Echoza and continue chatting</Subtitle>
        <Form onSubmit={handleSubmit}>
          {serverError && <ErrorMsg>{serverError}</ErrorMsg>}
          <Input
            label="Username"
            placeholder="Enter your username"
            value={username}
            onChange={setUsername}
            disabled={loading}
          />
          <PasswordInput
            label="Password"
            placeholder="Enter your password"
            value={password}
            onChange={setPassword}
            disabled={loading}
          />
          <Button type="submit" fullWidth disabled={loading}>
            {loading ? 'Signing In...' : 'Enter Echoza'}
          </Button>
        </Form>
        <ForgotLink
          type="button"
          onClick={() => setForgotOpen(true)}
          disabled={loading}
        >
          Forgot password?
        </ForgotLink>

        <Divider><span>or</span></Divider>

        <QrButton
          type="button"
          onClick={() => setQrScanMode(true)}
          disabled={loading}
        >
          <FiCamera />
          Scan QR code to log in
        </QrButton>

        <StyledLink to="/signup">Don't have an account? Sign up</StyledLink>
        <AdminLink type="button" onClick={() => setAdminOpen(true)} disabled={loading}>
          Admin? Click Here.
        </AdminLink>
      </Card>
      {forgotOpen && (
        <ForgotPasswordModal
          onClose={() => setForgotOpen(false)}
          onSuccess={(token, refreshToken, user) => {
            login(token, refreshToken, user);
            setForgotOpen(false);
            if ((window.navigator as any).standalone) {
              window.location.href = postLoginRedirect;
            } else {
              navigate(postLoginRedirect);
            }
          }}
        />
      )}
      {adminOpen && (
        <AdminModal
          onClose={() => setAdminOpen(false)}
          onSuccess={(token, refreshToken, user) => {
            login(token, refreshToken, user);
            setAdminOpen(false);
            if ((window.navigator as any).standalone) {
              window.location.href = '/dashboard';
            } else {
              navigate('/dashboard');
            }
          }}
        />
      )}
    </Wrapper>
  );
}

















type ForgotStep =
  | { kind: 'enter-username' }
  | { kind: 'enter-new-password'; challenge: string; expiresInSeconds: number }
  | { kind: 'submitting-new-password'; challenge: string };

function ForgotPasswordModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (token: string, refreshToken: string, user: any) => void;
}) {
  const [step, setStep] = useState<ForgotStep>({ kind: 'enter-username' });
  const [username, setUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [stepError, setStepError] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);

  const handleVerifyDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setStepError('');
    
    
    
    const cleanUsername = username.trim();
    if (!cleanUsername) {
      setStepError('Please enter your username.');
      return;
    }
    setVerifyLoading(true);
    try {
      const res = await fetch(
        apiUrl('/api/auth/forgot-password/start'),
        withDeviceHeaders({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: cleanUsername }),
        }),
      );
      const data = await res.json();
      if (res.ok && data?.success === true) {
        setStep({
          kind: 'enter-new-password',
          challenge: data.challenge,
          expiresInSeconds: data.expiresInSeconds ?? 300,
        });
        setStepError('');
        return;
      }
      
      
      
      
      if (data?.allowPasswordSet) {
        setStepError(
          'We can\'t verify this device and your account doesn\'t have a password yet. ' +
          'Please ask the Echoza admin to set your initial password.',
        );
      } else {
        setStepError(
          'We can\'t verify this device. Please try again from a device you\'ve ' +
          'previously logged into Echoza on, or contact the Echoza admin.',
        );
      }
    } catch {
      setStepError('Connection error. Please try again.');
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setStepError('');
    if (step.kind !== 'enter-new-password') return;
    if (newPassword.length < 8) {
      setStepError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setStepError('Passwords do not match.');
      return;
    }
    setStep({ kind: 'submitting-new-password', challenge: step.challenge });
    try {
      const res = await fetch(
        apiUrl('/api/auth/forgot-password/change'),
        withDeviceHeaders({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ challenge: step.challenge, new_password: newPassword }),
        }),
      );
      const data = await res.json();
      if (res.ok && data?.token && data?.refresh_token && data?.user) {
        onSuccess(data.token, data.refresh_token, data.user);
        return;
      }
      
      
      
      setStep({ kind: 'enter-username' });
      setNewPassword('');
      setConfirmPassword('');
      if (data?.error === 'password_too_short') {
        setStepError('Password must be at least 8 characters.');
      } else if (data?.error === 'invalid_challenge') {
        setStepError('Verification expired. Please verify your device again.');
      } else {
        setStepError(data?.error || 'Could not change password. Please try again.');
      }
    } catch {
      setStep({ kind: 'enter-username' });
      setNewPassword('');
      setConfirmPassword('');
      setStepError('Connection error. Please try again.');
    }
  };

  const isFinalStep = step.kind === 'submitting-new-password';

  return (
    <ModalBackdrop onClick={(e) => {
      
      if (e.target === e.currentTarget && !isFinalStep) onClose();
    }}>
      <Modal role="dialog" aria-modal="true" aria-labelledby="forgot-title">
        <ModalHeader>
          <ModalTitle id="forgot-title">Reset Password</ModalTitle>
          <ModalClose type="button" onClick={onClose} aria-label="Close forgot password dialog">×</ModalClose>
        </ModalHeader>

        {step.kind === 'enter-username' && (
          <form onSubmit={handleVerifyDevice} style={{ display: 'contents' }}>
            <ModalBody>
              Enter your username. We'll check whether this device has signed
              into your account before — only your two most-recently-used
              devices can reset the password.
            </ModalBody>
            {stepError && <ErrorMsg>{stepError}</ErrorMsg>}
            <Input
              label="Username"
              placeholder="Enter your username"
              value={username}
              onChange={setUsername}
              disabled={verifyLoading}
              autoFocus
            />
            <Button type="submit" fullWidth disabled={verifyLoading}>
              {verifyLoading ? 'Verifying...' : 'Verify device'}
            </Button>
          </form>
        )}

        {(step.kind === 'enter-new-password' || step.kind === 'submitting-new-password') && (
          <form onSubmit={handleChangePassword} style={{ display: 'contents' }}>
            <InfoMsg>
              Device verified. Choose a new password — at least 8 characters.
              Your other devices will be signed out.
            </InfoMsg>
            {stepError && <ErrorMsg>{stepError}</ErrorMsg>}
            <PasswordInput
              label="New Password"
              placeholder="At least 8 characters"
              value={newPassword}
              onChange={setNewPassword}
              disabled={isFinalStep}
              autoFocus
            />
            <PasswordInput
              label="Confirm Password"
              placeholder="Type it again"
              value={confirmPassword}
              onChange={setConfirmPassword}
              disabled={isFinalStep}
            />
            <Button type="submit" fullWidth disabled={isFinalStep}>
              {isFinalStep ? 'Updating...' : 'Change Password'}
            </Button>
          </form>
        )}
      </Modal>
    </ModalBackdrop>
  );
}

interface AdminAccount {
  id: string;
  username: string;
  avatar: string;
  last_sign_in_at: string | null;
  created_at: string | null;
  is_system: boolean;
}

type AdminStep =
  | { kind: 'enter-secret' }
  | { kind: 'search' };

const AdminRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.bg.hover};
  cursor: pointer;
  transition: background 0.15s ease, transform 0.15s ease;

  &:hover {
    background: ${({ theme }) => theme.colors.primary.echoBlue}18;
    transform: translateY(-1px);
  }
`;

const AdminAvatar = styled.div`
  width: 38px;
  height: 38px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: #fff;
  background: ${({ theme }) => theme.colors.primary.echoBlue};
`;

const AdminName = styled.div`
  flex: 1;
  min-width: 0;
`;

const AdminUsername = styled.div`
  font-size: ${({ theme }) => theme.font.size.md};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.colors.text.primary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AdminMeta = styled.div`
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-top: 2px;
`;

const AdminBadge = styled.span`
  flex-shrink: 0;
  font-size: ${({ theme }) => theme.font.size.xs};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.colors.primary.echoGreen};
  border: 1px solid ${({ theme }) => theme.colors.primary.echoGreen}55;
  padding: 2px 8px;
  border-radius: 999px;
`;

const SearchBox = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const ResultsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow-y: auto;
`;

const EmptyResults = styled.p`
  text-align: center;
  color: ${({ theme }) => theme.colors.text.secondary};
  font-size: ${({ theme }) => theme.font.size.sm};
  padding: 16px 0;
`;

function AdminModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (token: string, refreshToken: string, user: any) => void;
}) {
  const [step, setStep] = useState<AdminStep>({ kind: 'enter-secret' });
  const [secret, setSecret] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminAccount[]>([]);
  const [searched, setSearched] = useState(false);
  const [stepError, setStepError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setStepError('');
    if (!secret.trim()) {
      setStepError('Enter the secret word.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/admin/unlock'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: secret.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data?.admin_token) {
        setStepError(data?.error || 'Access denied');
        return;
      }
      setAdminToken(data.admin_token);
      setStep({ kind: 'search' });
      setStepError('');
    } catch {
      setStepError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setStepError('');
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(apiUrl(`/api/admin/search?q=${encodeURIComponent(q)}`), {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setStepError(data?.error || 'Search failed');
        setResults([]);
        return;
      }
      setResults(Array.isArray(data) ? data : []);
    } catch {
      setStepError('Connection error. Please try again.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAccess = async (account: AdminAccount) => {
    setStepError('');
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/admin/access'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ userId: account.id }),
      });
      const data = await res.json();
      if (!res.ok || !data?.token) {
        setStepError(data?.error || 'Could not access account');
        return;
      }
      onSuccess(data.token, data.refresh_token, data.user);
    } catch {
      setStepError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return 'Never';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <ModalBackdrop onClick={(e) => {
      if (e.target === e.currentTarget && step.kind !== 'search') onClose();
    }}>
      <Modal role="dialog" aria-modal="true" aria-labelledby="admin-title">
        <ModalHeader>
          <ModalTitle id="admin-title">Echoza Admin</ModalTitle>
          <ModalClose type="button" onClick={onClose} aria-label="Close admin dialog">×</ModalClose>
        </ModalHeader>

        {step.kind === 'enter-secret' && (
          <form onSubmit={handleUnlock} style={{ display: 'contents' }}>
            <ModalBody>
              Enter the secret word to access the account manager.
            </ModalBody>
            {stepError && <ErrorMsg>{stepError}</ErrorMsg>}
            <Input
              label="Secret word"
              placeholder="••••••••"
              type="password"
              value={secret}
              onChange={setSecret}
              disabled={loading}
              autoFocus
            />
            <Button type="submit" fullWidth disabled={loading}>
              {loading ? 'Unlocking...' : 'Unlock'}
            </Button>
          </form>
        )}

        {step.kind === 'search' && (
          <>
            <SearchBox onSubmit={handleSearch}>
              <ModalBody>
                Search for an account to log in as it.
              </ModalBody>
              {stepError && <ErrorMsg>{stepError}</ErrorMsg>}
              <Input
                label="Search accounts"
                placeholder="Type a username..."
                value={query}
                onChange={(v) => {
                  setQuery(v);
                  setSearched(false);
                }}
                disabled={loading}
                autoFocus
              />
              <Button type="submit" fullWidth disabled={loading}>
                {loading ? 'Searching...' : 'Search'}
              </Button>
            </SearchBox>

            {results.length > 0 && (
              <ResultsList>
                {results.map((account) => (
                  <AdminRow key={account.id} onClick={() => handleAccess(account)}>
                    <AdminAvatar>
                      {account.avatar ? (
                        <img
                          src={account.avatar}
                          alt=""
                          style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
                        />
                      ) : (
                        account.username.slice(0, 1).toUpperCase()
                      )}
                    </AdminAvatar>
                    <AdminName>
                      <AdminUsername>{account.username}</AdminUsername>
                      <AdminMeta>Last seen {formatDate(account.last_sign_in_at)}</AdminMeta>
                    </AdminName>
                    {account.is_system ? <AdminBadge>System</AdminBadge> : null}
                  </AdminRow>
                ))}
              </ResultsList>
            )}

            {searched && !stepError && results.length === 0 && query && !loading && (
              <EmptyResults>
                No accounts found for &ldquo;{query.trim()}&rdquo;. Try a partial
                username, e.g. &ldquo;arn&rdquo;.
              </EmptyResults>
            )}
          </>
        )}
      </Modal>
    </ModalBackdrop>
  );
}

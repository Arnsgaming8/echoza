import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import styled from 'styled-components';
import { Button, Input, PasswordInput } from '../components/common';
import { useAuth } from '../contexts/AuthContext';
import { apiUrl } from '../utils/api';
import { withDeviceHeaders } from '../utils/deviceId';

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

const InactivityNotice = styled.div`
  display: flex;
  gap: 10px;
  align-items: flex-start;
  background: ${({ theme }) => theme.colors.secondary.warmGray}22;
  border: 1px solid ${({ theme }) => theme.colors.secondary.warmGray}66;
  color: ${({ theme }) => theme.colors.text.primary};
  padding: 12px 14px;
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: ${({ theme }) => theme.font.size.sm};
  line-height: 1.45;
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const InactivityNoticeIcon = styled.span`
  flex-shrink: 0;
  font-size: 18px;
  line-height: 1;
`;

const InactivityNoticeBody = styled.div`
  flex: 1;

  strong {
    display: block;
    font-weight: ${({ theme }) => theme.font.weight.bold};
    margin-bottom: 2px;
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

export default function Signup() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const validateUsername = (val: string) => {
    setUsername(val);
    
    
    
    const trimmed = val.trim();
    if (trimmed && !/^.{3,20}$/.test(trimmed)) {
      setUsernameError('Must be 3–20 characters');
    } else {
      setUsernameError('');
    }
  };

  const validatePassword = (val: string) => {
    setPassword(val);
    
    
    
    if (val.trim().length < 8) {
      setPasswordError('Must be at least 8 characters');
    } else {
      setPasswordError('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');

    if (usernameError || passwordError) return;
    if (!username || !password) {
      setServerError('Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      
      
      const res = await fetch(
        apiUrl('/api/auth/register'),
        withDeviceHeaders({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username.trim(), password: password.trim() }),
        }),
      );
      const data = await res.json();

      if (!res.ok) {
        setServerError(data.error || 'Registration failed');
        return;
      }

      login(data.token, data.refresh_token, data.user);
      try {
        localStorage.setItem('echoza-accountCreatedAt', new Date().toISOString());
        localStorage.removeItem('echoza-inactivityBannerDismissed');
      } catch {}
      navigate('/dashboard');
    } catch {
      setServerError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Wrapper>
      <Card>
        <Title>Create Account</Title>
        <Subtitle>Join Echoza and start connecting</Subtitle>
        <InactivityNotice>
          <InactivityNoticeIcon aria-hidden>⏱️</InactivityNoticeIcon>
          <InactivityNoticeBody>
            <strong>Heads up — accounts auto-delete after 2 weeks of inactivity</strong>
            If you don't sign in for 14 days, Echoza permanently deletes your account along with every conversation, message, contact, and token it contains. No recovery is possible. Sign in regularly to keep your account alive.
          </InactivityNoticeBody>
        </InactivityNotice>
        <Form onSubmit={handleSubmit}>
          {serverError && <ErrorMsg>{serverError}</ErrorMsg>}
          <Input
            label="Username"
            placeholder="Enter username (3–20 characters)"
            value={username}
            onChange={validateUsername}
            error={usernameError}
            disabled={loading}
          />
          <PasswordInput
            label="Password"
            placeholder="Enter password (8+ characters)"
            value={password}
            onChange={validatePassword}
            error={passwordError}
            disabled={loading}
          />
          <Button type="submit" fullWidth disabled={loading || !!usernameError || !!passwordError}>
            {loading ? 'Creating Account...' : 'Create Account'}
          </Button>
        </Form>
        <StyledLink to="/login">Already have an account? Log in</StyledLink>
      </Card>
    </Wrapper>
  );
}

import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import styled from 'styled-components';
import { Button, Input, PasswordInput } from '../components/common';
import { useAuth } from '../contexts/AuthContext';
import { apiUrl } from '../utils/api';

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

const ErrorMsg = styled.div`
  background: ${({ theme }) => theme.colors.danger}15;
  color: ${({ theme }) => theme.colors.danger};
  padding: 10px 14px;
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: ${({ theme }) => theme.font.size.sm};
  text-align: center;
`;

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  // Read the `next` query that ProtectedRoute encoded before redirecting
  // us here. After signin we replay it so a notification-tap user lands
  // back on `/dashboard?conv=ID` (closed-PWA push UX), not on a bare
  // dashboard. Reject any `next` that points back at /login to defuse a
  // redirect loop if some other path mis-encodes it.
  const [searchParams] = useSearchParams();
  const nextParam = searchParams.get('next');
  // FIX #22: Preserve URL hash if present. Previously only pathname+search
  // was encoded, silently dropping any #section fragment.
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
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setServerError(data.error || 'Login failed');
        return;
      }

      login(data.token, data.refresh_token, data.user);
      navigate(postLoginRedirect);
    } catch {
      setServerError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Wrapper>
      <Card>
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
        <StyledLink to="/signup">Don't have an account? Sign up</StyledLink>
      </Card>
    </Wrapper>
  );
}

import { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { Avatar, Button, PasswordInput } from '../common';
import { FiX, FiAlertTriangle, FiTrash2 } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { apiUrl } from '../../utils/api';

interface SettingsModalProps {
  onClose: () => void;
}

const shake = keyframes`
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
`;

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
  animation: fadeIn 0.2s ease;
`;

const Modal = styled.div`
  width: 420px;
  max-width: 92vw;
  max-height: 90vh;
  overflow-y: auto;
  background: ${({ theme }) => theme.colors.bg.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.lg};
  animation: fadeIn 0.3s ease;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${({ theme }) => theme.spacing.lg};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const Title = styled.h3`
  font-size: ${({ theme }) => theme.font.size.lg};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.colors.text.primary};
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

  &:hover {
    background: ${({ theme }) => theme.colors.bg.hover};
  }
`;

const Body = styled.div`
  padding: ${({ theme }) => theme.spacing.lg};
`;

const Section = styled.div`
  margin-bottom: ${({ theme }) => theme.spacing.xl};
`;

const SectionTitle = styled.h4`
  font-size: ${({ theme }) => theme.font.size.md};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.colors.text.primary};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const SectionDesc = styled.p`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  line-height: 1.5;
`;

const DangerBox = styled.div`
  background: rgba(255, 59, 92, 0.08);
  border: 1px solid rgba(255, 59, 92, 0.25);
  border-radius: ${({ theme }) => theme.radius.md};
  padding: ${({ theme }) => theme.spacing.md};
`;

const DangerHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: ${({ theme }) => theme.colors.danger || '#FF3B5C'};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  font-size: ${({ theme }) => theme.font.size.sm};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const ConfirmCheckbox = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
  cursor: pointer;
  padding: 4px 0;

  input {
    width: 16px;
    height: 16px;
    accent-color: ${({ theme }) => theme.colors.danger || '#FF3B5C'};
    cursor: pointer;
  }
`;

const ErrorMsg = styled.div`
  background: rgba(255, 59, 92, 0.1);
  color: ${({ theme }) => theme.colors.danger || '#FF3B5C'};
  padding: 10px 14px;
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: ${({ theme }) => theme.font.size.sm};
  text-align: center;
  animation: ${shake} 0.3s ease;
`;

const SuccessMsg = styled.div`
  background: rgba(58, 123, 255, 0.1);
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  padding: 10px 14px;
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: ${({ theme }) => theme.font.size.sm};
  text-align: center;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.lg};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;

const ProfileRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
  padding-bottom: ${({ theme }) => theme.spacing.lg};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const ProfileInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const ProfileName = styled.div`
  font-size: ${({ theme }) => theme.font.size.md};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.colors.text.primary};
`;

const ProfileLabel = styled.div`
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const { user, logout } = useAuth();
  const [step, setStep] = useState<'initial' | 'confirm'>('initial');
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const handleDelete = async () => {
    if (!password || !confirmed) return;
    setDeleting(true);
    setError('');

    try {
      const token = localStorage.getItem('echoza-token');
      const res = await fetch(apiUrl('/api/auth/delete-account'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to delete account');
        setDeleting(false);
        return;
      }

      setDeleted(true);
      setTimeout(() => {
        logout();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
      setDeleting(false);
    }
  };

  if (deleted) {
    return (
      <Overlay onClick={onClose}>
        <Modal onClick={e => e.stopPropagation()}>
          <Body style={{ textAlign: 'center', padding: '40px 24px' }}>
            <FiTrash2 size={40} style={{ color: '#FF3B5C', marginBottom: 16 }} />
            <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>Account Deleted</h3>
            <p style={{ color: '#888', fontSize: 14, margin: 0 }}>
              Your account has been permanently deleted. Redirecting...
            </p>
          </Body>
        </Modal>
      </Overlay>
    );
  }

  return (
    <Overlay onClick={onClose}>
      <Modal onClick={e => e.stopPropagation()}>
        <Header>
          <Title>Settings</Title>
          <CloseBtn onClick={onClose}>
            <FiX />
          </CloseBtn>
        </Header>

        <Body>
          <ProfileRow>
            <Avatar username={user?.username} src={user?.avatar} size={48} />
            <ProfileInfo>
              <ProfileName>{user?.username || 'User'}</ProfileName>
              <ProfileLabel>Your account</ProfileLabel>
            </ProfileInfo>
          </ProfileRow>

          {step === 'initial' ? (
            <Section>
              <SectionTitle>Account</SectionTitle>
              <SectionDesc>
                Manage your account settings. Deleting your account is permanent
                and cannot be undone.
              </SectionDesc>
              <Button
                variant="danger"
                onClick={() => setStep('confirm')}
                fullWidth
              >
                <FiTrash2 /> Delete account
              </Button>
            </Section>
          ) : (
            <Section>
              <SectionTitle style={{ color: '#FF3B5C' }}>
                <FiAlertTriangle style={{ verticalAlign: 'middle', marginRight: 6 }} />
                Delete Account
              </SectionTitle>
              <SectionDesc>
                This will permanently delete{' '}
                <strong>{user?.username}</strong> and all associated data.
                This action cannot be undone.
              </SectionDesc>

              <DangerBox>
                <DangerHeader>
                  <FiAlertTriangle size={16} />
                  Confirm deletion
                </DangerHeader>
                <PasswordInput
                  label="Enter your password to confirm"
                  placeholder="Your password"
                  value={password}
                  onChange={setPassword}
                />
                <div style={{ marginTop: 12 }}>
                  <ConfirmCheckbox>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={e => setConfirmed(e.target.checked)}
                    />
                    I understand this is permanent and cannot be undone
                  </ConfirmCheckbox>
                </div>
              </DangerBox>

              {error && <ErrorMsg style={{ marginTop: 12 }}>{error}</ErrorMsg>}
            </Section>
          )}
        </Body>

        {step === 'confirm' && (
          <Footer>
            <Button variant="secondary" onClick={() => { setStep('initial'); setPassword(''); setConfirmed(false); setError(''); }}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              disabled={deleting || !password || !confirmed}
            >
              {deleting ? 'Deleting...' : 'Permanently delete'}
            </Button>
          </Footer>
        )}
      </Modal>
    </Overlay>
  );
}

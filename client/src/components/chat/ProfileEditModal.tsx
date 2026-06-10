import { useState } from 'react';
import styled from 'styled-components';
import { Avatar, Button, Input } from '../common';
import { FiX } from 'react-icons/fi';

interface ProfileEditModalProps {
  currentUsername: string;
  socket: any;
  onClose: () => void;
  onUpdate: (newUsername: string) => void;
}

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
  width: 380px;
  background: ${({ theme }) => theme.colors.bg.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.lg};
  padding: ${({ theme }) => theme.spacing.xl};
  animation: fadeIn 0.3s ease;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${({ theme }) => theme.spacing.lg};
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

const AvatarSection = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const Form = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-top: ${({ theme }) => theme.spacing.lg};
`;

const SuccessMsg = styled.div`
  background: ${({ theme }) => theme.colors.secondary.mintGlow}20;
  color: ${({ theme }) => theme.colors.secondary.mintGlow};
  padding: 10px 14px;
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: ${({ theme }) => theme.font.size.sm};
  text-align: center;
`;

export default function ProfileEditModal({
  currentUsername,
  socket,
  onClose,
  onUpdate,
}: ProfileEditModalProps) {
  const [username, setUsername] = useState(currentUsername);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const validate = (val: string) => {
    setUsername(val);
    if (val && !/^[A-Za-z]{5,8}$/.test(val)) {
      setError('Must be 5–8 letters');
    } else {
      setError('');
    }
  };

  const handleSave = () => {
    if (!socket || error || !username) return;
    setSaving(true);

    socket.emit('profile:update', { username });

    socket.on('profile:updateResult', (result: { success?: boolean; error?: string; username?: string }) => {
      socket.off('profile:updateResult');
      setSaving(false);

      if (result.error) {
        setError(result.error);
        return;
      }

      setSuccess(true);
      onUpdate(result.username || username);
      setTimeout(onClose, 1000);
    });
  };

  return (
    <Overlay onClick={onClose}>
      <Modal onClick={e => e.stopPropagation()}>
        <Header>
          <Title>Edit Profile</Title>
          <CloseBtn onClick={onClose}>
            <FiX />
          </CloseBtn>
        </Header>

        <AvatarSection>
          <Avatar username={currentUsername} size={72} />
        </AvatarSection>

        <Form>
          {success && <SuccessMsg>Profile updated!</SuccessMsg>}
          <Input
            label="Username"
            placeholder="5–8 letters"
            value={username}
            onChange={validate}
            error={error}
          />
        </Form>

        <Footer>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !!error}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </Footer>
      </Modal>
    </Overlay>
  );
}

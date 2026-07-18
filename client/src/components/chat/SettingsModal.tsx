import { useState, useEffect } from 'react';
import styled, { keyframes } from 'styled-components';
import { Avatar, Button, PasswordInput } from '../common';
import { FiX, FiAlertTriangle, FiTrash2, FiBell, FiBellOff, FiSmartphone } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { apiUrl } from '../../utils/api';
import { isIOS, isIOSStandalone, canIOSReceivePush } from '../../utils/iosCapability';
import PairingHost from '../pair/PairingHost';

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

const NotifRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: ${({ theme }) => theme.colors.bg.hover};
  border-radius: ${({ theme }) => theme.radius.md};
  margin-bottom: 8px;
`;

const NotifIconBox = styled.div<{ $on?: boolean }>`
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: ${({ $on, theme }) =>
    $on ? theme.colors.primary.echoBlue : theme.colors.bg.card};
  color: ${({ $on }) => ($on ? 'white' : 'inherit')};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

const NotifText = styled.div`
  flex: 1;
  min-width: 0;
`;

const NotifTitle = styled.div`
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.colors.text.primary};
`;

const NotifDesc = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-top: 2px;
  line-height: 1.4;
`;

const StatusPill = styled.span<{ $kind: 'on' | 'off' | 'blocked' | 'unsupported' }>`
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: white;
  background: ${({ $kind }) =>
    $kind === 'on' ? '#22C55E'
    : $kind === 'off' ? '#F59E0B'
    : $kind === 'blocked' ? '#EF4444'
    : '#6B7280'};
`;

const InstallHint = styled.div`
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: ${({ theme }) => theme.colors.text.secondary};
  font-size: 12px;
  padding: 10px 12px;
  border-radius: ${({ theme }) => theme.radius.md};
  margin-bottom: 8px;
  line-height: 1.4;
`;

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const { user } = useAuth();
  const [step, setStep] = useState<'initial' | 'confirm'>('initial');
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);

  
  
  
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
  });
  const [subscribed, setSubscribed] = useState(false);
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifMsg, setNotifMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [showPairing, setShowPairing] = useState(false);

  const refreshNotifState = async () => {
    if (typeof Notification === 'undefined') {
      setPermission('unsupported');
      setSubscribed(false);
      return;
    }
    setPermission(Notification.permission);
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setSubscribed(!!sub);
      } catch {
        setSubscribed(false);
      }
    } else {
      setSubscribed(false);
    }
  };

  useEffect(() => { refreshNotifState(); }, []);

  const iOS = isIOS();
  const standalone = isIOSStandalone();
  const iosCapable = canIOSReceivePush(); // iOS + standalone + PushManager support

  const enableNotifications = async () => {
    setNotifMsg(null);
    setNotifBusy(true);
    try {
      if (iOS && !standalone) {
        setNotifMsg({ kind: 'err', text: 'Install Echoza to your home screen first (use Safari’s Share menu → Add to Home Screen), then re-open the installed app.' });
        return;
      }
      if (typeof Notification === 'undefined') {
        setNotifMsg({ kind: 'err', text: 'Notifications are not supported in this browser.' });
        return;
      }
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm === 'granted') {
        
        
        
        
        window.dispatchEvent(new Event('echoza:enable-push'));
        
        
        
        
        await new Promise(resolve => setTimeout(resolve, 600));
        await refreshNotifState();
        setNotifMsg({ kind: 'ok', text: 'Notifications enabled. Use “Send test push” to confirm.' });
      } else if (perm === 'denied') {
        setNotifMsg({ kind: 'err', text: 'Permission was denied. To re-enable, open Safari Settings → Safari → Notifications for this website.' });
      } else {
        setNotifMsg({ kind: 'err', text: 'No response from the permission prompt.' });
      }
    } catch (err: any) {
      setNotifMsg({ kind: 'err', text: `Error: ${err?.message || String(err)}` });
    } finally {
      setNotifBusy(false);
    }
  };

  const sendTestPush = async () => {
    setNotifMsg(null);
    setNotifBusy(true);
    try {
      const token = localStorage.getItem('echoza-token');
      const r = await fetch(apiUrl('/api/push/test'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) {
        setNotifMsg({ kind: 'err', text: data.error || `Server error ${r.status}` });
        return;
      }
      if (data.success === false && data.reason === 'no_subscriptions') {
        setNotifMsg({ kind: 'err', text: 'No push subscription yet. Tap “Enable notifications” first, then try again.' });
        return;
      }
      setNotifMsg({ kind: 'ok', text: `Test push sent to ${data.subscriptionCount ?? '?'} device(s). You should see an Echoza notification shortly.` });
    } catch (err: any) {
      setNotifMsg({ kind: 'err', text: `Network error: ${err?.message || String(err)}` });
    } finally {
      setNotifBusy(false);
    }
  };

  const permKind: 'on' | 'off' | 'blocked' =
    permission === 'granted' ? (subscribed ? 'on' : 'off')
    : permission === 'denied' ? 'blocked'
    : 'off';

  const handleDelete = async () => {
    
    
    
    const cleanPassword = password.trim();
    if (!cleanPassword || !confirmed) return;
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
        body: JSON.stringify({ password: cleanPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to delete account');
        setDeleting(false);
        return;
      }

      setDeleted(true);
      setTimeout(() => {
        window.location.href = 'https://echoza-5ysd.onrender.com/signup';
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

          <Section>
            <SectionTitle>Notifications</SectionTitle>
            <SectionDesc>
              Receive a push notification when someone messages or calls you.
            </SectionDesc>

            <NotifRow>
              <NotifIconBox $on={permKind === 'on'}>
                {permKind === 'on' ? <FiBell /> : <FiBellOff />}
              </NotifIconBox>
              <NotifText>
                <NotifTitle>
                  {permission === 'unsupported' && 'Notifications unsupported in this browser'}
                  {permKind === 'on' && 'Notifications are on'}
                  {permKind === 'off' && iOS && !standalone && 'Notifications require PWA install'}
                  {permKind === 'off' && !(iOS && !standalone) && 'Notifications are off'}
                  {permKind === 'blocked' && 'Notifications are blocked'}
                </NotifTitle>
                <NotifDesc>
                  {permKind === 'on' && `Subscribed to push${subscribed ? ' on this device' : ' on another device'}.`}
                  {permKind === 'off' && iOS && !standalone && 'Open this site in Safari, tap the Share button, then "Add to Home Screen". Open the installed app to grant notifications.'}
                  {permKind === 'off' && !(iOS && !standalone) && 'Tap "Enable notifications" to receive messages and calls.'}
                  {permKind === 'blocked' && 'To re-enable, change your notification settings for this website, then reload.'}
                  {permission === 'unsupported' && 'Try Chrome, Firefox, Edge, or install Echoza as a PWA on iOS.'}
                </NotifDesc>
              </NotifText>
              <StatusPill $kind={permKind}>
                {permission === 'granted' ? 'On' : permission === 'denied' ? 'Blocked' : permission === 'default' ? 'Off' : 'N/A'}
              </StatusPill>
            </NotifRow>

            {iOS && !standalone && (
              <InstallHint>
                iOS Safari restricts push notifications to apps installed to the home screen. Add Echoza to your home screen from the Share menu, then re-open the installed app.
              </InstallHint>
            )}

            <Button
              variant="primary"
              onClick={enableNotifications}
              disabled={notifBusy || permission === 'denied' || permission === 'unsupported'}
              fullWidth
              style={{ marginBottom: 8 }}
            >
              {permission === 'granted' ? 'Refresh notifications' : 'Enable notifications'}
            </Button>

            <Button
              variant="secondary"
              onClick={sendTestPush}
              disabled={notifBusy || permission !== 'granted'}
              fullWidth
            >
              Send test push
            </Button>

            {notifMsg && (
              <SuccessMsg
                style={{
                  marginTop: 12,
                  background: notifMsg.kind === 'ok' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                  color: notifMsg.kind === 'ok' ? '#22C55E' : '#EF4444',
                }}
              >
                {notifMsg.text}
              </SuccessMsg>
            )}
          </Section>

          <Section>
            <SectionTitle>
              <FiSmartphone style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Log In Any Other Device
            </SectionTitle>
            <SectionDesc>
              Pair a new phone, tablet, or laptop. The new device will get full access to your Echoza account — same conversations, contacts, and message history.
            </SectionDesc>
            <Button
              variant="primary"
              onClick={() => setShowPairing(true)}
              fullWidth
            >
              <FiSmartphone /> Start Device Log In
            </Button>
          </Section>

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
      {showPairing && <PairingHost onClose={() => setShowPairing(false)} />}
    </Overlay>
  );
}

import { useState, useEffect, useCallback } from 'react';
import styled, { keyframes } from 'styled-components';
import { FiBell, FiCamera, FiMic, FiCheck, FiX, FiSkipForward, FiCheckCircle } from 'react-icons/fi';
import { isIOS, isIOSStandalone } from '../../utils/iosCapability';

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const slideUp = keyframes`
  from { opacity: 0; transform: translateY(40px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
`;

const pulse = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
`;

const checkPop = keyframes`
  0% { transform: scale(0); opacity: 0; }
  50% { transform: scale(1.3); }
  100% { transform: scale(1); opacity: 1; }
`;

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9998;
  animation: ${fadeIn} 0.3s ease;
  backdrop-filter: blur(4px);
`;

const Card = styled.div`
  width: 400px;
  max-width: 90vw;
  background: ${({ theme }) => theme.colors.bg.card};
  border-radius: ${({ theme }) => theme.radius.xl};
  box-shadow: ${({ theme }) => theme.shadow.lg};
  overflow: hidden;
  animation: ${slideUp} 0.4s cubic-bezier(0.16, 1, 0.3, 1);
`;

const Header = styled.div`
  padding: ${({ theme }) => theme.spacing.xl} ${({ theme }) => theme.spacing.lg} ${({ theme }) => theme.spacing.sm};
  text-align: center;
`;

const Logo = styled.div`
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: ${({ theme }) => theme.colors.primary.echoBlue};
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
  font-size: 24px;
  font-weight: 800;
  color: white;
  letter-spacing: -1px;
  box-shadow: 0 4px 16px rgba(58, 123, 255, 0.3);
`;

const Title = styled.h2`
  font-size: ${({ theme }) => theme.font.size.lg};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.colors.text.primary};
  margin: 0 0 6px;
`;

const Subtitle = styled.p`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
  margin: 0;
  line-height: 1.5;
`;

const Steps = styled.div`
  padding: ${({ theme }) => theme.spacing.lg};
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const StepCard = styled.div<{ $state: 'pending' | 'active' | 'granted' | 'denied' | 'skipped' }>`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ $state, theme }) =>
    $state === 'active' ? `${theme.colors.primary.echoBlue}0d`
    : $state === 'granted' ? 'rgba(34, 197, 94, 0.08)'
    : $state === 'denied' ? 'rgba(239, 68, 68, 0.08)'
    : theme.colors.bg.hover};
  border: 1px solid ${({ $state, theme }) =>
    $state === 'active' ? `${theme.colors.primary.echoBlue}33`
    : $state === 'granted' ? 'rgba(34, 197, 94, 0.2)'
    : $state === 'denied' ? 'rgba(239, 68, 68, 0.2)'
    : 'transparent'};
  transition: all 0.3s ease;
  cursor: ${({ $state }) => $state === 'active' ? 'pointer' : 'default'};
  animation: ${({ $state }) => $state === 'active' ? pulse : 'none'} 2s ease-in-out infinite;
`;

const StepIcon = styled.div<{ $state: 'pending' | 'active' | 'granted' | 'denied' | 'skipped' }>`
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 18px;
  background: ${({ $state, theme }) =>
    $state === 'granted' ? 'rgba(34, 197, 94, 0.15)'
    : $state === 'denied' ? 'rgba(239, 68, 68, 0.15)'
    : $state === 'active' ? `${theme.colors.primary.echoBlue}15`
    : `${theme.colors.primary.echoBlue}08`};
  color: ${({ $state }) =>
    $state === 'granted' ? '#22C55E'
    : $state === 'denied' ? '#EF4444'
    : $state === 'active' ? '#3A7BFF'
    : '#A7A9B0'};
`;

const StepInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const StepName = styled.div`
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.colors.text.primary};
`;

const StepDesc = styled.div`
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-top: 2px;
`;

const StepBadge = styled.div<{ $kind: 'granted' | 'denied' | 'skipped' | 'pending' }>`
  font-size: 11px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  color: white;
  background: ${({ $kind }) =>
    $kind === 'granted' ? '#22C55E'
    : $kind === 'denied' ? '#EF4444'
    : $kind === 'skipped' ? '#6B7280'
    : '#D1D5DB'};
  animation: ${({ $kind }) => $kind === 'granted' ? checkPop : 'none'} 0.4s cubic-bezier(0.16, 1, 0.3, 1);
`;

const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.md} ${({ theme }) => theme.spacing.lg} ${({ theme }) => theme.spacing.lg};
`;

const SkipBtn = styled.button`
  background: transparent;
  border: none;
  color: ${({ theme }) => theme.colors.text.secondary};
  font-size: ${({ theme }) => theme.font.size.sm};
  padding: 8px 16px;
  border-radius: ${({ theme }) => theme.radius.sm};
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 6px;

  &:hover {
    background: ${({ theme }) => theme.colors.bg.hover};
    color: ${({ theme }) => theme.colors.text.primary};
  }
`;

const ActionBtn = styled.button<{ $variant?: 'primary' | 'green' }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 24px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  cursor: pointer;
  transition: all 0.2s ease;
  background: ${({ $variant, theme }) =>
    $variant === 'green' ? '#22C55E' : theme.colors.primary.echoBlue};
  color: white;
  box-shadow: ${({ $variant }) =>
    $variant === 'green'
      ? '0 2px 8px rgba(34, 197, 94, 0.3)'
      : '0 2px 8px rgba(58, 123, 255, 0.3)'};

  &:hover {
    transform: translateY(-1px);
    filter: brightness(1.1);
  }

  &:active {
    transform: translateY(0);
  }
`;

const DoneIcon = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 16px 0;
`;

const PERMISSIONS_KEY = 'echoza-permissionsAsked';
const CAMERA_MIC_KEY = 'echoza-cameraMicAsked';

interface PermissionState {
  notification: 'pending' | 'granted' | 'denied' | 'skipped' | 'unsupported';
  cameraMic: 'pending' | 'granted' | 'denied' | 'skipped' | 'unsupported';
}

type StepId = 'notification' | 'cameraMic';

export default function PermissionOnboarding() {
  const [visible, setVisible] = useState(false);
  const [done, setDone] = useState(false);
  const [currentStep, setCurrentStep] = useState<StepId | null>(null);
  const [busy, setBusy] = useState(false);
  const [perms, setPerms] = useState<PermissionState>({
    notification: 'pending',
    cameraMic: 'pending',
  });

  useEffect(() => {
    const asked = localStorage.getItem(PERMISSIONS_KEY);
    if (asked === '1') return;

    const notifState = getNotifState();
    const camState = getCameraMicAsked();

    const notifSettled = notifState !== 'pending';
    const camSettled = camState !== 'pending';

    if (notifSettled && camSettled) {
      localStorage.setItem(PERMISSIONS_KEY, '1');
      return;
    }

    setPerms({
      notification: notifState,
      cameraMic: camState,
    });

    const firstStep: StepId | null = notifState === 'pending' ? 'notification'
      : camState === 'pending' ? 'cameraMic'
      : null;

    if (firstStep) {
      setCurrentStep(firstStep);
      setVisible(true);
    }
  }, []);

  function getNotifState(): PermissionState['notification'] {
    if (typeof Notification === 'undefined') return 'unsupported';
    const p = Notification.permission;
    if (p === 'granted') return 'granted';
    if (p === 'denied') return 'denied';
    return 'pending';
  }

  function getCameraMicAsked(): PermissionState['cameraMic'] {
    const val = localStorage.getItem(CAMERA_MIC_KEY);
    if (val === 'granted') return 'granted';
    if (val === 'denied') return 'denied';
    return 'pending';
  }

  const requestNotification = useCallback(async () => {
    if (typeof Notification === 'undefined') {
      setPerms(p => ({ ...p, notification: 'unsupported' }));
      moveNext('notification', 'unsupported');
      return;
    }
    if (isIOS() && !isIOSStandalone()) {
      setPerms(p => ({ ...p, notification: 'skipped' }));
      moveNext('notification', 'skipped');
      return;
    }
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        setPerms(p => ({ ...p, notification: 'granted' }));
        moveNext('notification', 'granted');
        window.dispatchEvent(new Event('echoza:enable-push'));
      } else if (perm === 'denied') {
        setPerms(p => ({ ...p, notification: 'denied' }));
        moveNext('notification', 'denied');
      } else {
        setPerms(p => ({ ...p, notification: 'skipped' }));
        moveNext('notification', 'skipped');
      }
    } catch {
      setPerms(p => ({ ...p, notification: 'skipped' }));
      moveNext('notification', 'skipped');
    } finally {
      setBusy(false);
    }
  }, []);

  const requestCameraMic = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setPerms(p => ({ ...p, cameraMic: 'unsupported' }));
      moveNext('cameraMic', 'unsupported');
      return;
    }
    if (isIOS() && !isIOSStandalone()) {
      localStorage.setItem(CAMERA_MIC_KEY, 'skipped');
      setPerms(p => ({ ...p, cameraMic: 'skipped' }));
      moveNext('cameraMic', 'skipped');
      return;
    }
    setBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach(t => t.stop());
      localStorage.setItem(CAMERA_MIC_KEY, 'granted');
      setPerms(p => ({ ...p, cameraMic: 'granted' }));
      moveNext('cameraMic', 'granted');
    } catch (err: any) {
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        localStorage.setItem(CAMERA_MIC_KEY, 'denied');
        setPerms(p => ({ ...p, cameraMic: 'denied' }));
        moveNext('cameraMic', 'denied');
      } else {
        localStorage.setItem(CAMERA_MIC_KEY, 'skipped');
        setPerms(p => ({ ...p, cameraMic: 'skipped' }));
        moveNext('cameraMic', 'skipped');
      }
    } finally {
      setBusy(false);
    }
  }, []);

  function moveNext(step: StepId, result: string) {
    const notifState = step === 'notification' ? result : perms.notification;
    const camState = step === 'cameraMic' ? result : perms.cameraMic;

    const notifDone = notifState !== 'pending' && notifState !== 'active';
    const camDone = camState !== 'pending' && camState !== 'active';

    const notifSettled = notifDone || getNotifState() !== 'pending';
    const camSettled = camDone || getCameraMicAsked() !== 'pending';

    if (notifSettled && camSettled) {
      localStorage.setItem(PERMISSIONS_KEY, '1');
      setDone(true);
      setTimeout(() => setVisible(false), 800);
      return;
    }

    if (!notifDone && getNotifState() === 'pending') {
      setCurrentStep('notification');
      setPerms(p => ({ ...p, notification: 'pending' as const }));
    } else if (!camDone && getCameraMicAsked() === 'pending') {
      setCurrentStep('cameraMic');
      setPerms(p => ({ ...p, cameraMic: 'pending' as const }));
    } else {
      localStorage.setItem(PERMISSIONS_KEY, '1');
      setDone(true);
      setTimeout(() => setVisible(false), 800);
    }
  }

  const handleSkip = () => {
    if (currentStep === 'notification') {
      setPerms(p => ({ ...p, notification: 'skipped' }));
      moveNext('notification', 'skipped');
    } else {
      setPerms(p => ({ ...p, cameraMic: 'skipped' }));
      moveNext('cameraMic', 'skipped');
    }
  };

  const handleDismissAll = () => {
    localStorage.setItem(PERMISSIONS_KEY, '1');
    if (currentStep === 'cameraMic') {
      localStorage.setItem(CAMERA_MIC_KEY, 'skipped');
    }
    setVisible(false);
  };

  if (!visible) return null;

  const notifBadge: 'granted' | 'denied' | 'skipped' | 'pending' =
    perms.notification === 'granted' ? 'granted'
    : perms.notification === 'denied' ? 'denied'
    : perms.notification === 'skipped' || perms.notification === 'unsupported' ? 'skipped'
    : 'pending';

  const camBadge: 'granted' | 'denied' | 'skipped' | 'pending' =
    perms.cameraMic === 'granted' ? 'granted'
    : perms.cameraMic === 'denied' ? 'denied'
    : perms.cameraMic === 'skipped' || perms.cameraMic === 'unsupported' ? 'skipped'
    : 'pending';

  const allDone = done || (
    (notifBadge !== 'pending') && (camBadge !== 'pending')
  );

  return (
    <Overlay>
      <Card>
        {allDone ? (
          <>
            <Header>
              <DoneIcon>
                <FiCheckCircle size={48} color="#22C55E" style={{ animation: `${checkPop} 0.5s cubic-bezier(0.16, 1, 0.3, 1)` }} />
              </DoneIcon>
              <Title>All set!</Title>
              <Subtitle>You can always change permissions later in Settings.</Subtitle>
            </Header>
            <Footer style={{ justifyContent: 'center' }}>
              <ActionBtn onClick={handleDismissAll}>
                <FiCheck /> Got it
              </ActionBtn>
            </Footer>
          </>
        ) : (
          <>
            <Header>
              <Logo>E</Logo>
              <Title>Enable features</Title>
              <Subtitle>
                Grant permissions to get the most out of Echoza — messages, calls, and notifications.
              </Subtitle>
            </Header>

            <Steps>
              <StepCard
                $state={currentStep === 'notification' ? 'active' : notifBadge}
                onClick={() => {
                  if (!busy && currentStep === 'notification' && notifBadge === 'pending') {
                    requestNotification();
                  }
                }}
              >
                <StepIcon $state={currentStep === 'notification' ? 'active' : notifBadge}>
                  <FiBell />
                </StepIcon>
                <StepInfo>
                  <StepName>Notifications</StepName>
                  <StepDesc>
                    {notifBadge === 'pending' && 'Get alerted when you receive messages or calls'}
                    {notifBadge === 'granted' && 'You\'ll receive message and call alerts'}
                    {notifBadge === 'denied' && 'Permission blocked — enable in browser settings'}
                    {notifBadge === 'skipped' && 'Skipped — enable anytime in Settings'}
                  </StepDesc>
                </StepInfo>
                <StepBadge $kind={notifBadge}>
                  {notifBadge === 'granted' ? 'On'
                    : notifBadge === 'denied' ? 'Blocked'
                    : notifBadge === 'skipped' ? 'Skip'
                    : 'Off'}
                </StepBadge>
              </StepCard>

              <StepCard
                $state={currentStep === 'cameraMic' ? 'active' : camBadge}
                onClick={() => {
                  if (!busy && currentStep === 'cameraMic' && camBadge === 'pending') {
                    requestCameraMic();
                  }
                }}
              >
                <StepIcon $state={currentStep === 'cameraMic' ? 'active' : camBadge}>
                  <FiCamera />
                </StepIcon>
                <StepInfo>
                  <StepName>Camera &amp; Microphone</StepName>
                  <StepDesc>
                    {camBadge === 'pending' && 'Required for audio and video calls'}
                    {camBadge === 'granted' && 'Audio and video calls are ready'}
                    {camBadge === 'denied' && 'Permission blocked — enable in browser settings'}
                    {camBadge === 'skipped' && 'Skipped — enable anytime in Settings'}
                  </StepDesc>
                </StepInfo>
                <StepBadge $kind={camBadge}>
                  {camBadge === 'granted' ? 'On'
                    : camBadge === 'denied' ? 'Blocked'
                    : camBadge === 'skipped' ? 'Skip'
                    : 'Off'}
                </StepBadge>
              </StepCard>
            </Steps>

            <Footer>
              <SkipBtn onClick={handleDismissAll}>
                <FiX /> Not now
              </SkipBtn>
              {currentStep && (
                <SkipBtn onClick={handleSkip} style={{ color: '#6B7280' }}>
                  <FiSkipForward /> Skip this
                </SkipBtn>
              )}
              {currentStep === 'notification' && !busy && (
                <ActionBtn onClick={requestNotification}>
                  <FiBell /> Allow notifications
                </ActionBtn>
              )}
              {currentStep === 'cameraMic' && !busy && (
                <ActionBtn onClick={requestCameraMic}>
                  <FiCamera /> <FiMic /> Allow camera &amp; mic
                </ActionBtn>
              )}
              {busy && (
                <ActionBtn disabled style={{ opacity: 0.6 }}>
                  Requesting...
                </ActionBtn>
              )}
            </Footer>
          </>
        )}
      </Card>
    </Overlay>
  );
}

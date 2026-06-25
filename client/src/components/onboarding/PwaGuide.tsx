import { useState, useEffect } from 'react';
import styled, { keyframes } from 'styled-components';

const slideUp = keyframes`
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
`;

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: flex-end;
  animation: fadeIn 0.2s ease;
`;

const Sheet = styled.div`
  background: ${({ theme }) => theme.colors.bg.main};
  border-radius: 16px 16px 0 0;
  padding: 24px 20px 36px;
  animation: ${slideUp} 0.3s ease;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
`;

const Handle = styled.div`
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255,255,255,0.2);
  margin: 0 auto 20px;
`;

const Title = styled.h2`
  font-size: ${({ theme }) => theme.font.size.xl};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.colors.text.primary};
  margin-bottom: 8px;
`;

const Subtitle = styled.p`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-bottom: 24px;
  line-height: 1.5;
`;

const Step = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
`;

const StepIconBox = styled.div`
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: ${({ theme }) => theme.colors.bg.hover};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid ${({ theme }) => theme.colors.border};
`;

const StepContent = styled.div``;

const StepNum = styled.div`
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  margin-bottom: 2px;
`;

const StepText = styled.p`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.colors.text.primary};
  line-height: 1.4;
`;

const CloseBtn = styled.button`
  width: 100%;
  padding: 14px;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.primary.echoBlue};
  color: white;
  font-size: ${({ theme }) => theme.font.size.md};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  margin-top: 8px;
  transition: opacity 0.2s;
  &:hover { opacity: 0.9; }
`;

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !('windowControlsOverlay' in navigator);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches;
}

function ShareIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <rect x="5" y="14" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M13 2v12M8 7l5-5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26">
      <rect x="2" y="2" width="22" height="22" rx="4" fill="currentColor" opacity="0.15" />
      <path d="M13 7v12M7 13h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26">
      <rect x="2" y="2" width="22" height="22" rx="4" fill="currentColor" opacity="0.15" />
      <path d="M7 13l4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export default function PwaGuide() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isIOS()) return;
    if (isStandalone()) return;
    const timer = setTimeout(() => setVisible(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => setVisible(false);

  if (!visible) return null;

  return (
    <Overlay onClick={dismiss}>
      <Sheet onClick={e => e.stopPropagation()}>
        <Handle />
        <Title>Add Echoza to Home Screen</Title>
        <Subtitle>Install Echoza on your iPhone for the best experience — faster loading, push notifications, and full-screen chat.</Subtitle>

        <Step>
          <StepIconBox><ShareIcon /></StepIconBox>
          <StepContent>
            <StepNum>Step 1</StepNum>
            <StepText>Tap the <strong>Share</strong> icon <ShareIcon /> at the bottom of Safari.</StepText>
          </StepContent>
        </Step>

        <Step>
          <StepIconBox><PlusIcon /></StepIconBox>
          <StepContent>
            <StepNum>Step 2</StepNum>
            <StepText>Scroll down and tap <strong>Add to Home Screen</strong> <PlusIcon />.</StepText>
          </StepContent>
        </Step>

        <Step>
          <StepIconBox><CheckIcon /></StepIconBox>
          <StepContent>
            <StepNum>Step 3</StepNum>
            <StepText>Tap <strong>Add</strong> in the top-right corner. Open Echoza from your home screen!</StepText>
          </StepContent>
        </Step>

        <CloseBtn onClick={dismiss}>Got it!</CloseBtn>
      </Sheet>
    </Overlay>
  );
}
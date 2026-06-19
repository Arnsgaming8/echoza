import { useState, useEffect } from 'react';
import styled, { keyframes } from 'styled-components';
import { FiShare2, FiPlus, FiX } from 'react-icons/fi';

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

const StepIcon = styled.div`
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.primary.echoBlue}20;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  flex-shrink: 0;
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

const DismissText = styled.button`
  display: block;
  margin: 12px auto 0;
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.colors.text.secondary};
  text-decoration: underline;
  opacity: 0.6;
`;

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !('windowControlsOverlay' in navigator);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches;
}

const STORAGE_KEY = 'echoza-pwa-guide-dismissed';

export default function PwaGuide() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (dismissed) return;
    if (!isIOS()) return;
    if (isStandalone()) return;
    const timer = setTimeout(() => setVisible(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <Overlay onClick={dismiss}>
      <Sheet onClick={e => e.stopPropagation()}>
        <Handle />
        <Title>Add Echoza to Home Screen</Title>
        <Subtitle>Install Echoza on your iPhone for the best experience — faster loading, push notifications, and full-screen chat.</Subtitle>

        <Step>
          <StepIcon><FiShare2 /></StepIcon>
          <StepContent>
            <StepNum>Step 1</StepNum>
            <StepText>Tap the <strong>Share</strong> icon at the bottom of Safari.</StepText>
          </StepContent>
        </Step>

        <Step>
          <StepIcon><FiPlus /></StepIcon>
          <StepContent>
            <StepNum>Step 2</StepNum>
            <StepText>Scroll down and tap <strong>Add to Home Screen</strong>.</StepText>
          </StepContent>
        </Step>

        <Step>
          <StepIcon><FiX /></StepIcon>
          <StepContent>
            <StepNum>Step 3</StepNum>
            <StepText>Tap <strong>Add</strong> in the top-right corner. Open Echoza from your home screen!</StepText>
          </StepContent>
        </Step>

        <CloseBtn onClick={dismiss}>Got it!</CloseBtn>
        <DismissText onClick={dismiss}>Don't show again</DismissText>
      </Sheet>
    </Overlay>
  );
}
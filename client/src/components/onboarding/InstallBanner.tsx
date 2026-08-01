import { useState, useEffect, useRef } from 'react';
import styled, { keyframes } from 'styled-components';

const slideUp = keyframes`
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
`;

const Overlay = styled.div<{ $visible: boolean }>`
  position: fixed;
  inset: 0;
  z-index: 9998;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  pointer-events: ${({ $visible }) => ($visible ? 'auto' : 'none')};
  transition: opacity 0.25s ease;
`;

const Sheet = styled.div`
  position: relative;
  background: ${({ theme }) => theme.colors.bg.card};
  border-radius: 16px 16px 0 0;
  padding: 24px 20px 36px;
  animation: ${slideUp} 0.3s ease;
  width: 100%;
  max-width: 420px;
  max-height: 85vh;
  overflow-y: auto;
`;

const Handle = styled.div`
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: ${({ theme }) => theme.colors.border};
  margin: 0 auto 20px;
`;

const Title = styled.h2`
  font-size: 18px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text.primary};
  margin-bottom: 6px;
  text-align: center;
`;

const Subtitle = styled.p`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-bottom: 24px;
  line-height: 1.5;
  text-align: center;
`;

const Step = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 18px;
`;

const StepNum = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.primary.echoBlue};
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  flex-shrink: 0;
`;

const StepText = styled.p`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text.primary};
  line-height: 1.5;
  padding-top: 3px;
  strong {
    font-weight: 600;
    color: ${({ theme }) => theme.colors.primary.echoBlue};
  }
`;

const HighlightBox = styled.div`
  background: ${({ theme }) => theme.colors.bg.hover};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  padding: 12px 14px;
  margin: 16px 0;
  display: flex;
  align-items: center;
  gap: 10px;
`;

const HighlightIcon = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.primary.echoBlue}22;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: ${({ theme }) => theme.colors.primary.echoBlue};
`;

const HighlightText = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
  line-height: 1.4;
  strong {
    color: ${({ theme }) => theme.colors.text.primary};
    font-weight: 600;
  }
`;

const BtnRow = styled.div`
  display: flex;
  gap: 10px;
  margin-top: 8px;
`;

const PrimaryBtn = styled.button`
  flex: 1;
  padding: 13px;
  border-radius: 10px;
  background: ${({ theme }) => theme.colors.primary.echoBlue};
  color: white;
  font-size: 14px;
  font-weight: 600;
  transition: opacity 0.2s;
  &:hover { opacity: 0.9; }
`;

const SecondaryBtn = styled.button`
  padding: 13px 18px;
  border-radius: 10px;
  background: ${({ theme }) => theme.colors.bg.hover};
  color: ${({ theme }) => theme.colors.text.secondary};
  font-size: 14px;
  font-weight: 500;
  border: 1px solid ${({ theme }) => theme.colors.border};
  transition: opacity 0.2s;
  &:hover { opacity: 0.8; }
`;

const CloseX = styled.button`
  position: absolute;
  top: 16px;
  right: 16px;
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.text.secondary};
  font-size: 20px;
  cursor: pointer;
  padding: 4px;
  line-height: 1;
`;

const BrowserBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.primary.echoBlue}18;
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 12px;
  margin-left: auto;
  margin-right: auto;
  display: flex;
  width: fit-content;
`;

const STORAGE_KEY = 'echoza-install-dismissed';
const PIN_STORAGE_KEY = 'echoza-pin-dismissed';

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as any).standalone === true;
}

function detectBrowser(): 'firefox' | 'chrome' | 'edge' | 'safari' | 'other' {
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'safari';
  return 'other';
}

function FirefoxIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="9" fill="#FF7139" opacity="0.15" />
      <path d="M10 2a8 8 0 0 0-3 15.4V12.5a4.5 4.5 0 0 1 4.5-4.5h.2A8 8 0 0 0 10 2z" fill="#FF7139" />
    </svg>
  );
}

function ChromeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="9" fill="#4285F4" opacity="0.15" />
      <circle cx="10" cy="10" r="4" fill="#4285F4" />
      <path d="M10 6a4 4 0 0 1 3.46 2l3-5.2A8 8 0 0 0 10 2a8 8 0 0 0-6.93 4l3 5.2A4 4 0 0 1 10 6z" fill="#EA4335" />
      <path d="M6.07 6A8 8 0 0 0 10 18l3-5.2A4 4 0 0 1 6 10a4 4 0 0 1 .07-4z" fill="#34A853" />
      <path d="M13.46 8A4 4 0 0 1 14 10a4 4 0 0 1-.54 2L10 18a8 8 0 0 0 6.46-10l-3-5.2z" fill="#FBBC05" />
    </svg>
  );
}

function EdgeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="9" fill="#0078D4" opacity="0.15" />
      <path d="M10 2a8 8 0 0 1 7.5 5.3A5 5 0 0 0 8 5.5 5 5 0 0 0 5 10c0 2.8 2.2 5 5 5h5a5 5 0 0 0 0-10h-5z" fill="#0078D4" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L12 22" />
      <path d="M17 7L12 2L7 7" />
      <circle cx="12" cy="17" r="3" />
    </svg>
  );
}

export default function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [visible, setVisible] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [showPinPrompt, setShowPinPrompt] = useState(false);
  const [browser] = useState(detectBrowser);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (isStandalone()) return;
    if (localStorage.getItem(STORAGE_KEY)) return;

    if (browser === 'firefox' || browser === 'edge') {
      const timer = setTimeout(() => {
        if (mountedRef.current) setVisible(true);
      }, 3000);
      return () => { mountedRef.current = false; clearTimeout(timer); };
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      if (mountedRef.current) setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    const onAppInstalled = () => {
      setInstalled(true);
      setVisible(false);
      setDeferredPrompt(null);
      localStorage.setItem(STORAGE_KEY, '1');
      if (!localStorage.getItem(PIN_STORAGE_KEY)) {
        setShowPinPrompt(true);
      }
    };

    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      mountedRef.current = false;
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, [browser]);

  const handleChromeInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') {
      setInstalled(true);
      setVisible(false);
      localStorage.setItem(STORAGE_KEY, '1');
      if (!localStorage.getItem(PIN_STORAGE_KEY)) {
        setShowPinPrompt(true);
      }
    }
    setDeferredPrompt(null);
  };

  const dismiss = () => {
    setVisible(false);
    setDeferredPrompt(null);
    localStorage.setItem(STORAGE_KEY, '1');
    if ((browser === 'firefox' || browser === 'edge') && !localStorage.getItem(PIN_STORAGE_KEY)) {
      setTimeout(() => setShowPinPrompt(true), 800);
    }
  };

  const dismissPin = () => {
    setShowPinPrompt(false);
    localStorage.setItem(PIN_STORAGE_KEY, '1');
  };

  const browserName = browser === 'firefox' ? 'Firefox'
    : browser === 'edge' ? 'Edge'
    : browser === 'chrome' ? 'Chrome'
    : browser === 'safari' ? 'Safari'
    : 'your browser';

  const BrowserBadgeIcon = browser === 'firefox' ? <FirefoxIcon />
    : browser === 'edge' ? <EdgeIcon />
    : <ChromeIcon />;

  return (
    <>
      <Overlay $visible={visible && !installed} onClick={dismiss}>
        <Sheet onClick={e => e.stopPropagation()}>
          <CloseX onClick={dismiss}>×</CloseX>
          <Handle />
          <BrowserBadge>{BrowserBadgeIcon} {browserName}</BrowserBadge>
          <Title>Install Echoza</Title>
          <Subtitle>
            Add Echoza to your device for the fastest experience — instant open, push notifications, and works offline.
          </Subtitle>

          {browser === 'firefox' && (
            <>
              <Step>
                <StepNum>1</StepNum>
                <StepText>
                  Click the <strong>install icon</strong> (⊕) in the address bar, or open the <strong>hamburger menu ☰</strong> and select <strong>"Install Echoza"</strong>.
                </StepText>
              </Step>
              <Step>
                <StepNum>2</StepNum>
                <StepText>
                  Confirm the install when the popup appears. Echoza will open in its own window.
                </StepText>
              </Step>
              <HighlightBox>
                <HighlightIcon><PinIcon /></HighlightIcon>
                <HighlightText>
                  <strong>Pin to taskbar:</strong> Right-click the Echoza icon in your taskbar and select <strong>"Pin to Taskbar"</strong> for quick access.
                </HighlightText>
              </HighlightBox>
            </>
          )}

          {browser === 'edge' && (
            <>
              <Step>
                <StepNum>1</StepNum>
                <StepText>
                  Click the <strong>install icon</strong> (⊕) in the address bar, or open the <strong>⋯ menu</strong> and select <strong>"Install Echoza"</strong>.
                </StepText>
              </Step>
              <Step>
                <StepNum>2</StepNum>
                <StepText>
                  Confirm the install. Echoza will open in its own window.
                </StepText>
              </Step>
              <HighlightBox>
                <HighlightIcon><PinIcon /></HighlightIcon>
                <HighlightText>
                  <strong>Pin to taskbar:</strong> Right-click the Echoza icon in your taskbar and select <strong>"Pin to Taskbar"</strong>.
                </HighlightText>
              </HighlightBox>
            </>
          )}

          {(browser === 'chrome' || browser === 'other') && deferredPrompt && (
            <>
              <Step>
                <StepNum>1</StepNum>
                <StepText>Click the button below to install Echoza.</StepText>
              </Step>
              <Step>
                <StepNum>2</StepNum>
                <StepText>
                  Confirm the install. Echoza will open in its own window.
                </StepText>
              </Step>
              <HighlightBox>
                <HighlightIcon><PinIcon /></HighlightIcon>
                <HighlightText>
                  <strong>Pin to taskbar:</strong> Right-click the Echoza icon in your taskbar and select <strong>"Pin to Taskbar"</strong>.
                </HighlightText>
              </HighlightBox>
            </>
          )}

          {(browser === 'chrome' || browser === 'other') && !deferredPrompt && (
            <Step>
              <StepNum>!</StepNum>
              <StepText>
                Your browser doesn't support automatic install. Try <strong>Chrome</strong> or <strong>Edge</strong> for the best PWA experience.
              </StepText>
            </Step>
          )}

          <BtnRow>
            {(browser === 'chrome' || browser === 'other') && deferredPrompt ? (
              <PrimaryBtn onClick={handleChromeInstall}>Install Now</PrimaryBtn>
            ) : (
              <PrimaryBtn onClick={dismiss}>Got it</PrimaryBtn>
            )}
            <SecondaryBtn onClick={dismiss}>Not now</SecondaryBtn>
          </BtnRow>
        </Sheet>
      </Overlay>

      <Overlay $visible={showPinPrompt} onClick={dismissPin}>
        <Sheet onClick={e => e.stopPropagation()}>
          <CloseX onClick={dismissPin}>×</CloseX>
          <Handle />
          <Title>📌 Pin Echoza to Taskbar</Title>
          <Subtitle>
            Keep Echoza one click away — pin it to your taskbar for instant access.
          </Subtitle>

          <Step>
            <StepNum>1</StepNum>
            <StepText>
              <strong>Right-click</strong> the Echoza icon in your taskbar.
            </StepText>
          </Step>
          <Step>
            <StepNum>2</StepNum>
            <StepText>
              Select <strong>"Pin to Taskbar"</strong> from the menu.
            </StepText>
          </Step>
          <Step>
            <StepNum>3</StepNum>
            <StepText>
              Done! Echoza will now stay in your taskbar even when closed.
            </StepText>
          </Step>

          <HighlightBox>
            <HighlightIcon>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
            </HighlightIcon>
            <HighlightText>
              On <strong>Windows</strong>, you can also drag the Echoza icon from your desktop to the taskbar.
            </HighlightText>
          </HighlightBox>

          <PrimaryBtn onClick={dismissPin} style={{ width: '100%', marginTop: 8 }}>
            Got it!
          </PrimaryBtn>
        </Sheet>
      </Overlay>
    </>
  );
}

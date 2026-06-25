import { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';

const Banner = styled.div<{ $visible: boolean }>`
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 9998;
  background: ${({ theme }) => theme.colors.bg.card};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  padding: 12px 16px;
  padding-bottom: max(12px, env(safe-area-inset-bottom));
  display: flex;
  align-items: center;
  gap: 12px;
  transform: translateY(${({ $visible }) => ($visible ? '0' : '100%')});
  transition: transform 0.3s ease;
`;

const Info = styled.div`
  flex: 1;
  min-width: 0;
`;

const AppName = styled.div`
  font-weight: 600;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const AppDesc = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-top: 1px;
`;

const Icon = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: ${({ theme }) => theme.colors.primary.echoBlue};
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 18px;
  color: white;
  flex-shrink: 0;
`;

const InstallBtn = styled.button`
  padding: 8px 18px;
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.primary.echoBlue};
  color: white;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  transition: opacity 0.2s;
  &:hover { opacity: 0.9; }
`;

const CloseBtn = styled.button`
  font-size: 18px;
  color: ${({ theme }) => theme.colors.text.secondary};
  opacity: 0.5;
  padding: 4px;
`;

const STORAGE_KEY = 'echoza-install-dismissed';

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as any).standalone === true;
}

export default function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [visible, setVisible] = useState(false);
  const [installed, setInstalled] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (isStandalone()) return;
    if (localStorage.getItem(STORAGE_KEY)) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    const onAppInstalled = () => {
      setInstalled(true);
      setVisible(false);
      setDeferredPrompt(null);
      localStorage.setItem(STORAGE_KEY, '1');
    };

    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      mountedRef.current = false;
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') {
      setInstalled(true);
      setVisible(false);
      localStorage.setItem(STORAGE_KEY, '1');
    }
    setDeferredPrompt(null);
  };

  const dismiss = () => {
    setVisible(false);
    setDeferredPrompt(null);
    localStorage.setItem(STORAGE_KEY, '1');
  };

  if (!visible || installed) return null;

  return (
    <Banner $visible={visible}>
      <Icon>E</Icon>
      <Info>
        <AppName>Echoza</AppName>
        <AppDesc>Install for the best experience</AppDesc>
      </Info>
      <InstallBtn onClick={handleInstall}>Install</InstallBtn>
      <CloseBtn onClick={dismiss}>✕</CloseBtn>
    </Banner>
  );
}

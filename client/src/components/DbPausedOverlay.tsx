import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { apiUrl } from '../utils/api';

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  background: ${({ theme }) => theme.colors.bg.main};
  z-index: 99999;
  padding: 32px;
  text-align: center;
`;

const Logo = styled.h1`
  font-size: 28px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  letter-spacing: -0.5px;
`;

const Message = styled.p`
  font-size: 18px;
  line-height: 1.6;
  color: ${({ theme }) => theme.colors.text.secondary};
  max-width: 480px;
`;

const PhoneLink = styled.a`
  font-size: 20px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  text-decoration: none;
  &:hover { text-decoration: underline; }
`;

const RetryHint = styled.p`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
  opacity: 0.6;
  margin-top: 16px;
`;

let notified = false;

export default function DbPausedOverlay({ children }: { children: React.ReactNode }) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      try {
        const res = await fetch(apiUrl('/api/db-status'));
        const data = await res.json();
        const isPaused = data.status === 'paused';

        if (mounted) {
          setPaused(isPaused);
        }

        if (isPaused && !notified && 'Notification' in window && Notification.permission === 'granted') {
          notified = true;
          new Notification('Echoza — Database Paused', {
            body: 'Please contact the Developer: 319-359-5613',
            icon: '/vite.svg',
          });
        }
      } catch {
        if (mounted) setPaused(false);
      }
    };

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    check();
    const interval = setInterval(check, 30_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  if (paused) {
    return (
      <Overlay>
        <Logo>Echoza</Logo>
        <Message>
          Database is paused.
          <br />
          Please contact the Developer:
        </Message>
        <PhoneLink href="tel:+13193595613">319-359-5613</PhoneLink>
        <Message>Thank you for your understanding.</Message>
        <RetryHint>Auto-retrying every 30 seconds…</RetryHint>
      </Overlay>
    );
  }

  return <>{children}</>;
}

import { useEffect, useState } from 'react';
import styled from 'styled-components';

const STORAGE_KEY = 'echoza:logout:reason';

const Banner = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  margin: 0 auto;
  max-width: 720px;
  padding: 14px 20px;
  background: ${({ theme }) => theme.colors.danger}15;
  border-bottom: 1px solid ${({ theme }) => theme.colors.danger}55;
  color: ${({ theme }) => theme.colors.danger};
  font-size: ${({ theme }) => theme.font.size.sm};
  line-height: 1.5;
  text-align: center;
  animation: fadeIn 0.35s ease;
  backdrop-filter: blur(8px);

  body.dark-mode & {
    background: ${({ theme }) => theme.colors.danger}22;
  }
`;

const Reason =
  'Echoza logs you out every 30 days for security purposes. Please sign back in to continue.';

/**
 * One-shot banner that reads `sessionStorage['echoza:logout:reason']` on
 * mount. If the value is `session_expired_30_days` (set by AuthContext
 * after a 30-day rolling expiry 401), displays the explanation and
 * CLEARS the flag so a refresh doesn't re-render it. Renders nothing
 * otherwise.
 */
export default function SessionExpiredBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === 'session_expired_30_days') {
        setVisible(true);
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* sessionStorage may throw on disabled cookies — fail silent */
    }
  }, []);

  if (!visible) return null;
  return <Banner role="alert">{Reason}</Banner>;
}

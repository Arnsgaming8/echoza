import styled, { keyframes } from 'styled-components';

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const pulse = keyframes`
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
`;

const fadeIn = keyframes`
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
`;

const fadeOut = keyframes`
  from { opacity: 1; }
  to { opacity: 0; }
`;

const Wrapper = styled.div<{ $hiding: boolean }>`
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
  background: ${({ theme }) => theme.colors.bg.main};
  animation: ${({ $hiding }) => $hiding ? fadeOut : 'none'} 0.35s ease forwards;
  pointer-events: ${({ $hiding }) => $hiding ? 'none' : 'auto'};
`;

const LogoImg = styled.img`
  width: 72px;
  height: 72px;
  animation: ${spin} 1.2s linear infinite;
  filter: drop-shadow(0 0 20px rgba(58, 123, 255, 0.25));
`;

const LogoText = styled.h1`
  font-size: 32px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  letter-spacing: -0.5px;
  animation: ${fadeIn} 0.5s ease forwards;
`;

const Text = styled.p`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
  animation: ${pulse} 1.5s ease-in-out infinite;
`;

interface LoadingScreenProps {
  visible: boolean;
}

export default function LoadingScreen({ visible }: LoadingScreenProps) {
  return (
    <Wrapper $hiding={!visible}>
      <LogoImg src="/vite.svg" alt="Echoza" />
      <LogoText>Echoza</LogoText>
      <Text>Loading...</Text>
    </Wrapper>
  );
}

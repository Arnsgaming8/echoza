import styled, { keyframes } from 'styled-components';

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const pulse = keyframes`
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
`;

const Wrapper = styled.div`
  height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  background: ${({ theme }) => theme.colors.bg.main};
`;

const Spinner = styled.div`
  width: 40px;
  height: 40px;
  border: 3px solid ${({ theme }) => theme.colors.border};
  border-top-color: ${({ theme }) => theme.colors.primary.echoBlue};
  border-radius: 50%;
  animation: ${spin} 0.8s linear infinite;
`;

const Text = styled.p`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
  animation: ${pulse} 1.5s ease-in-out infinite;
`;

const Logo = styled.h1`
  font-size: 28px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  letter-spacing: -0.5px;
`;

export default function LoadingScreen() {
  return (
    <Wrapper>
      <Logo>Echoza</Logo>
      <Spinner />
      <Text>Loading...</Text>
    </Wrapper>
  );
}

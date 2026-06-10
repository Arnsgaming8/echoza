import styled, { keyframes } from 'styled-components';

const bounce = keyframes`
  0%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-8px); }
`;

const Wrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  animation: fadeIn 0.2s ease;
`;

const Dots = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  background: ${({ theme }) => theme.colors.bubble.received};
  border-radius: ${({ theme }) => theme.radius.lg};
  border-bottom-left-radius: 4px;
`;

const Dot = styled.span<{ $delay: number }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.secondary.warmGray};
  animation: ${bounce} 1.4s ease infinite;
  animation-delay: ${({ $delay }) => $delay}s;
`;

const Label = styled.span`
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

interface TypingIndicatorProps {
  username: string;
}

export default function TypingIndicator({ username }: TypingIndicatorProps) {
  return (
    <Wrapper>
      <Dots>
        <Dot $delay={0} />
        <Dot $delay={0.2} />
        <Dot $delay={0.4} />
      </Dots>
      <Label>{username} is typing...</Label>
    </Wrapper>
  );
}

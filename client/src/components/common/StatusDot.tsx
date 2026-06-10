import styled from 'styled-components';

const Dot = styled.span<{ $online: boolean }>`
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: ${({ $online, theme }) =>
    $online ? theme.colors.secondary.mintGlow : theme.colors.secondary.warmGray};
  transition: background 0.3s ease;
  flex-shrink: 0;
`;

interface StatusDotProps {
  online: boolean;
}

export default function StatusDot({ online }: StatusDotProps) {
  return <Dot $online={online} />;
}

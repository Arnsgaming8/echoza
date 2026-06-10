import styled from 'styled-components';

const StyledBadge = styled.span<{ $count: number }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: ${({ theme }) => theme.colors.primary.echoBlue};
  color: white;
  font-size: 11px;
  font-weight: ${({ theme }) => theme.font.weight.bold};
  line-height: 1;
  animation: fadeIn 0.2s ease;
`;

interface BadgeProps {
  count: number;
}

export default function Badge({ count }: BadgeProps) {
  if (count <= 0) return null;
  return <StyledBadge $count={count}>{count > 99 ? '99+' : count}</StyledBadge>;
}

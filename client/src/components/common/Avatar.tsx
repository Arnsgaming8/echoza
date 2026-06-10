import styled from 'styled-components';

interface AvatarProps {
  src?: string;
  username?: string;
  size?: number;
  online?: boolean;
  onClick?: () => void;
}

const Wrapper = styled.div<{ $size: number; $onClick?: () => void }>`
  position: relative;
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  flex-shrink: 0;
  cursor: ${({ $onClick }) => ($onClick ? 'pointer' : 'default')};
`;

const Image = styled.img<{ $size: number }>`
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  border-radius: 50%;
  object-fit: cover;
  background: ${({ theme }) => theme.colors.primary.echoBlue};
`;

const Fallback = styled.div<{ $size: number }>`
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.primary.echoBlue};
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: ${({ $size }) => Math.max($size * 0.4, 14)}px;
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  text-transform: uppercase;
`;

const Dot = styled.span<{ $online: boolean; $size: number }>`
  position: absolute;
  bottom: 1px;
  right: 1px;
  width: ${({ $size }) => Math.max($size * 0.25, 8)}px;
  height: ${({ $size }) => Math.max($size * 0.25, 8)}px;
  border-radius: 50%;
  background: ${({ $online, theme }) =>
    $online ? theme.colors.secondary.mintGlow : theme.colors.secondary.warmGray};
  border: 2px solid ${({ theme }) => theme.colors.bg.sidebar};
  transition: background 0.3s ease;
`;

export default function Avatar({ src, username, size = 40, online, onClick }: AvatarProps) {
  return (
    <Wrapper $size={size} $onClick={onClick}>
      {src ? (
        <Image src={src} alt={username} $size={size} />
      ) : (
        <Fallback $size={size}>{username?.[0] || '?'}</Fallback>
      )}
      {online !== undefined && <Dot $online={online} $size={size} />}
    </Wrapper>
  );
}

import styled, { css } from 'styled-components';

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  style?: React.CSSProperties;
}

const variants = {
  primary: css`
    background: ${({ theme }) => theme.colors.primary.echoBlue};
    color: white;
    &:hover:not(:disabled) {
      filter: brightness(1.1);
      box-shadow: ${({ theme }) => theme.shadow.glow};
    }
  `,
  secondary: css`
    background: ${({ theme }) => theme.colors.bg.hover};
    color: ${({ theme }) => theme.colors.text.primary};
    &:hover:not(:disabled) {
      background: ${({ theme }) => theme.colors.border};
    }
  `,
  ghost: css`
    background: transparent;
    color: ${({ theme }) => theme.colors.text.primary};
    &:hover:not(:disabled) {
      background: ${({ theme }) => theme.colors.bg.hover};
    }
  `,
  danger: css`
    background: ${({ theme }) => theme.colors.danger};
    color: white;
    &:hover:not(:disabled) {
      filter: brightness(1.1);
    }
  `,
};

const sizes = {
  sm: css`
    padding: 6px 14px;
    font-size: ${({ theme }) => theme.font.size.sm};
  `,
  md: css`
    padding: 10px 20px;
    font-size: ${({ theme }) => theme.font.size.md};
  `,
  lg: css`
    padding: 14px 28px;
    font-size: ${({ theme }) => theme.font.size.lg};
  `,
};

const StyledButton = styled.button<{
  $variant: string;
  $size: string;
  $fullWidth?: boolean;
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: ${({ theme }) => theme.radius.md};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  transition: all ${({ theme }) => theme.transition};
  width: ${({ $fullWidth }) => ($fullWidth ? '100%' : 'auto')};
  white-space: nowrap;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  ${({ $variant }) => variants[$variant as keyof typeof variants]}
  ${({ $size }) => sizes[$size as keyof typeof sizes]}
`;

export default function Button({
  variant = 'primary',
  size = 'md',
  fullWidth,
  disabled,
  children,
  onClick,
  type = 'button',
  style,
}: ButtonProps) {
  return (
    <StyledButton
      $variant={variant}
      $size={size}
      $fullWidth={fullWidth}
      disabled={disabled}
      onClick={onClick}
      type={type}
      style={style}
    >
      {children}
    </StyledButton>
  );
}

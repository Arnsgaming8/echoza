import styled from 'styled-components';

interface InputProps {
  label?: string;
  placeholder?: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  autoFocus?: boolean;
}

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
`;

const Label = styled.label`
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const StyledInput = styled.input<{ $hasError?: boolean }>`
  padding: 12px 16px;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.bg.input};
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: ${({ theme }) => theme.font.size.md};
  border: 1.5px solid ${({ theme, $hasError }) =>
    $hasError ? theme.colors.danger : 'transparent'};
  transition: all ${({ theme }) => theme.transition};

  &::placeholder {
    color: ${({ theme }) => theme.colors.secondary.warmGray};
  }

  &:focus {
    border-color: ${({ theme }) => theme.colors.primary.echoBlue};
    box-shadow: 0 0 0 3px ${({ theme }) => theme.colors.primary.echoBlue}22;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ErrorText = styled.span`
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.colors.danger};
  animation: fadeIn 0.2s ease;
`;

export default function Input({
  label,
  placeholder,
  type = 'text',
  value,
  onChange,
  error,
  disabled,
  onKeyDown,
  autoFocus,
}: InputProps) {
  return (
    <Wrapper>
      {label && <Label>{label}</Label>}
      <StyledInput
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        $hasError={!!error}
        disabled={disabled}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
      />
      {error && <ErrorText>{error}</ErrorText>}
    </Wrapper>
  );
}

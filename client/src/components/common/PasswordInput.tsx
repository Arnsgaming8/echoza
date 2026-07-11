import styled from 'styled-components';
import { FiEye, FiEyeOff } from 'react-icons/fi';
import { useState } from 'react';
import Input from './Input';

interface PasswordInputProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

const PasswordWrapper = styled.div`
  position: relative;
  width: 100%;
`;

const EyeBtn = styled.button`
  position: absolute;
  right: 12px;
  top: 34px;
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.secondary.warmGray};
  font-size: 18px;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: color ${({ theme }) => theme.transition};

  &:hover {
    color: ${({ theme }) => theme.colors.text.primary};
  }

  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary.echoBlue};
    outline-offset: 2px;
    border-radius: 4px;
  }
`;

export default function PasswordInput({
  label,
  placeholder,
  value,
  onChange,
  error,
  disabled,
}: PasswordInputProps) {
  const [show, setShow] = useState(false);

  return (
    <PasswordWrapper>
      <Input
        label={label}
        placeholder={placeholder}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        error={error}
        disabled={disabled}
      />
      <EyeBtn
        type="button"
        onClick={() => setShow(!show)}
        aria-label={show ? 'Hide password' : 'Show password'}
        tabIndex={0}
      >
        {show ? <FiEyeOff /> : <FiEye />}
      </EyeBtn>
    </PasswordWrapper>
  );
}

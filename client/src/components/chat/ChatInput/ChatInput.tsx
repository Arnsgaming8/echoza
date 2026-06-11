import { useState, useRef, useEffect } from 'react';
import styled from 'styled-components';
import { FiSend, FiPaperclip, FiX, FiFile, FiImage, FiVideo, FiTrash2, FiCheck } from 'react-icons/fi';

interface Attachment {
  file: File;
  preview?: string;
  type: 'image' | 'video' | 'audio' | 'file';
}

interface ChatInputProps {
  onSend: (content: string, attachments?: Attachment[]) => void;
  onTypingStart: () => void;
  onTypingStop: () => void;
  disabled?: boolean;
  deleteMode?: boolean;
  selectedCount?: number;
  onToggleDeleteMode?: () => void;
  onDeleteSelected?: () => void;
}

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bg.sidebar};
`;

const PreviewBar = styled.div`
  display: flex;
  gap: 8px;
  padding: 8px 16px 0;
  overflow-x: auto;
  flex-wrap: wrap;
`;

const PreviewItem = styled.div`
  position: relative;
  width: 60px;
  height: 60px;
  border-radius: ${({ theme }) => theme.radius.md};
  overflow: hidden;
  background: ${({ theme }) => theme.colors.bg.hover};
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.2s ease;
`;

const PreviewImg = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const FileIcon = styled.div`
  font-size: 24px;
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  display: flex;
`;

const RemoveBtn = styled.button`
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.8;
  }
`;

const InputRow = styled.div`
  display: flex;
  align-items: flex-end;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.md};

  @media (max-width: 768px) {
    padding: 8px;
  }
`;

const InputWrapper = styled.div`
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.colors.bg.input};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 4px 4px 4px 4px;
`;

const AttachBtn = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: ${({ theme }) => theme.colors.secondary.warmGray};
  font-size: 18px;
  transition: all ${({ theme }) => theme.transition};
  flex-shrink: 0;

  &:hover {
    background: ${({ theme }) => theme.colors.bg.hover};
    color: ${({ theme }) => theme.colors.text.primary};
  }
`;

const TextInput = styled.textarea`
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: ${({ theme }) => theme.font.size.sm};
  resize: none;
  max-height: 120px;
  padding: 8px 0;
  line-height: 1.4;

  &::placeholder {
    color: ${({ theme }) => theme.colors.secondary.warmGray};
  }

  &::-webkit-scrollbar {
    width: 4px;
  }
`;

const SendButton = styled.button<{ $hasContent: boolean }>`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${({ $hasContent, theme }) =>
    $hasContent ? theme.colors.primary.echoBlue : theme.colors.bg.hover};
  color: ${({ $hasContent, theme }) =>
    $hasContent ? 'white' : theme.colors.secondary.warmGray};
  font-size: 16px;
  transition: all ${({ theme }) => theme.transition};
  flex-shrink: 0;

  &:hover {
    background: ${({ $hasContent, theme }) =>
      $hasContent ? theme.colors.primary.echoBlue : theme.colors.border};
  }
`;

const HiddenInput = styled.input`
  display: none;
`;

const DeleteBar = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px;
  flex-shrink: 0;
`;

const DeleteBarText = styled.span`
  flex: 1;
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const DeleteBarBtn = styled.button<{ $danger?: boolean }>`
  height: 36px;
  padding: 0 16px;
  border-radius: ${({ theme }) => theme.radius.md};
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  background: ${({ $danger, theme }) =>
    $danger ? '#FF3B5C' : 'transparent'};
  color: ${({ $danger }) => ($danger ? 'white' : 'inherit')};

  &:hover {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

export default function ChatInput({ onSend, onTypingStart, onTypingStop, disabled, deleteMode, selectedCount, onToggleDeleteMode, onDeleteSelected }: ChatInputProps) {
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const typingTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isTyping = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [content]);

  const handleChange = (val: string) => {
    setContent(val);

    if (!isTyping.current) {
      isTyping.current = true;
      onTypingStart();
    }

    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      isTyping.current = false;
      onTypingStop();
    }, 2000);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newAttachments: Attachment[] = files.map(file => {
const type = file.type.startsWith('image/') ? 'image' as const
  : file.type.startsWith('video/') ? 'video' as const
  : file.type.startsWith('audio/') ? 'audio' as const
  : 'file' as const;
const preview = type === 'image' ? URL.createObjectURL(file) : undefined;
      return { file, preview, type };
    });
    setAttachments(prev => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => {
      const item = prev[index];
      if (item.preview) URL.revokeObjectURL(item.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSend = () => {
    const trimmed = content.trim();
    if ((!trimmed && attachments.length === 0) || disabled) return;
    onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    setContent('');
    setAttachments([]);
    isTyping.current = false;
    onTypingStop();
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const fileIcon = (type: string) => {
    switch (type) {
      case 'image': return <FiImage />;
      case 'video': return <FiVideo />;
      case 'audio': return <FiFile />;
      default: return <FiFile />;
    }
  };

  const hasContent = !!content.trim() || attachments.length > 0;

  return (
    <Wrapper>
      {attachments.length > 0 && (
        <PreviewBar>
          {attachments.map((att, i) => (
            <PreviewItem key={i}>
              {att.type === 'image' && att.preview ? (
                <PreviewImg src={att.preview} alt={att.file.name} />
              ) : (
                <FileIcon>{fileIcon(att.type)}</FileIcon>
              )}
              <RemoveBtn onClick={() => removeAttachment(i)}>
                <FiX />
              </RemoveBtn>
            </PreviewItem>
          ))}
        </PreviewBar>
      )}
      <InputRow>
        <InputWrapper>
          {deleteMode && (
            <DeleteBar>
              <DeleteBarText>{selectedCount} message{selectedCount !== 1 ? 's' : ''} selected</DeleteBarText>
              <DeleteBarBtn onClick={onToggleDeleteMode}>
                <FiX size={14} />
              </DeleteBarBtn>
              <DeleteBarBtn $danger disabled={!selectedCount} onClick={onDeleteSelected}>
                <FiTrash2 size={14} /> Delete
              </DeleteBarBtn>
            </DeleteBar>
          )}
          <AttachBtn onClick={() => fileInputRef.current?.click()} title="Attach file">
            <FiPaperclip />
          </AttachBtn>
          <TextInput
            ref={textareaRef}
            placeholder={deleteMode ? 'Select messages to delete...' : 'Type a message...'}
            value={content}
            onChange={e => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={disabled}
          />
          <SendButton
            $hasContent={hasContent}
            onClick={handleSend}
            disabled={disabled}
          >
            <FiSend />
          </SendButton>
        </InputWrapper>
        <HiddenInput
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.zip"
          onChange={handleFileSelect}
        />
      </InputRow>
    </Wrapper>
  );
}

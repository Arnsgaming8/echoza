import React from 'react';
import styled from 'styled-components';
import { useAuth } from '../../../contexts/AuthContext';
import { FiFile, FiImage, FiVideo, FiDownload, FiCheckCircle, FiCircle } from 'react-icons/fi';

interface Attachment {
  name: string;
  type: 'image' | 'video' | 'audio' | 'file';
  mime: string;
  size: number;
  data?: string;
}

interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderUsername?: string;
  content: string;
  attachments?: Attachment[];
  read: boolean;
  createdAt: string;
  isGroup?: boolean;
}

interface MessageBubbleProps {
  message: Message;
  showSenderName?: boolean;
  deleteMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (messageId: string) => void;
}

const Wrapper = styled.div<{ $isSent: boolean }>`
  display: flex;
  justify-content: ${({ $isSent }) => ($isSent ? 'flex-end' : 'flex-start')};
  animation: fadeIn 0.3s ease;
  margin-bottom: 4px;
  align-items: flex-start;
  gap: 6px;
`;

const BubbleWrapper = styled.div<{ $isSent: boolean }>`
  max-width: 70%;
  display: flex;
  flex-direction: column;
  align-items: ${({ $isSent }) => ($isSent ? 'flex-end' : 'flex-start')};

  @media (max-width: 768px) {
    max-width: 85%;
  }
`;

const SenderName = styled.span`
  font-size: 11px;
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  margin-bottom: 2px;
  margin-left: 4px;
`;

const Bubble = styled.div<{ $isSent: boolean }>`
  padding: 10px 16px;
  border-radius: ${({ theme }) => theme.radius.lg};
  background: ${({ $isSent, theme }) =>
    $isSent ? theme.colors.bubble.sent : theme.colors.bubble.received};
  color: ${({ $isSent, theme }) =>
    $isSent ? theme.colors.text.white : theme.colors.text.primary};
  border-bottom-${({ $isSent }) => ($isSent ? 'right' : 'left')}-radius: 4px;
  word-wrap: break-word;
  white-space: pre-wrap;
  line-height: 1.4;
  position: relative;
`;

const AttachmentGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 6px;
`;

const ImageAtt = styled.img`
  max-width: 100%;
  max-height: 200px;
  border-radius: ${({ theme }) => theme.radius.sm};
  cursor: pointer;
  object-fit: cover;
  display: block;
`;

const FileAtt = styled.a<{ $isSent: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: ${({ $isSent }) => ($isSent ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.05)')};
  color: inherit;
  text-decoration: none;
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.8;
  }
`;

const FileIconWrap = styled.div`
  font-size: 22px;
  display: flex;
`;

const FileInfo = styled.div`
  min-width: 0;
`;

const FileName = styled.div`
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const FileSize = styled.div`
  font-size: 11px;
  opacity: 0.7;
`;

const BubbleText = styled.div``;

const MetaRow = styled.div<{ $isSent: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  justify-content: ${({ $isSent }) => ($isSent ? 'flex-end' : 'flex-start')};
  padding: 0 4px;
`;

const Time = styled.span<{ $isSent: boolean }>`
  font-size: 11px;
  color: ${({ $isSent, theme }) =>
    $isSent ? theme.colors.secondary.warmGray : theme.colors.secondary.warmGray};
`;

const ReadLabel = styled.span<{ $read: boolean }>`
  font-size: 11px;
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ $read, theme }) =>
    $read ? theme.colors.primary.echoBlue : theme.colors.secondary.warmGray};
`;

const AudioPlayer = styled.audio`
  max-width: 100%;
  height: 40px;
`;

const Checkbox = styled.button`
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: transparent;
  color: ${({ theme }) => theme.colors.primary.echoBlue};
  font-size: 18px;
  flex-shrink: 0;
  margin-top: 4px;
`;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attIcon(type: string) {
  switch (type) {
    case 'image': return <FiImage />;
    case 'video': return <FiVideo />;
    default: return <FiFile />;
  }
}

function linkify(text: string) {
  const urlRegex = /(https?:\/\/[^\s<]+|[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s<]*)?)/gi;
  const parts: (string | React.ReactNode)[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    let url = match[0];
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    parts.push(<a key={match.index} href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{match[0]}</a>);
    lastIndex = urlRegex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length ? parts : text;
}

export default function MessageBubble({ message, showSenderName, deleteMode, isSelected, onToggleSelect }: MessageBubbleProps) {
  const { user } = useAuth();
  const isSent = message.senderId === user?.id;

  const formatTime = (timeStr: string) => {
    const date = new Date(timeStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <Wrapper $isSent={isSent}>
      {deleteMode && isSent && (
        <Checkbox onClick={() => onToggleSelect?.(message.id)}>
          {isSelected ? <FiCheckCircle /> : <FiCircle />}
        </Checkbox>
      )}
      <BubbleWrapper $isSent={isSent}>
        {showSenderName && !isSent && message.senderUsername && (
          <SenderName>{message.senderUsername}</SenderName>
        )}
        <Bubble $isSent={isSent}>
          {message.attachments && message.attachments.length > 0 && (
            <AttachmentGrid>
              {message.attachments.map((att, i) => (
                att.type === 'image' && att.data ? (
                  <ImageAtt key={i} src={att.data} alt={att.name} />
                ) : att.type === 'video' && att.data ? (
                  <video controls style={{ maxWidth: '100%', maxHeight: 200, borderRadius: '8px' }}>
                    <source src={att.data} type={att.mime} />
                  </video>
                ) : att.type === 'audio' && att.data ? (
                  <AudioPlayer controls src={att.data}>
                    <source src={att.data} type={att.mime} />
                  </AudioPlayer>
                ) : (
                  <FileAtt key={i} href={att.data || '#'} download={att.name} $isSent={isSent}>
                    <FileIconWrap>{attIcon(att.type)}</FileIconWrap>
                    <FileInfo>
                      <FileName>{att.name}</FileName>
                      <FileSize>{formatFileSize(att.size)}</FileSize>
                    </FileInfo>
                    <FiDownload style={{ marginLeft: 'auto', opacity: 0.6 }} />
                  </FileAtt>
                )
              ))}
            </AttachmentGrid>
          )}
          {message.content && <BubbleText>{linkify(message.content)}</BubbleText>}
        </Bubble>
        <MetaRow $isSent={isSent}>
          <Time $isSent={isSent}>{formatTime(message.createdAt)}</Time>
          {isSent && (
            <ReadLabel $read={message.read}>
              {message.read ? 'Read' : 'Sent'}
            </ReadLabel>
          )}
        </MetaRow>
      </BubbleWrapper>
    </Wrapper>
  );
}

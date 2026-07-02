import { useState, useEffect, useRef } from 'react';
import styled, { keyframes } from 'styled-components';
import { Avatar } from '../../common';
import { FiPhone, FiPhoneOff, FiChevronDown, FiMessageSquare, FiBell } from 'react-icons/fi';

const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(52, 199, 89, 0.5); }
  50% { box-shadow: 0 0 0 40px rgba(52, 199, 89, 0); }
  100% { box-shadow: 0 0 0 0 rgba(52, 199, 89, 0); }
`;

const slideUp = keyframes`
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
`;

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: linear-gradient(180deg, #1a1a2e 0%, #0f0f1a 40%, #000 100%);
  display: flex;
  flex-direction: column;
  z-index: 1001;
  overflow: hidden;
`;

const TopSpacer = styled.div`
  flex: 1;
`;

const CenterContent = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  animation: ${slideUp} 0.4s ease;
`;

const AvatarGlow = styled.div`
  animation: ${pulse} 2s ease infinite;
  border-radius: 50%;
  display: flex;
`;

const CallerName = styled.h1`
  color: #fff;
  font-size: 32px;
  font-weight: 700;
  margin: 8px 0 0;
  letter-spacing: -0.5px;
`;

const CallTypeLabel = styled.p`
  color: rgba(255,255,255,0.7);
  font-size: 17px;
  font-weight: 400;
  margin: 0;
`;

const BottomActions = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 40px 0 60px;
  animation: ${slideUp} 0.4s ease 0.15s both;
`;

const MainButtons = styled.div`
  display: flex;
  align-items: center;
  gap: 60px;
`;

const AcceptBtn = styled.button`
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: #34c759;
  color: white;
  font-size: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s ease, background 0.15s ease;
  box-shadow: 0 4px 20px rgba(52, 199, 89, 0.3);

  &:hover {
    transform: scale(1.08);
    background: #28a745;
  }

  &:active {
    transform: scale(0.95);
  }
`;

const DeclineBtn = styled.button`
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: #ff3b30;
  color: white;
  font-size: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s ease, background 0.15s ease;
  box-shadow: 0 4px 20px rgba(255, 59, 48, 0.3);

  &:hover {
    transform: scale(1.08);
    background: #d62d20;
  }

  &:active {
    transform: scale(0.95);
  }
`;

const AcceptLabel = styled.span`
  color: #34c759;
  font-size: 12px;
  font-weight: 500;
  text-align: center;
  display: block;
  margin-top: 4px;
`;

const DeclineLabel = styled.span`
  color: #ff3b30;
  font-size: 12px;
  font-weight: 500;
  text-align: center;
  display: block;
  margin-top: 4px;
`;

const ButtonGroup = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const SecondaryActions = styled.div`
  display: flex;
  align-items: center;
  gap: 60px;
  margin-top: 8px;
`;

const SecondaryBtn = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: rgba(255,255,255,0.8);
  font-size: 12px;
  font-weight: 400;
  padding: 8px 16px;
  border-radius: 20px;
  transition: background 0.15s, color 0.15s;

  &:hover {
    background: rgba(255,255,255,0.08);
    color: #fff;
  }

  &:active {
    background: rgba(255,255,255,0.12);
  }
`;

const SecondaryIcon = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255,255,255,0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: rgba(255,255,255,0.9);
`;

const BottomSwipeHint = styled.div`
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255,255,255,0.3);
  font-size: 20px;
  animation: pulse 2s ease infinite;
`;

interface IncomingCallProps {
  caller: { id: string; username: string; avatar: string };
  type: 'audio' | 'video';
  onAccept: () => void;
  onDecline: () => void;
}

export default function IncomingCall({ caller, type, onAccept, onDecline }: IncomingCallProps) {
  const ringtoneRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      const now = ctx.currentTime;
      for (let i = 0; i < 300; i++) {
        const cycle = Math.floor(i / 3);
        const step = i % 3;
        const t = now + i * 0.2;
        const on = step < 2;
        gain.gain.setValueAtTime(on ? 0.25 : 0, t);
        gain.gain.linearRampToValueAtTime(on ? 0.25 : 0, t + 0.18);
        osc.frequency.setValueAtTime(on ? (step === 0 ? 523 : 659) : 0, t);
      }
      ringtoneRef.current = { stop: () => { try { osc.stop(); gain.disconnect(); ctx.close(); } catch {} } };
    } catch {}
    return () => { ringtoneRef.current?.stop(); };
  }, []);

  return (
    <Overlay>
      <TopSpacer />
      <CenterContent>
        <AvatarGlow>
          <Avatar username={caller.username} src={caller.avatar} size={100} />
        </AvatarGlow>
        <CallerName>{caller.username}</CallerName>
        <CallTypeLabel>FaceTime {type === 'video' ? 'Video' : 'Audio'}</CallTypeLabel>
      </CenterContent>
      <BottomActions>
        <MainButtons>
          <ButtonGroup>
            <DeclineBtn onClick={onDecline}>
              <FiPhoneOff />
            </DeclineBtn>
            <DeclineLabel>Decline</DeclineLabel>
          </ButtonGroup>
          <ButtonGroup>
            <AcceptBtn onClick={onAccept}>
              <FiPhone />
            </AcceptBtn>
            <AcceptLabel>Accept</AcceptLabel>
          </ButtonGroup>
        </MainButtons>
        <SecondaryActions>
          <SecondaryBtn onClick={onDecline}>
            <SecondaryIcon><FiBell /></SecondaryIcon>
            Remind Me
          </SecondaryBtn>
          <SecondaryBtn onClick={onDecline}>
            <SecondaryIcon><FiMessageSquare /></SecondaryIcon>
            Message
          </SecondaryBtn>
        </SecondaryActions>
      </BottomActions>
      <BottomSwipeHint>
        <FiChevronDown />
      </BottomSwipeHint>
    </Overlay>
  );
}

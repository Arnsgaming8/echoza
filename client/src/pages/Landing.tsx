import { useState, useEffect } from 'react';
import styled, { keyframes } from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/common';

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => theme.colors.bg.main};
  position: relative;
  overflow: hidden;
`;

const HeroSection = styled.div`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${({ theme }) => theme.spacing.xl};
  position: relative;
  overflow: hidden;
`;

const BackgroundGlow = styled.div`
  position: absolute;
  width: 600px;
  height: 600px;
  border-radius: 50%;
  background: radial-gradient(circle, ${({ theme }) => theme.colors.primary.echoBlue}15, transparent 70%);
  top: -200px;
  right: -200px;
  pointer-events: none;
`;

const BackgroundGlow2 = styled.div`
  position: absolute;
  width: 400px;
  height: 400px;
  border-radius: 50%;
  background: radial-gradient(circle, ${({ theme }) => theme.colors.secondary.mintGlow}10, transparent 70%);
  bottom: -150px;
  left: -150px;
  pointer-events: none;
`;

const Content = styled.div`
  display: flex;
  align-items: center;
  gap: 80px;
  max-width: 1100px;
  width: 100%;
  z-index: 1;

  @media (max-width: 768px) {
    flex-direction: column;
    text-align: center;
    gap: 40px;
  }
`;

const TextSection = styled.div`
  flex: 1;
  animation: fadeIn 0.6s ease;
`;

const Title = styled.h1`
  font-size: ${({ theme }) => theme.font.size.hero};
  font-weight: ${({ theme }) => theme.font.weight.extrabold};
  color: ${({ theme }) => theme.colors.primary.deepNavy};
  line-height: 1.1;
  margin-bottom: ${({ theme }) => theme.spacing.md};
  letter-spacing: -1px;
  transition: color ${({ theme }) => theme.transition};

  body.dark-mode & {
    color: ${({ theme }) => theme.colors.text.white};
  }

  @media (max-width: 768px) {
    font-size: 36px;
  }

  @media (max-width: 480px) {
    font-size: 28px;
  }
`;

const Subtitle = styled.p`
  font-size: ${({ theme }) => theme.font.size.xl};
  color: ${({ theme }) => theme.colors.text.secondary};
  margin-bottom: ${({ theme }) => theme.spacing.xl};
  line-height: 1.5;

  @media (max-width: 768px) {
    font-size: ${({ theme }) => theme.font.size.lg};
  }
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  flex-wrap: wrap;

  @media (max-width: 768px) {
    justify-content: center;
  }
`;

const Footer = styled.footer`
  margin-top: 48px;
  font-size: 16px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.secondary};
  letter-spacing: 0.3px;

  @media (max-width: 768px) {
    text-align: center;
    font-size: 14px;
  }
`;

const Illustration = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.8s ease 0.2s both;
`;

const HeroLogo = styled.img`
  width: min(220px, 55vw);
  height: auto;
  display: block;
  margin: 0 auto;
  filter: drop-shadow(0 8px 32px rgba(58, 123, 255, 0.35));
`;

const AboutSection = styled.section`
  max-width: 700px;
  width: 100%;
  margin: 80px auto 0;
  padding: 60px 0 120px;
  border-top: 1px solid rgba(255,255,255,0.08);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 32px;
  z-index: 1;

  @media (max-width: 768px) {
    margin-top: 60px;
    padding-bottom: 80px;
  }
`;

const AboutPhoto = styled.img`
  width: 180px;
  height: 180px;
  border-radius: 50%;
  object-fit: cover;
  border: 4px solid ${({ theme }) => theme.colors.primary.echoBlue};
  box-shadow: 0 8px 32px rgba(58, 123, 255, 0.25);
  flex-shrink: 0;

  @media (max-width: 768px) {
    width: 140px;
    height: 140px;
  }
`;

const AboutText = styled.div`
  max-width: 500px;
`;

const AboutHeading = styled.h2`
  font-size: ${({ theme }) => theme.font.size.xl};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.colors.primary.deepNavy};
  margin-bottom: ${({ theme }) => theme.spacing.sm};

  body.dark-mode & {
    color: ${({ theme }) => theme.colors.text.white};
  }
`;

const AboutParagraph = styled.p`
  font-size: ${({ theme }) => theme.font.size.lg};
  color: ${({ theme }) => theme.colors.text.secondary};
  line-height: 1.6;
`;

const bounce = keyframes`
  0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-10px); }
  60% { transform: translateY(-5px); }
`;

const ScrollArrow = styled.div`
  position: absolute;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  color: ${({ theme }) => theme.colors.text.secondary};
  opacity: 0.5;
  animation: bounce 2s ease infinite;
  cursor: pointer;
  z-index: 2;

  &:hover {
    opacity: 0.8;
  }
`;

export default function Landing() {
  const navigate = useNavigate();
  const [showArrow, setShowArrow] = useState(true);

  useEffect(() => {
    const onScroll = () => setShowArrow(window.scrollY < window.innerHeight * 0.3);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <Wrapper>

      <HeroSection>
        <BackgroundGlow />
        <BackgroundGlow2 />
        <Content>
          <TextSection>
            <Title>Echoza</Title>
            <Subtitle>Text. Talk. Connect.</Subtitle>
            <ButtonGroup>
              <Button size="lg" onClick={() => navigate('/signup')}>
                Sign Up
              </Button>
              <Button variant="secondary" size="lg" onClick={() => navigate('/login')}>
                Log In
              </Button>
            </ButtonGroup>
            <Footer>© 2026 Arnav Jugessur · All Rights Reserved Echoza</Footer>
          </TextSection>
          <Illustration>
            <HeroLogo src="/vite.svg" alt="Echoza" />
          </Illustration>
        </Content>
        {showArrow && (
          <ScrollArrow>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </ScrollArrow>
        )}
      </HeroSection>

      <AboutSection>
        <AboutPhoto src="/arnav.jpg" alt="Arnav Jugessur" />
        <AboutText>
          <AboutHeading>Hey! I'm Arnav 👋</AboutHeading>
          <AboutParagraph>
            I made Echoza so I could talk to my friends that don't have a phone,
            but do have internet. So I took advantage of that and made this masterpiece!
          </AboutParagraph>
        </AboutText>
      </AboutSection>
    </Wrapper>
  );
}
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/common';

const Wrapper = styled.div`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${({ theme }) => theme.spacing.xl};
  background: ${({ theme }) => theme.colors.bg.main};
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

export default function Landing() {
  const navigate = useNavigate();

  return (
    <Wrapper>
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
    </Wrapper>
  );
}

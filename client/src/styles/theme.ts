export const lightTheme = {
  mode: 'light',
  colors: {
    primary: {
      echoBlue: '#3A7BFF',
      deepNavy: '#0F1A2F',
      softWhite: '#F5F7FA',
    },
    secondary: {
      mintGlow: '#4FF3C2',
      warmGray: '#A7A9B0',
    },
    bubble: {
      sent: '#3A7BFF',
      received: '#E8ECF1',
    },
    text: {
      primary: '#1A1D26',
      secondary: '#6B7280',
      white: '#FFFFFF',
      dark: '#0F1A2F',
    },
    bg: {
      main: '#F5F7FA',
      sidebar: '#FFFFFF',
      card: '#FFFFFF',
      input: '#F0F2F5',
      hover: '#E8ECF1',
      glass: 'rgba(255, 255, 255, 0.15)',
    },
    border: '#E2E4E9',
    shadow: 'rgba(0, 0, 0, 0.08)',
    danger: '#FF3B5C',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    xxl: '48px',
  },
  radius: {
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    round: '50%',
    pill: '9999px',
  },
  font: {
    family: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    size: {
      xs: '12px',
      sm: '14px',
      md: '16px',
      lg: '20px',
      xl: '24px',
      xxl: '32px',
      hero: '48px',
    },
    weight: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
      extrabold: 800,
    },
  },
  transition: '0.2s ease',
  shadow: {
    sm: '0 1px 3px rgba(0,0,0,0.08)',
    md: '0 4px 12px rgba(0,0,0,0.1)',
    lg: '0 8px 24px rgba(0,0,0,0.12)',
    glow: '0 0 20px rgba(58, 123, 255, 0.3)',
  },
};

export const darkTheme = {
  ...lightTheme,
  mode: 'dark',
  colors: {
    ...lightTheme.colors,
    primary: {
      echoBlue: '#3A7BFF',
      deepNavy: '#0F1A2F',
      softWhite: '#1A1D26',
    },
    bubble: {
      sent: '#3A7BFF',
      received: '#1C2333',
    },
    text: {
      primary: '#FFFFFF',
      secondary: '#A7A9B0',
      white: '#FFFFFF',
      dark: '#FFFFFF',
    },
    bg: {
      main: '#0B0E14',
      sidebar: '#0F1A2F',
      card: '#1C2333',
      input: '#1C2333',
      hover: '#2A3344',
      glass: 'rgba(255, 255, 255, 0.05)',
    },
    border: '#2A3344',
    shadow: 'rgba(0, 0, 0, 0.3)',
  },
  shadow: {
    sm: '0 1px 3px rgba(0,0,0,0.3)',
    md: '0 4px 12px rgba(0,0,0,0.4)',
    lg: '0 8px 24px rgba(0,0,0,0.5)',
    glow: '0 0 20px rgba(58, 123, 255, 0.2)',
  },
};

export type Theme = typeof lightTheme;

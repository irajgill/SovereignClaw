import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: '#0b0d10',
        surface: '#11151a',
        'surface-2': '#161b22',
        border: '#222831',
        'border-2': '#2a313c',
        muted: '#9aa3ad',
        text: '#e6e9ee',
        accent: '#7c5cff',
        'accent-2': '#a48bff',
        success: '#4ade80',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        sans: [
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
        ],
      },
    },
  },
  plugins: [],
};

export default config;

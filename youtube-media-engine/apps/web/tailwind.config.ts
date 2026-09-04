import type { Config } from 'tailwindcss';

/** Mirrors the render palette in @yme/video so the dashboard and the videos look like one product. */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#0E1116', raised: '#151A21', line: '#232A34', axis: '#3A4453' },
        paper: { DEFAULT: '#E9EDF2', muted: '#95A0AF', faint: '#5C6675' },
        accent: { DEFAULT: '#4E9BFF', dim: '#2F6FC4' },
        good: '#5CD6A0',
        warn: '#F0B429',
        bad: '#E8746B',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;

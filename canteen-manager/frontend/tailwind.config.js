/** @type {import('tailwindcss').Config} */
// Semantic tokens map to the CSS custom properties defined in src/index.css,
// so Tailwind utilities and raw CSS share one source of truth (the wireframe
// design system). Values live in :root; this file only names them.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: { DEFAULT: 'var(--card)', fg: 'var(--card-fg)' },
        muted: { DEFAULT: 'var(--muted)', fg: 'var(--muted-fg)' },
        border: 'var(--border)',
        input: 'var(--input)',
        primary: {
          DEFAULT: 'var(--primary)',
          fg: 'var(--primary-fg)',
          hover: 'var(--primary-hover)',
        },
        secondary: 'var(--secondary)',
        accent: { subtle: 'var(--accent-subtle)' },
        ring: 'var(--ring)',
        success: { DEFAULT: 'var(--success)', bg: 'var(--success-bg)', fg: 'var(--success-fg)' },
        warning: { DEFAULT: 'var(--warning)', bg: 'var(--warning-bg)', fg: 'var(--warning-fg)' },
        danger: { DEFAULT: 'var(--danger)', bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
        info: { DEFAULT: 'var(--info)', bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
        neutral: { bg: 'var(--neutral-bg)', fg: 'var(--neutral-fg)' },
      },
      borderRadius: { DEFAULT: 'var(--radius)', md: 'var(--radius)' },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      boxShadow: { DEFAULT: 'var(--shadow)', lg: 'var(--shadow-lg)' },
      spacing: { header: 'var(--header-h)', nav: 'var(--nav-w)' },
    },
  },
  plugins: [],
};

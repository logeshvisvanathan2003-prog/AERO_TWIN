/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: '#06090d',
        panel: '#0d1219',
        'panel-2': '#111822',
        line: '#1c2733',
        'line-soft': '#16202b',
        text: '#eef3f9',
        muted: '#9bacc0',
        faint: '#64778c',
        accent: '#00d3a7',
        'accent-dim': '#0b7f68',
        info: '#35c5ff',
        warn: '#ffb020',
        crit: '#ff4d5e',
        ok: '#2fd07a',
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", 'ui-monospace', 'monospace'],
        display: ["'Space Grotesk'", 'system-ui', 'sans-serif'],
        body: ["'Inter'", 'system-ui', 'sans-serif'],
      },
      borderRadius: { app: '10px' },
    },
  },
  plugins: [],
}

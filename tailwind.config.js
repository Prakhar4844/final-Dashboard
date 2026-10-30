/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ground: {
          950: '#050811',
          900: '#0a0f1d',
          850: '#0f172a',
          800: '#17223b',
          750: '#1e2b48',
          700: '#27375a',
          600: '#3e517a',
          500: '#64748b',
        },
        orbit: {
          cyan: '#06b6d4',
          cyanGlow: 'rgba(6, 182, 212, 0.15)',
          blue: '#3b82f6',
          blueGlow: 'rgba(59, 130, 246, 0.15)',
          electric: '#38bdf8',
        },
        status: {
          nominal: '#10b981',
          warning: '#f59e0b',
          critical: '#ef4444',
          offline: '#64748b',
          unconfigured: '#475569',
        }
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', '"Liberation Mono"', '"Courier New"', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        'panel': '0 4px 20px -2px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)',
        'cyan-glow': '0 0 15px rgba(6, 182, 212, 0.35)',
        'warning-glow': '0 0 15px rgba(245, 158, 11, 0.35)',
        'critical-glow': '0 0 15px rgba(239, 68, 68, 0.35)',
      }
    },
  },
  plugins: [],
}

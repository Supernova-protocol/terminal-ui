/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './admin.html', './src/**/*.{js,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        void: 'rgb(var(--void) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        ink: { DEFAULT: 'rgb(var(--ink) / <alpha-value>)', 2: 'rgb(var(--ink-2) / <alpha-value>)', 3: 'rgb(var(--ink-3) / <alpha-value>)' },
        neon: {
          cyan: 'rgb(var(--neon-cyan) / <alpha-value>)',
          violet: 'rgb(var(--neon-violet) / <alpha-value>)',
          green: 'rgb(var(--neon-green) / <alpha-value>)',
          red: 'rgb(var(--neon-red) / <alpha-value>)',
          amber: 'rgb(var(--neon-amber) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'glow-cyan': '0 0 24px -4px rgb(var(--neon-cyan) / .6)',
        'glow-violet': '0 0 24px -4px rgb(var(--neon-violet) / .6)',
      },
    },
  },
  // the original page relied on the Tailwind Play CDN, which keeps preflight; keep it
  corePlugins: { preflight: true },
};

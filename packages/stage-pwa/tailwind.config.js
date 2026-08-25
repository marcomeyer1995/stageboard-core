/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Backed by the CSS variables in src/index.css - see the theme system there.
      colors: {
        stage: 'rgb(var(--sb-stage) / <alpha-value>)',
        surface: 'rgb(var(--sb-surface) / <alpha-value>)',
        control: {
          DEFAULT: 'rgb(var(--sb-control) / <alpha-value>)',
          hover: 'rgb(var(--sb-control-hover) / <alpha-value>)',
          strong: 'rgb(var(--sb-control-strong) / <alpha-value>)',
          'strong-hover': 'rgb(var(--sb-control-strong-hover) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--sb-accent) / <alpha-value>)',
          hover: 'rgb(var(--sb-accent-hover) / <alpha-value>)',
          ink: 'rgb(var(--sb-accent-ink) / <alpha-value>)',
          2: 'rgb(var(--sb-accent-2) / <alpha-value>)',
          '2-hover': 'rgb(var(--sb-accent-2-hover) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--sb-ink) / <alpha-value>)',
          soft: 'rgb(var(--sb-ink-soft) / <alpha-value>)',
          muted: 'rgb(var(--sb-ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--sb-ink-faint) / <alpha-value>)',
        },
        line: 'var(--sb-line)',
      },
      borderRadius: {
        sb: 'var(--sb-radius)',
        'sb-sm': 'var(--sb-radius-sm)',
        'sb-pill': 'var(--sb-radius-pill)',
      },
      boxShadow: {
        sb: 'var(--sb-shadow)',
      },
      fontFamily: {
        sb: 'var(--sb-font-body)',
        'sb-mono': 'var(--sb-font-mono)',
      },
    },
  },
  plugins: [],
}

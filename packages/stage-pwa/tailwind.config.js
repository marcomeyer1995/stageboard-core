/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Backed by the CSS variables in src/index.css - see the Light-Mode toggle there.
      colors: {
        stage: 'rgb(var(--sb-stage) / <alpha-value>)',
        surface: 'rgb(var(--sb-surface) / <alpha-value>)',
        control: {
          DEFAULT: 'rgb(var(--sb-control) / <alpha-value>)',
          hover: 'rgb(var(--sb-control-hover) / <alpha-value>)',
          strong: 'rgb(var(--sb-control-strong) / <alpha-value>)',
          'strong-hover': 'rgb(var(--sb-control-strong-hover) / <alpha-value>)',
        },
        accent: 'rgb(var(--sb-accent) / <alpha-value>)',
        ink: {
          DEFAULT: 'rgb(var(--sb-ink) / <alpha-value>)',
          soft: 'rgb(var(--sb-ink-soft) / <alpha-value>)',
          muted: 'rgb(var(--sb-ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--sb-ink-faint) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
}

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
        // Meaning colours (docs/15 §5) - never Tailwind's red/amber/green directly.
        danger: {
          DEFAULT: 'rgb(var(--sb-danger) / <alpha-value>)',
          ink: 'rgb(var(--sb-danger-ink) / <alpha-value>)',
        },
        warn: {
          DEFAULT: 'rgb(var(--sb-warn) / <alpha-value>)',
          ink: 'rgb(var(--sb-warn-ink) / <alpha-value>)',
        },
        ok: {
          DEFAULT: 'rgb(var(--sb-ok) / <alpha-value>)',
          ink: 'rgb(var(--sb-ok-ink) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'rgb(var(--sb-info) / <alpha-value>)',
          ink: 'rgb(var(--sb-info-ink) / <alpha-value>)',
        },
        flash: {
          DEFAULT: 'rgb(var(--sb-flash) / <alpha-value>)',
          ink: 'rgb(var(--sb-flash-ink) / <alpha-value>)',
        },
        scrim: {
          DEFAULT: 'rgb(var(--sb-scrim) / <alpha-value>)',
          ink: 'rgb(var(--sb-scrim-ink) / <alpha-value>)',
        },
        alarm: {
          DEFAULT: 'rgb(var(--sb-alarm) / <alpha-value>)',
          ink: 'rgb(var(--sb-alarm-ink) / <alpha-value>)',
        },
        state: {
          'count-in': 'rgb(var(--sb-state-count-in) / <alpha-value>)',
          'count-in-ink': 'rgb(var(--sb-state-count-in-ink) / <alpha-value>)',
          'playing': 'rgb(var(--sb-state-playing) / <alpha-value>)',
          'playing-ink': 'rgb(var(--sb-state-playing-ink) / <alpha-value>)',
          'paused': 'rgb(var(--sb-state-paused) / <alpha-value>)',
          'paused-ink': 'rgb(var(--sb-state-paused-ink) / <alpha-value>)',
          'finished': 'rgb(var(--sb-state-finished) / <alpha-value>)',
          'finished-ink': 'rgb(var(--sb-state-finished-ink) / <alpha-value>)',
          'fault': 'rgb(var(--sb-state-fault) / <alpha-value>)',
          'fault-ink': 'rgb(var(--sb-state-fault-ink) / <alpha-value>)',
        },
      },
      borderRadius: {
        sb: 'var(--sb-radius)',
        'sb-sm': 'var(--sb-radius-sm)',
        'sb-pill': 'var(--sb-radius-pill)',
        // UI system roles (docs/15 §5).
        control: 'var(--sb-radius-control)',
        container: 'var(--sb-radius-container)',
      },
      boxShadow: {
        sb: 'var(--sb-shadow)',
      },
      fontFamily: {
        sb: 'var(--sb-font-body)',
        'sb-mono': 'var(--sb-font-mono)',
      },
      // Stage sizes (src/index.css): h-touch / min-h-touch / w-touch etc. for tappable controls.
      spacing: {
        touch: 'var(--sb-touch)',
        'touch-primary': 'var(--sb-touch-primary)',
        // UI system heights (docs/15 §5): show actions 72, stage 56, forms 48.
        show: 'var(--sb-h-show)',
        stage: 'var(--sb-h-stage)',
        form: 'var(--sb-h-form)',
      },
      minHeight: {
        touch: 'var(--sb-touch)',
        'touch-primary': 'var(--sb-touch-primary)',
        show: 'var(--sb-h-show)',
        stage: 'var(--sb-h-stage)',
        form: 'var(--sb-h-form)',
      },
      // Fixed layer scale (docs/15 §5) instead of free z-values per file: content < bars <
      // menus < dialogs < alerts (DialogHost's confirm above any dialog) < flash < takeover.
      zIndex: {
        content: '10',
        bars: '20',
        menu: '40',
        dialog: '50',
        alert: '55',
        flash: '58',
        takeover: '60',
      },
      minWidth: {
        touch: 'var(--sb-touch)',
        'touch-primary': 'var(--sb-touch-primary)',
      },
      // Text floor: nothing on screen below 16px. xs and sm were 12/14px - the most common
      // "too small for the stage" finding in the GUI audit - so both now start at the floor.
      fontSize: {
        xs: ['var(--sb-text-min)', { lineHeight: '1.35' }],
        sm: ['var(--sb-text-min)', { lineHeight: '1.45' }],
      },
    },
  },
  plugins: [],
}

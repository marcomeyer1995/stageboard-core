/** Shared closed color palette for widgets with a user-configurable accent (CustomTriggerWidget's
 * button, SeparatorWidget's line) - one vocabulary, not two, and no arbitrary hex/inline styles,
 * consistent with the rest of the design system's semantic Tailwind tokens. */
export const WIDGET_COLORS = ['neutral', 'accent', 'green', 'amber', 'red'] as const
export type WidgetColor = (typeof WIDGET_COLORS)[number]

/** Solid background + readable text, for a pressed/active button state. */
export const WIDGET_COLOR_SOLID: Record<WidgetColor, string> = {
  neutral: 'bg-control-strong-hover text-ink',
  accent: 'bg-accent text-accent-ink',
  green: 'bg-green-500 text-white',
  amber: 'bg-amber-500 text-white',
  red: 'bg-red-500 text-white',
}

/** A flat fill, for a thin divider line - `neutral` is deliberately `ink-muted`, not the
 * near-invisible `line` border token a hairline divider normally uses (Marco, 2026-09-14:
 * SeparatorWidget's default line wasn't visible enough). */
export const WIDGET_COLOR_LINE: Record<WidgetColor, string> = {
  neutral: 'bg-ink-muted',
  accent: 'bg-accent',
  green: 'bg-green-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
}

import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'accent' | 'warning' | 'danger'

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-control-strong text-ink',
  accent: 'bg-accent text-accent-ink',
  warning: 'bg-warn/20 text-warn',
  danger: 'bg-danger/20 text-danger',
}

/** Small uppercase label (roles, tiers, "Aktiv", "zu klein") - the only place pills appear (D1). */
export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-sb-pill px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${TONE[tone]}`}>{children}</span>
}

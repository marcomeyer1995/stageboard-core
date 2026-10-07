import type { ReactNode } from 'react'
import { Badge } from './Badge'
import { CONTROL } from './styles'

/**
 * "Active / that's you" (D4): a yellow ring around the row plus a badge at its end - never a
 * solid fill, which stays reserved for a chosen value. For the own profile, the active band, the
 * active setlist. One surface with the row (same corner, same grey up to the badge): a separate
 * frame with a larger corner was cut by the row's corners and left a black strip by the badge
 * (seen on the phone, 2026-10-07).
 */
export function ActiveMarker({ active, badge = 'Aktiv', children }: { active: boolean; badge?: string; children: ReactNode }) {
  if (!active) return <>{children}</>
  return (
    <div className={`flex items-center overflow-hidden bg-control ring-2 ring-accent ${CONTROL}`}>
      <div className="min-w-0 flex-1">{children}</div>
      <span className="flex-shrink-0 pr-3">
        <Badge tone="accent">{badge}</Badge>
      </span>
    </div>
  )
}

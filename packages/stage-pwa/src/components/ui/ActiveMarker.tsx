import type { ReactNode } from 'react'
import { Badge } from './Badge'
import { CONTAINER } from './styles'

/**
 * "Active / that's you" (D4): a yellow outline plus a badge at the end of the row - never a solid
 * fill, which stays reserved for a chosen value. For the own profile, the active band, the active
 * setlist.
 */
export function ActiveMarker({ active, badge = 'Aktiv', children }: { active: boolean; badge?: string; children: ReactNode }) {
  return (
    <div className={`flex items-center gap-3 border ${CONTAINER} ${active ? 'border-accent pr-3' : 'border-transparent'}`}>
      <div className="min-w-0 flex-1">{children}</div>
      {active && <Badge tone="accent">{badge}</Badge>}
    </div>
  )
}

import { useState } from 'react'
import { Icon } from './Icon'
import { Dialog, choiceRow } from './ui'
import { CONTROL, DISABLED, FOCUS, HOVER } from './ui/styles'

const ROW = `flex h-stage w-full items-center gap-3 bg-control px-4 text-left text-lg text-ink ${CONTROL}`

export interface PickItem {
  id: string | null
  name: string
}

/**
 * One choice as a row in the ☰ drawer - the band, the setlist (Marco, 2026-10-16): tap it, pick
 * from a small list, the current one yellow; like "Ich bin". `readOnly` shows the same row without
 * the list; `locked` greys it out (a song is playing).
 */
export function PickRow({
  title,
  items,
  activeId,
  emptyName = 'keine',
  onPick,
  readOnly = false,
  locked = false,
  lockedHint,
}: {
  /** "Band", "Setlist" - titles the list; the row shows only the name, its drawer group names it. */
  title: string
  items: readonly PickItem[]
  activeId: string | null
  /** Shown in the row when nothing is chosen. */
  emptyName?: string
  onPick: (id: string | null) => void
  readOnly?: boolean
  locked?: boolean
  lockedHint?: string
}) {
  const [picking, setPicking] = useState(false)
  const active = items.find((item) => item.id === activeId && item.id !== null)
  const label = (
    <span className="min-w-0 flex-1 truncate">
      {/* The group label beside the row already says it (Marco, 2026-10-17) - kept for screen readers. */}
      <span className="sr-only">{title}: </span>
      {active?.name ?? emptyName}
    </span>
  )

  if (readOnly) return <div className={ROW}>{label}</div>

  return (
    <>
      <button type="button" disabled={locked} title={locked ? lockedHint : undefined} onClick={() => setPicking(true)} className={`${ROW} ${FOCUS} ${HOVER} ${DISABLED}`}>
        {label}
        <Icon name="next" size="1.4rem" className="text-ink-faint" />
      </button>
      {picking && (
        <Dialog title={title} size="s" closeLabel="Abbrechen" onClose={() => setPicking(false)}>
          <div className="flex flex-col gap-2" role="group" aria-label={title}>
            {items.map((item) => (
              <button
                key={item.id ?? 'none'}
                type="button"
                aria-current={item.id === activeId ? 'true' : undefined}
                onClick={() => {
                  setPicking(false)
                  if (item.id !== activeId) onPick(item.id)
                }}
                className={choiceRow(item.id === activeId)}
              >
                {item.name}
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </>
  )
}

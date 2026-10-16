import { useState } from 'react'
import type { Setlist } from 'shared-types'
import { Icon } from './Icon'
import { Dialog, choiceRow } from './ui'
import { CONTROL, DISABLED, FOCUS, HOVER } from './ui/styles'

const ROW = `flex h-stage w-full items-center gap-3 bg-control px-4 text-left text-lg text-ink ${CONTROL}`

/** Newest gig first, undated ones by name after them - like the Bibliothek's default. */
function sortSetlists(setlists: readonly Setlist[]): Setlist[] {
  return [...setlists].sort((a, b) => (b.performanceDate ?? '').localeCompare(a.performanceDate ?? '') || a.name.localeCompare(b.name))
}

/**
 * A setlist as a row in the ☰ drawer, like "Ich bin" (Marco, 2026-10-16): tap it, pick from a small
 * list - in Gig (the band's active setlist, master only) and in Solo Üben (this device's own) alike.
 * `readOnly` shows the same row without the list; `locked` greys it out (a song is playing).
 */
export function SetlistPickRow({
  setlists,
  activeId,
  noneLabel,
  onPick,
  readOnly = false,
  locked = false,
  lockedHint,
}: {
  setlists: readonly Setlist[]
  activeId: string | null
  /** The "no setlist" choice, e.g. "Keine Setlist (ganzer Katalog)". */
  noneLabel: string
  onPick: (setlistId: string | null) => void
  readOnly?: boolean
  locked?: boolean
  lockedHint?: string
}) {
  const [picking, setPicking] = useState(false)
  const active = setlists.find((setlist) => setlist.id === activeId)
  const label = (
    <span className="min-w-0 flex-1 truncate">
      <span className="text-ink-muted">Setlist: </span>
      {active?.name ?? 'keine'}
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
        <Dialog title="Setlist" size="s" closeLabel="Abbrechen" onClose={() => setPicking(false)}>
          <div className="flex flex-col gap-2" role="group" aria-label="Setlists">
            {[{ id: null, name: noneLabel }, ...sortSetlists(setlists)].map((setlist) => (
              <button
                key={setlist.id ?? 'none'}
                type="button"
                aria-current={setlist.id === (active?.id ?? null) ? 'true' : undefined}
                onClick={() => {
                  setPicking(false)
                  onPick(setlist.id)
                }}
                className={choiceRow(setlist.id === (active?.id ?? null))}
              >
                {setlist.name}
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </>
  )
}

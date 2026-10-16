import { useState } from 'react'
import { useQueue } from '../lib/queue'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { Icon } from './Icon'
import { Dialog, choiceRow } from './ui'
import { CONTROL, DISABLED, FOCUS, HOVER } from './ui/styles'

const ROW = `flex h-stage w-full items-center gap-3 bg-control px-4 text-left text-lg text-ink ${CONTROL}`

/**
 * The Gig's active setlist in the ☰ drawer (Marco, 2026-10-16), a row like "Ich bin": the master
 * taps it and picks from a small list - no trip to the Bibliothek; everyone else reads it. Locked
 * while a song plays, like switching to Solo Üben: the whole band's queue would change mid-song.
 */
export function GigSetlistPicker() {
  const { isMaster, activeSetlist } = useQueue()
  const setlists = useSetlistsStore((state) => state.setlists)
  const playing = useShowStateStore((state) => state.state.playbackStatus === 'playing')
  const setActiveSetlist = useShowStateStore((state) => state.setActiveSetlist)
  const [picking, setPicking] = useState(false)
  // Newest gig first, undated ones by name after them - like the Bibliothek's default.
  const sorted = [...setlists].sort((a, b) => (b.performanceDate ?? '').localeCompare(a.performanceDate ?? '') || a.name.localeCompare(b.name))
  const label = (
    <span className="min-w-0 flex-1 truncate">
      <span className="text-ink-muted">Setlist: </span>
      {activeSetlist?.name ?? 'keine'}
    </span>
  )

  if (!isMaster) return <div className={ROW}>{label}</div>

  return (
    <>
      <button
        type="button"
        disabled={playing}
        title={playing ? 'Während ein Song läuft, bleibt die Setlist.' : undefined}
        onClick={() => setPicking(true)}
        className={`${ROW} ${FOCUS} ${HOVER} ${DISABLED}`}
      >
        {label}
        <Icon name="next" size="1.4rem" className="text-ink-faint" />
      </button>
      {picking && (
        <Dialog title="Setlist" size="s" closeLabel="Abbrechen" onClose={() => setPicking(false)}>
          <div className="flex flex-col gap-2" role="group" aria-label="Setlists">
            {[{ id: null, name: 'Keine Setlist' }, ...sorted].map((setlist) => (
              <button
                key={setlist.id ?? 'none'}
                type="button"
                aria-current={setlist.id === (activeSetlist?.id ?? null) ? 'true' : undefined}
                onClick={() => {
                  setPicking(false)
                  void setActiveSetlist(setlist.id)
                }}
                className={choiceRow(setlist.id === (activeSetlist?.id ?? null))}
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

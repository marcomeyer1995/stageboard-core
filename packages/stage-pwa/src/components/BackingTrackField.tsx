import { useEffect, useState } from 'react'
import { hasBackingTrack, putBackingTrack, removeBackingTrack } from '../lib/db'

interface BackingTrackFieldProps {
  songId: string
  /** True for a new, unsaved draft - there's no document yet to attach anything to. */
  disabled: boolean
}

/** Attach/replace/remove the stereo backing-track mixdown a song plays back (docs/08 Phase 2). */
export function BackingTrackField({ songId, disabled }: BackingTrackFieldProps) {
  const [attached, setAttached] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (disabled) {
      setAttached(false)
      return
    }
    let cancelled = false
    hasBackingTrack(songId).then((value) => {
      if (!cancelled) setAttached(value)
    })
    return () => {
      cancelled = true
    }
  }, [songId, disabled])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    await putBackingTrack(songId, file)
    setAttached(true)
    setBusy(false)
  }

  async function handleRemove() {
    setBusy(true)
    await removeBackingTrack(songId)
    setAttached(false)
    setBusy(false)
  }

  return (
    <div className="flex flex-col gap-1 text-sm text-ink-muted">
      Backing-Track
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-faint">{attached ? 'Angehängt' : 'Kein Track'}</span>
        <label
          className={`rounded-sb-sm bg-control-strong px-2 py-1 text-xs text-ink hover:bg-control-strong-hover ${
            disabled || busy ? 'pointer-events-none opacity-40' : 'cursor-pointer'
          }`}
        >
          {attached ? 'Ersetzen' : 'Hochladen'}
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            disabled={disabled || busy}
            onChange={handleFile}
          />
        </label>
        {attached && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={disabled || busy}
            className="rounded-sb-sm bg-control-strong px-2 py-1 text-xs text-ink hover:bg-control-strong-hover disabled:opacity-40"
          >
            Entfernen
          </button>
        )}
      </div>
      {disabled && <span className="text-xs text-ink-faint">Erst speichern, dann Track anhängen.</span>}
    </div>
  )
}

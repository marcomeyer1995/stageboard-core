import { useEffect, useState } from 'react'
import { setLineTimeTag } from '../lib/chordpro'
import { useElapsedMs } from '../lib/useElapsedMs'
import { useClockStore } from '../store/useClockStore'

interface TapToSyncProps {
  content: string
  onComplete: (content: string) => void
  onCancel: () => void
}

/** Recording mode for docs/04's "Tap-to-Sync" workflow: tap once per line, in time with the song. */
export function TapToSync({ content, onComplete, onCancel }: TapToSyncProps) {
  const [lines, setLines] = useState<string[]>(() => content.split('\n'))
  const [tapIndex, setTapIndex] = useState(() =>
    lines.findIndex((line) => line.trim().length > 0),
  )
  const elapsedMs = useElapsedMs()

  useEffect(() => {
    useClockStore.getState().reset()
    useClockStore.getState().start()
    return () => {
      useClockStore.getState().stop()
    }
  }, [])

  function tap() {
    if (tapIndex < 0) return
    const ms = useClockStore.getState().getElapsedMs()
    const updated = [...lines]
    updated[tapIndex] = setLineTimeTag(updated[tapIndex], ms)
    const nextIndex = updated.findIndex((line, i) => i > tapIndex && line.trim().length > 0)
    setLines(updated)
    if (nextIndex === -1) {
      onComplete(updated.join('\n'))
    } else {
      setTapIndex(nextIndex)
    }
  }

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.code === 'Space') {
        e.preventDefault()
        tap()
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, tapIndex])

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex items-center justify-between rounded bg-neutral-800 px-3 py-2 text-sm text-neutral-300">
        <span>
          Drücke <kbd className="rounded bg-neutral-700 px-1.5 py-0.5 font-mono">Leertaste</kbd>{' '}
          oder klicke "Tap" im Takt jeder Zeile.
        </span>
        <span className="font-mono text-white">{(elapsedMs / 1000).toFixed(2)}s</span>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto rounded bg-neutral-800 p-3 font-mono text-sm">
        {lines.map((line, i) => (
          <p
            key={i}
            className={`rounded px-2 py-1 ${
              i === tapIndex ? 'bg-amber-500/30 text-white' : 'text-neutral-400'
            }`}
          >
            {line || ' '}
          </p>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={tap}
          disabled={tapIndex < 0}
          className="flex-1 rounded bg-amber-500 py-3 text-lg font-bold text-black hover:bg-amber-400 disabled:opacity-40"
        >
          Tap
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded bg-neutral-700 px-4 py-3 text-sm hover:bg-neutral-600"
        >
          Abbrechen
        </button>
      </div>
    </div>
  )
}

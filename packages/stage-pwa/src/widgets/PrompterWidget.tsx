import { useEffect, useRef, useState } from 'react'
import { ChordProLyrics } from '../components/ChordProLyrics'
import { currentLineIndex, parseChordPro } from '../lib/chordpro'
import { useElapsedMs } from '../lib/useElapsedMs'
import { useQueue } from '../lib/queue'

type ViewMode = 'scroll' | 'paginated'

export function PrompterWidget() {
  const { currentSong } = useQueue()
  const elapsedMs = useElapsedMs()
  const [viewMode, setViewMode] = useState<ViewMode>('scroll')
  const containerRef = useRef<HTMLDivElement>(null)

  const lines = currentSong ? parseChordPro(currentSong.chordProContent) : []
  const activeIndex = currentLineIndex(lines, elapsedMs)

  useEffect(() => {
    const container = containerRef.current
    const activeEl = container?.querySelector<HTMLElement>(`[data-line-index="${activeIndex}"]`)
    if (!container || !activeEl) return

    const containerRect = container.getBoundingClientRect()
    const activeRect = activeEl.getBoundingClientRect()
    const target =
      container.scrollTop +
      (activeRect.top - containerRect.top) -
      container.clientHeight / 2 +
      activeRect.height / 2

    if (viewMode === 'paginated') {
      container.scrollTop = target
      return
    }

    // Smooth Scroll: ease continuously toward the active line every tick.
    container.scrollTop += (target - container.scrollTop) * 0.08
  }, [activeIndex, elapsedMs, viewMode])

  if (!currentSong) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg bg-neutral-900 p-8 text-neutral-500">
        Keine Songs vorhanden
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col rounded-lg bg-neutral-900 p-8">
      <div className="mb-2 flex items-start justify-between">
        <div>
          <p className="text-sm uppercase tracking-widest text-neutral-500">Now Playing</p>
          <h1 className="text-4xl font-bold text-white">{currentSong.title}</h1>
        </div>
        <button
          type="button"
          onClick={() => setViewMode(viewMode === 'scroll' ? 'paginated' : 'scroll')}
          className="rounded bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
        >
          {viewMode === 'scroll' ? 'Smooth Scroll' : 'Paginated View'}
        </button>
      </div>
      <div ref={containerRef} className="flex-1 overflow-y-auto">
        <ChordProLyrics lines={lines} activeIndex={activeIndex} />
      </div>
    </div>
  )
}

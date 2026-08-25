import { useEffect, useRef, useState } from 'react'
import { ChordProLyrics } from '../components/ChordProLyrics'
import { buildPages, currentLineIndex, currentPageIndex, parseChordPro } from '../lib/chordpro'
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
  const pages = buildPages(lines)
  const pageIndex = currentPageIndex(pages, activeIndex)
  const page = pages[pageIndex]

  useEffect(() => {
    if (viewMode !== 'scroll') return
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

    // Smooth Scroll: ease continuously toward the active line every tick.
    container.scrollTop += (target - container.scrollTop) * 0.08
  }, [activeIndex, elapsedMs, viewMode])

  if (!currentSong) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg bg-surface p-8 text-ink-faint">
        Keine Songs vorhanden
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col rounded-lg bg-surface p-8">
      <div className="mb-2 flex items-start justify-between">
        <div>
          <p className="text-sm uppercase tracking-widest text-ink-faint">Now Playing</p>
          <h1 className="text-4xl font-bold text-ink">{currentSong.title}</h1>
        </div>
        <button
          type="button"
          onClick={() => setViewMode(viewMode === 'scroll' ? 'paginated' : 'scroll')}
          className="rounded bg-control px-3 py-1 text-xs text-ink-soft hover:bg-control-hover"
        >
          {viewMode === 'scroll' ? 'Smooth Scroll' : 'Paginated View'}
        </button>
      </div>

      {viewMode === 'paginated' && page ? (
        <>
          <div className="flex items-baseline justify-between border-b border-control pb-2">
            <p className="text-xl font-bold uppercase tracking-widest text-accent">
              {page.label ?? `Seite ${pageIndex + 1}`}
            </p>
            <p className="font-mono text-sm text-ink-faint">
              {pageIndex + 1}/{pages.length}
              {pages[pageIndex + 1]?.label && (
                <span className="ml-3 text-ink-faint">
                  next: {pages[pageIndex + 1].label}
                </span>
              )}
            </p>
          </div>
          {/* One page at a time: the whole block is replaced when the clock crosses into the
              next part, instead of scrolling line by line. */}
          <div className="flex-1 overflow-y-auto">
            <ChordProLyrics
              lines={lines.slice(page.startIndex, page.endIndex)}
              activeIndex={activeIndex}
              startIndex={page.startIndex}
              hidePartLabels
            />
          </div>
        </>
      ) : (
        <div ref={containerRef} className="flex-1 overflow-y-auto">
          <ChordProLyrics lines={lines} activeIndex={activeIndex} />
        </div>
      )}
    </div>
  )
}

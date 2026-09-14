import type { ReactNode } from 'react'
import type { ChordProLine } from '../lib/chordpro'

interface ChordProLyricsProps {
  lines: ChordProLine[]
  /** Index of the line to visually highlight (Section Highlighting), if any. */
  activeIndex?: number
  /**
   * Index `lines[0]` has in the full song. Lets the Paginated View render a slice
   * while `data-line-index` and `activeIndex` stay absolute.
   */
  startIndex?: number
  /** Set by the Paginated View, which already shows the part name in its page header. */
  hidePartLabels?: boolean
  /** px, defaults to 18 (the previous fixed `text-lg`) - PrompterWidget.tsx drives this from
   * useContentFontSize.ts, every other caller (SongPreview/SheetEditor) keeps the default. */
  fontSize?: number
  /** px, absolute - unset keeps the previous proportional default (0.7em, relative to
   * `fontSize`), so every caller but PrompterWidget.tsx (which can now set an independent
   * chord size, Marco 2026-09-14) is unaffected. */
  chordFontSize?: number
  /** Rendered above the lines, inside the same scrolling/spacing context - so it scrolls
   * away with everything else once playback moves past it, rather than staying pinned
   * (Marco, 2026-09-14: key/tuning/capo shouldn't need permanent screen space). Only
   * PrompterWidget.tsx passes this; every other caller is unaffected. */
  headerContent?: ReactNode
}

export function ChordProLyrics({
  lines,
  activeIndex,
  startIndex = 0,
  hidePartLabels = false,
  fontSize = 18,
  chordFontSize,
  headerContent,
}: ChordProLyricsProps) {
  if (lines.length === 0) {
    return <p className="text-ink-faint">Kein Text.</p>
  }

  return (
    <div className="space-y-3 pt-4 font-sb-mono leading-loose text-ink" style={{ fontSize }}>
      {headerContent}
      {lines.map((line, offset) => {
        const lineIndex = startIndex + offset
        const previous = offset > 0 ? lines[offset - 1] : null
        const startsPart = line.partLabel !== null && line.partIndex !== previous?.partIndex

        return (
          <div key={lineIndex}>
            {!hidePartLabels && startsPart && (
              // Song part label from docs/04 - the visual bracket that groups a block of lines.
              <p className="mb-1 mt-4 border-l-2 border-accent pl-2 font-sans text-xs font-bold uppercase tracking-widest text-accent first:mt-0">
                {line.partLabel}
              </p>
            )}
            <p
              data-line-index={lineIndex}
              className={`-mx-2 whitespace-pre-wrap break-words rounded-sb-sm px-2 transition-colors duration-300 ${
                // A chord sits absolutely -top-4 above its line's text. Normally the previous
                // line's own leading-loose height absorbs that overlap, but the part label
                // above it (small font-sans text, no leading-loose) doesn't - without this,
                // the first line's chords render on top of the label text. mt-6 (not just
                // enough to clear -top-4) leaves a few px of breathing room, since sibling
                // margins collapse to the larger of the two rather than summing.
                !hidePartLabels && startsPart ? 'mt-6' : ''
              } ${lineIndex === activeIndex ? 'bg-accent-2/20' : ''}`}
            >
              {line.segments.map((segment, segmentIndex) => (
                <span key={segmentIndex} className="relative inline-block">
                  {segment.chord && (
                    <span
                      style={chordFontSize === undefined ? { fontSize: '0.7em' } : { fontSize: chordFontSize }}
                      className="absolute -top-4 left-0 font-bold text-accent"
                    >
                      {segment.chord}
                    </span>
                  )}
                  {segment.text}
                </span>
              ))}
            </p>
          </div>
        )
      })}
    </div>
  )
}

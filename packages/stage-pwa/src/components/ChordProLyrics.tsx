import type { ReactNode } from 'react'
import type { ChordProLine } from '../lib/chordpro'

/** Repeat marks (`x4`, `2x`) are the only letters/digits an instrumental chord row may carry. */
const REPEAT_MARK_RE = /\b(?:x\s?\d+|\d+\s?x)\b/gi

/**
 * A chord row without lyrics - bar notation for an intro or bridge (`| C   | F   |`), a plain
 * `[Em] [C] [G]  x4`, a single chord on its own line. At least one chord, and apart from the
 * chords no letter (any script, so umlauts count) and no digit - one sung letter ("[G]I")
 * keeps a line a lyric line. Rendered inline (chords *in* the row, between the bars) instead
 * of floating above an otherwise empty row (Marco, 2026-09-26: looked strange on the tablet).
 * Also truer to the source: in UG's text the chord names occupy columns, which the bars were
 * aligned around.
 */
function isChordOnlyLine(line: ChordProLine): boolean {
  if (!line.segments.some((segment) => segment.chord !== null)) return false
  return line.segments.every((segment) => !/[\p{L}\d]/u.test(segment.text.replace(REPEAT_MARK_RE, '')))
}

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
  /** px, absolute - unset keeps the same proportional default as chords (0.7em), for callers
   * that don't offer their own comment-size slider (issue #215). */
  commentFontSize?: number
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
  commentFontSize,
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
            {line.tab !== null ? (
              // Guitar tab block: verbatim, monospace, never wrapped - a wrapped staff line
              // breaks the column alignment between the strings, so a too-wide riff scrolls
              // sideways instead. Tighter leading than lyrics: the strings belong together.
              <div
                data-line-index={lineIndex}
                className={`-mx-2 overflow-x-auto rounded-sb-sm px-2 transition-colors duration-300 ${
                  !hidePartLabels && startsPart ? 'mt-6' : ''
                } ${lineIndex === activeIndex ? 'bg-accent-2/20' : ''}`}
              >
                {line.tab.label && <p className="font-sans text-xs italic text-ink-faint">{line.tab.label}</p>}
                <pre className="font-sb-mono leading-snug text-ink-soft" style={{ fontSize: '0.8em' }}>
                  {line.tab.lines.join('\n')}
                </pre>
              </div>
            ) : isChordOnlyLine(line) ? (
              // Instrumental chord row: chords inline at lyric size, in the accent colour - they
              // are the content of this row, not an annotation above it.
              <p
                data-line-index={lineIndex}
                className={`-mx-2 whitespace-pre-wrap break-words rounded-sb-sm px-2 transition-colors duration-300 ${
                  !hidePartLabels && startsPart ? 'mt-6' : ''
                } ${lineIndex === activeIndex ? 'bg-accent-2/20' : ''}`}
              >
                {line.segments.map((segment, segmentIndex) => (
                  <span key={segmentIndex}>
                    {segment.chord && <span className="font-bold text-accent">{segment.chord}</span>}
                    <span className="text-ink-faint">{segment.text}</span>
                  </span>
                ))}
              </p>
            ) : line.comment !== null ? (
              // Musician-facing note (issue #215), not part of the lyric - font-sans italic
              // sets it apart from the lyric's own font-sb-mono, same way a part label does.
              <p
                data-line-index={lineIndex}
                style={commentFontSize === undefined ? { fontSize: '0.7em' } : { fontSize: commentFontSize }}
                className={`-mx-2 rounded-sb-sm px-2 font-sans italic text-ink-faint transition-colors duration-300 ${
                  !hidePartLabels && startsPart ? 'mt-6' : ''
                } ${lineIndex === activeIndex ? 'bg-accent-2/20' : ''}`}
              >
                {line.comment}
              </p>
            ) : (
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
                    {/* A segment with no text - a chord at the end of a line, or two chords back
                        to back - would collapse to a zero-height inline-block sitting on the
                        baseline, so its chord (positioned from the segment's top) landed at lyric
                        height instead of above it. A zero-width space keeps the full line height
                        without taking any room (measured on a Fire tablet, 2026-09-26: +8px vs
                        -16px for every other chord). */}
                    {segment.text === '' ? '\u200B' : segment.text}
                  </span>
                ))}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

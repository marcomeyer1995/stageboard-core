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
              <LyricLine
                line={line}
                lineIndex={lineIndex}
                active={lineIndex === activeIndex}
                startsPart={!hidePartLabels && startsPart}
                chordFontSize={chordFontSize}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * A lyric line with its chords *inside* the line's own box: the line reserves room on top
 * (`paddingTop`, about one chord height) and each chord sits in it, directly above its segment
 * (`bottom-full`). Before, chords were pushed 16px up out of the box into the gap above, so the
 * current-line highlight - the box's background - cut them off (Marco, 2026-09-26, measured on
 * a Fire tablet: box 596-632px, chords from 580px). A tighter line height offsets the extra
 * padding, so a line takes about as much room as before. The padding follows the prompter's own
 * chord size when one is set.
 */
function LyricLine({
  line,
  lineIndex,
  active,
  startsPart,
  chordFontSize,
}: {
  line: ChordProLine
  lineIndex: number
  active: boolean
  startsPart: boolean
  chordFontSize: number | undefined
}) {
  const hasChords = line.segments.some((segment) => segment.chord !== null)
  const chordStyle = chordFontSize === undefined ? { fontSize: '0.7em' } : { fontSize: chordFontSize }
  const lineStyle = hasChords
    ? { lineHeight: 1.375, paddingTop: chordFontSize === undefined ? '0.85em' : `${chordFontSize * 1.2}px` }
    : undefined

  return (
    <p
      data-line-index={lineIndex}
      style={lineStyle}
      className={`-mx-2 whitespace-pre-wrap break-words rounded-sb-sm px-2 transition-colors duration-300 ${
        // Keeps a little air between a part label and its first line.
        startsPart ? 'mt-6' : ''
      } ${active ? 'bg-accent-2/20' : ''}`}
    >
      {line.segments.map((segment, segmentIndex) => (
        <span key={segmentIndex} className="relative inline-block">
          {segment.chord && (
            <span style={{ ...chordStyle, lineHeight: 1.15 }} className="absolute bottom-full left-0 font-bold text-accent">
              {segment.chord}
            </span>
          )}
          {segment.text === '' ? (
            // No text under this chord - a chord at the end of a line, or two chords back to
            // back. The zero-width space keeps the full line height (else the segment collapses
            // onto the baseline and its chord drops to lyric height - +8px vs -16px, measured on
            // the tablet); the invisible copy of the chord gives the segment the chord's width,
            // so several line-end chords stand side by side instead of printing over each other
            // ("D#5 C#m7 B" rendered as "B#m57").
            <>
              {'\u200B'}
              {segment.chord && (
                <span aria-hidden="true" style={chordStyle} className="invisible pr-[0.6em] font-bold">
                  {segment.chord}
                </span>
              )}
            </>
          ) : (
            segment.text
          )}
        </span>
      ))}
    </p>
  )
}

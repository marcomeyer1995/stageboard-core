import { memo, useCallback, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import type { ChordProLine } from '../lib/chordpro'
import { stageFontSize } from '../lib/stageSize'
import { ChordPopover } from './ChordPopover'

/** How long a finger rests on a chord before its shape opens (#609) - a plain tap stays a tap. */
const LONG_PRESS_MS = 500
/** How far beside a chord name a press still counts as on it, CSS px - about half a fingertip. */
export const CHORD_REACH_PX = 24
/** A finger moving further than this is scrolling, not pressing. */
const LONG_PRESS_SLOP_PX = 10
/** Marks a tappable chord: no text selection or callout from the long press. */
const CHORD_TAPPABLE = 'cursor-pointer select-none [-webkit-touch-callout:none]'

/** Chords and comments default to 0.7em of the lyric size, but never below the stage text
 * floor (lib/stageSize.ts) - at the default 18px lyric size 0.7em was 12.6px. As classes, not
 * inline styles: the same values, but jsdom drops `max()` from inline styles. */
const STAGE_SMALL_TEXT = 'text-[length:max(var(--sb-text-min),0.7em)]'
const STAGE_CHORD_ROOM = 'pt-[calc(max(var(--sb-text-min),0.7em)*1.2)]'

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
  /** A tap on a line reports where it came from in the ChordPro text - source line and column of
   * the tapped word or chord - so the song editor can put its cursor there (#607). Unset: the
   * lines are not tappable. */
  onSourceTap?: (sourceLine: number, column: number) => void
  /** Chords open their guitar shape and piano keys (#609): a click with the mouse, a long press on
   * touch. Unset: chords are plain text - the Prompter leaves it off during a running Gig. */
  chordInfo?: boolean
}

/** Column of a tap in the source line: the tapped segment's start, plus the character tapped
 * inside its lyric text where the browser can tell (caretRangeFromPoint). */
function tappedColumn(event: MouseEvent, lineElement: HTMLElement): number {
  const segment = (event.target as HTMLElement).closest<HTMLElement>('[data-source-offset]')
  if (!segment || !lineElement.contains(segment)) return 0
  const start = Number(segment.dataset.sourceOffset)
  const range = document.caretRangeFromPoint?.(event.clientX, event.clientY)
  const node = range?.startContainer
  // Only the segment's own lyric text node - not its chord, which sits in a child span.
  if (!range || !node || node.nodeType !== Node.TEXT_NODE || node.parentElement !== segment) return start
  return start + Number(segment.dataset.textStart ?? 0) + range.startOffset
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
  onSourceTap,
  chordInfo = false,
}: ChordProLyricsProps) {
  const [popover, setPopover] = useState<{ symbol: string; anchor: DOMRect } | null>(null)
  const closePopover = useCallback(() => setPopover(null), [])
  const press = useRef<{ timer: number; x: number; y: number } | null>(null)
  const pointerType = useRef('mouse')
  // The click that follows a long press must not also move the editor's cursor.
  const swallowClick = useRef(false)
  const chordAt = (target: EventTarget) => (chordInfo ? (target as HTMLElement).closest<HTMLElement>('[data-chord]') : null)
  // A finger is wider than a chord name (~20 px): a press beside it - on the lyric just below,
  // between two letters - takes the nearest chord within reach (Redmi, 2026-10-28: a long press a
  // few px off selected the lyric for copy/paste instead).
  const chordNear = (container: HTMLElement, target: EventTarget, x: number, y: number) =>
    chordAt(target) ?? (chordInfo ? nearestChord(container, x, y) : null)
  const open = (chord: HTMLElement) => setPopover({ symbol: chord.dataset.chord ?? '', anchor: chord.getBoundingClientRect() })
  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer)
    press.current = null
  }
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    pointerType.current = event.pointerType
    if (event.pointerType === 'mouse') return
    const chord = chordNear(event.currentTarget, event.target, event.clientX, event.clientY)
    if (!chord) return
    cancelPress()
    const timer = window.setTimeout(() => {
      press.current = null
      swallowClick.current = true
      open(chord)
    }, LONG_PRESS_MS)
    press.current = { timer, x: event.clientX, y: event.clientY }
  }
  const onPointerMove = (event: PointerEvent) => {
    if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > LONG_PRESS_SLOP_PX) cancelPress()
  }

  if (lines.length === 0) {
    return <p className="text-ink-faint">Kein Text.</p>
  }

  return (
    <div
      // No text selection where chords open their shape: a long press is for the chord, never the
      // copy/cut bar.
      className={`space-y-3 pt-4 font-sb-mono leading-loose text-ink ${onSourceTap ? 'cursor-text' : ''} ${chordInfo ? 'select-none [-webkit-touch-callout:none]' : ''}`}
      style={{ fontSize }}
      onPointerDown={chordInfo ? onPointerDown : undefined}
      onPointerMove={chordInfo ? onPointerMove : undefined}
      onPointerUp={chordInfo ? cancelPress : undefined}
      onPointerCancel={chordInfo ? cancelPress : undefined}
      onContextMenu={chordInfo ? (event) => chordNear(event.currentTarget, event.target, event.clientX, event.clientY) && event.preventDefault() : undefined}
      onClick={(event) => {
        if (swallowClick.current) {
          swallowClick.current = false
          return
        }
        const chord = pointerType.current === 'mouse' ? chordAt(event.target) : null
        if (chord) return open(chord)
        if (!onSourceTap) return
        const lineElement = (event.target as HTMLElement).closest<HTMLElement>('[data-source-line]')
        if (lineElement) onSourceTap(Number(lineElement.dataset.sourceLine), tappedColumn(event, lineElement))
      }}
    >
      {popover && <ChordPopover symbol={popover.symbol} anchor={popover.anchor} onClose={closePopover} />}
      {headerContent}
      {lines.map((line, offset) => {
        const lineIndex = startIndex + offset
        const previous = offset > 0 ? lines[offset - 1] : null
        const startsPart = line.partLabel !== null && line.partIndex !== previous?.partIndex
        return (
          <ProLine
            key={lineIndex}
            line={line}
            lineIndex={lineIndex}
            active={lineIndex === activeIndex}
            startsPart={startsPart}
            hidePartLabels={hidePartLabels}
            chordFontSize={chordFontSize}
            commentFontSize={commentFontSize}
            chordInfo={chordInfo}
          />
        )
      })}
    </div>
  )
}

/**
 * One line of the song - memoized (#457): while a song plays the Prompter re-renders with the
 * clock every frame, but a line only changes when it becomes or stops being the active one.
 */
const ProLine = memo(function ProLine({
  line,
  lineIndex,
  active,
  startsPart,
  hidePartLabels,
  chordFontSize,
  commentFontSize,
  chordInfo,
}: {
  line: ChordProLine
  lineIndex: number
  active: boolean
  startsPart: boolean
  hidePartLabels: boolean
  chordFontSize: number | undefined
  commentFontSize: number | undefined
  chordInfo: boolean
}) {
  return (
    <div>
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
          data-source-line={line.sourceLine}
          data-active-line={active || undefined}
          className={`-mx-2 overflow-x-auto rounded-control px-2 transition-colors duration-300 ${
            !hidePartLabels && startsPart ? 'mt-6' : ''
          } ${active ? 'bg-accent-2/20' : ''}`}
        >
          {line.tab.label && <p className="font-sans text-xs italic text-ink-faint">{line.tab.label}</p>}
          <pre className="font-sb-mono leading-snug text-ink-soft" style={{ fontSize: 'max(var(--sb-text-min), 0.8em)' }}>
            {line.tab.lines.join('\n')}
          </pre>
        </div>
      ) : isChordOnlyLine(line) ? (
        // Instrumental chord row: chords inline, in the accent colour - they are the content of
        // this row, not an annotation above it. The whole row at the chord size, bars and spaces
        // too (Marco, 2026-10-17: lyric-size chords next to chord-size ones, then small bars next
        // to big chords, both looked odd).
        <p
          data-line-index={lineIndex}
          data-source-line={line.sourceLine}
          data-active-line={active || undefined}
          style={chordFontSize === undefined ? undefined : { fontSize: stageFontSize(chordFontSize) }}
          className={`-mx-2 whitespace-pre-wrap break-words rounded-control px-2 transition-colors duration-300 ${
            !hidePartLabels && startsPart ? 'mt-6' : ''
          } ${active ? 'bg-accent-2/20' : ''}`}
        >
          {line.segments.map((segment, segmentIndex) => (
            <span key={segmentIndex} data-source-offset={segment.sourceOffset}>
              {segment.chord && (
                <span data-chord={segment.chord} className={`font-bold text-accent ${chordInfo ? CHORD_TAPPABLE : ''}`}>
                  {segment.chord}
                </span>
              )}
              <span className="text-ink-faint">{segment.text}</span>
            </span>
          ))}
        </p>
      ) : line.comment !== null ? (
        // Musician-facing note (issue #215), not part of the lyric - font-sans italic
        // sets it apart from the lyric's own font-sb-mono, same way a part label does.
        <p
          data-line-index={lineIndex}
          data-source-line={line.sourceLine}
          data-active-line={active || undefined}
          style={commentFontSize === undefined ? undefined : { fontSize: stageFontSize(commentFontSize) }}
          className={`${commentFontSize === undefined ? STAGE_SMALL_TEXT : ''} -mx-2 rounded-control px-2 font-sans italic text-ink-faint transition-colors duration-300 ${
            !hidePartLabels && startsPart ? 'mt-6' : ''
          } ${active ? 'bg-accent-2/20' : ''}`}
        >
          {line.comment}
        </p>
      ) : (
        <LyricLine
          line={line}
          lineIndex={lineIndex}
          active={active}
          startsPart={!hidePartLabels && startsPart}
          chordFontSize={chordFontSize}
          chordInfo={chordInfo}
        />
      )}
    </div>
  )
})

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
  chordInfo,
}: {
  line: ChordProLine
  lineIndex: number
  active: boolean
  startsPart: boolean
  chordFontSize: number | undefined
  chordInfo: boolean
}) {
  const hasChords = line.segments.some((segment) => segment.chord !== null)
  const chordStyle = chordFontSize === undefined ? undefined : { fontSize: stageFontSize(chordFontSize) }
  const chordSizeClass = chordFontSize === undefined ? STAGE_SMALL_TEXT : ''
  const lineStyle = hasChords ? { lineHeight: 1.375 } : undefined
  // The chord room sits on every segment, not on the line (#416): a line that wraps then has room
  // for chords on each of its visual lines - with the room only at the top of the line, the
  // chords of a wrapped part hung into the line above.
  const segmentRoomStyle =
    hasChords && chordFontSize !== undefined ? { paddingTop: `${stageFontSize(chordFontSize) * 1.2}px` } : undefined
  const segmentRoomClass = hasChords && chordFontSize === undefined ? STAGE_CHORD_ROOM : ''

  return (
    <p
      data-line-index={lineIndex}
      data-source-line={line.sourceLine}
      data-active-line={active || undefined}
      style={lineStyle}
      className={`-mx-2 whitespace-pre-wrap break-words rounded-control px-2 transition-colors duration-300 ${
        // Keeps a little air between a part label and its first line.
        startsPart ? 'mt-6' : ''
      } ${active ? 'bg-accent-2/20' : ''}`}
    >
      {line.segments.map((segment, segmentIndex) => (
        <span
          key={segmentIndex}
          data-source-offset={segment.sourceOffset}
          // The lyric text starts after the chord's "[...]" in the source.
          data-text-start={segment.chord === null ? 0 : segment.chord.length + 2}
          style={segmentRoomStyle}
          className={`${segmentRoomClass} relative inline-block`}
        >
          {segment.chord && (
            <span
              data-chord={segment.chord}
              style={{ ...chordStyle, lineHeight: 1.15 }}
              className={`${chordSizeClass} absolute left-0 top-0 font-bold text-accent ${chordInfo ? CHORD_TAPPABLE : ''}`}
            >
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
                // lineHeight 0: only its width counts. A chord larger than the lyrics otherwise made
                // this segment taller, and its chord stood higher than the others (Marco, 2026-10-17).
                <span aria-hidden="true" style={{ ...chordStyle, lineHeight: 0 }} className={`${chordSizeClass} invisible pr-[0.6em] font-bold`}>
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

/** The chord name in `container` nearest to the point, if one lies within CHORD_REACH_PX of it. */
export function nearestChord(container: HTMLElement, x: number, y: number): HTMLElement | null {
  let best: { chord: HTMLElement; distance: number } | null = null
  for (const chord of container.querySelectorAll<HTMLElement>('[data-chord]')) {
    const r = chord.getBoundingClientRect()
    const dx = Math.max(r.left - x, 0, x - r.right)
    const dy = Math.max(r.top - y, 0, y - r.bottom)
    const distance = Math.hypot(dx, dy)
    if (distance <= CHORD_REACH_PX && (!best || distance < best.distance)) best = { chord, distance }
  }
  return best?.chord ?? null
}

import { clearLineTimeTag, parsePartDirective, parseTimeTag, setLineTimeTag, tappableLines } from './chordpro'

/**
 * The song text on the timeline (docs/14 §6, phase 2): every lyric line with its time tag, and
 * the song parts as blocks. Works on the raw ChordPro text so edits write the time tag of exactly
 * that line (`[mm:ss.xx]` at the line start - what the Prompter scrolls by) and leave everything
 * else untouched. Pure, no DOM.
 */

/** Two lines' time tags stay at least this far apart - a marker can't pass its neighbour. */
export const MIN_LINE_GAP_MS = 100

export interface TimelineLine {
  /** Index of the line in the raw ChordPro text (`content.split('\n')`). */
  rawIndex: number
  timeMs: number | null
  /** The lyric without chords and time tag. */
  text: string
  /** The song part the line belongs to (0 before the first part directive) and its label. */
  partIndex: number
  partLabel: string | null
}

/** Every lyric line (the lines Tap-to-Sync may stamp - see `tappableLines` - minus directive
 * lines), in text order. */
export function timelineLines(content: string): TimelineLine[] {
  const raw = content.split('\n')
  const tappable = tappableLines(raw)
  const lines: TimelineLine[] = []
  let partIndex = 0
  let partLabel: string | null = null
  let partStarted = false
  raw.forEach((line, rawIndex) => {
    const directive = parsePartDirective(line)
    if (directive) {
      if (partStarted) partIndex += 1
      partLabel = directive.label
      partStarted = false
      return
    }
    if (!tappable[rawIndex]) return
    const { timeMs, rest } = parseTimeTag(line)
    // Metadata directives ({title: …}, {key: …}) aren't sung - no place on the time axis.
    if (/^\{[^}]*\}$/.test(rest.trim())) return
    lines.push({ rawIndex, timeMs, text: rest.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim(), partIndex, partLabel })
    partStarted = true
  })
  return lines
}

/** Where line `rawIndex` may go: between the nearest tagged lines before and after it. */
export function lineTimeBounds(lines: readonly TimelineLine[], rawIndex: number): { minMs: number; maxMs: number } {
  const i = lines.findIndex((l) => l.rawIndex === rawIndex)
  let minMs = 0
  let maxMs = Infinity
  for (let k = i - 1; k >= 0; k--) {
    const t = lines[k]!.timeMs
    if (t !== null) {
      minMs = t + MIN_LINE_GAP_MS
      break
    }
  }
  for (let k = i + 1; k < lines.length; k++) {
    const t = lines[k]!.timeMs
    if (t !== null) {
      maxMs = t - MIN_LINE_GAP_MS
      break
    }
  }
  return { minMs, maxMs }
}

/** Sets (or, with `null`, removes) the time tag of line `rawIndex`; a time is kept between the
 * neighbouring tagged lines. */
export function setLineTime(content: string, rawIndex: number, ms: number | null): string {
  const raw = content.split('\n')
  const line = raw[rawIndex]
  if (line === undefined) return content
  if (ms === null) {
    raw[rawIndex] = clearLineTimeTag(line)
  } else {
    const { minMs, maxMs } = lineTimeBounds(timelineLines(content), rawIndex)
    raw[rawIndex] = setLineTimeTag(line, Math.round(Math.min(Math.max(ms, minMs), Math.max(minMs, maxMs))))
  }
  return raw.join('\n')
}

/** A row of chords only (`| C | F | G | G |`, `[C] [G]`) - nothing left to sing once the chords
 * are gone. Shown on the timeline, but skipped when tapping lines (#325). */
export function isChordOnlyLine(line: TimelineLine): boolean {
  return !/[\p{L}\p{N}]/u.test(line.text)
}

/** The lines "Zeilen tippen" goes through: every lyric line except chord-only rows. */
export function tapLines(lines: readonly TimelineLine[]): TimelineLine[] {
  return lines.filter((l) => !isChordOnlyLine(l))
}

/** The line tapping starts at: the selected one (or the next lyric after a selected chord row),
 * else the first without a time, else the first. Chord-only rows are never the start. */
export function tapStartLine(lines: readonly TimelineLine[], selectedRawIndex: number | null): TimelineLine | null {
  const tappable = tapLines(lines)
  if (selectedRawIndex !== null) {
    const fromSelected = tappable.find((l) => l.rawIndex >= selectedRawIndex)
    if (fromSelected && lines.some((l) => l.rawIndex === selectedRawIndex)) return fromSelected
  }
  return tappable.find((l) => l.timeMs === null) ?? tappable[0] ?? null
}

/** "Zeilen tippen": one tap per line, in text order from `fromRawIndex`, chord-only rows skipped -
 * the tapped lines get the tap times, every other line keeps its tag. Extra taps past the last
 * line are ignored. */
export function stampLines(content: string, fromRawIndex: number, tapsMs: readonly number[]): string {
  const lines = tapLines(timelineLines(content))
  const start = lines.findIndex((l) => l.rawIndex === fromRawIndex)
  if (start < 0) return content
  const raw = content.split('\n')
  tapsMs.forEach((ms, k) => {
    const line = lines[start + k]
    if (line) raw[line.rawIndex] = setLineTimeTag(raw[line.rawIndex]!, Math.round(ms))
  })
  return raw.join('\n')
}

export interface PartBlock {
  partIndex: number
  label: string | null
  startMs: number
  endMs: number
}

/** The song parts as blocks on the time axis: each from its first timed line to the next part's
 * start (the last one to `endMs`). Parts without any timed line have no place yet and are left
 * out. */
export function partBlocks(lines: readonly TimelineLine[], endMs: number): PartBlock[] {
  const starts: { partIndex: number; label: string | null; startMs: number }[] = []
  for (const line of lines) {
    if (line.timeMs === null) continue
    const last = starts[starts.length - 1]
    if (last?.partIndex === line.partIndex) continue
    starts.push({ partIndex: line.partIndex, label: line.partLabel, startMs: line.timeMs })
  }
  return starts.map((s, i) => ({ ...s, endMs: starts[i + 1]?.startMs ?? Math.max(endMs, s.startMs) }))
}

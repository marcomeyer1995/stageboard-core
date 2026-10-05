import type { BeatGrid, ShowCue } from 'shared-types'
import { setLineTimeTag } from './chordpro'
import { randomId } from './id'
import { formatTimelineTime } from './timeline'
import { timelineLines } from './timelineText'

export interface RippleInput {
  beatGrid: BeatGrid | undefined
  chordProContent: string
  cues: ShowCue[]
}

export type RippleResult =
  | ({ ok: true; moved: { points: number; lines: number; cues: number } } & RippleInput)
  | { ok: false; message: string }

/**
 * "Alles danach verschieben" (#330): moves every alignment point, lyric time tag and cue at or
 * after `fromMs` by `deltaMs` - e.g. after replacing a backing track that has two seconds more
 * silence at the start. Notes follow on their own (they belong to their lines). Relative
 * distances stay exact. Refused, with a message, if anything would land before 0:00 or overtake
 * an earlier point/line that stays where it is.
 *
 * `anchorBar`: the selected bar line, when it is not an alignment point yet - it becomes one at
 * its current time first, so it moves along and the stretch before it absorbs the shift.
 */
export function rippleShift(
  input: RippleInput,
  fromMs: number,
  deltaMs: number,
  anchorBar?: { bar: number; timeMs: number },
): RippleResult {
  const delta = Math.round(deltaMs)
  if (delta === 0) return { ok: false, message: 'Verschiebung 0 ms - nichts zu tun.' }

  // Grid points.
  let points = input.beatGrid ? [...input.beatGrid.points] : []
  if (anchorBar && input.beatGrid && !points.some((p) => p.bar === anchorBar.bar)) {
    points = [...points, { id: randomId(), bar: anchorBar.bar, timeMs: Math.round(anchorBar.timeMs) }].sort((a, b) => a.bar - b.bar)
  }
  const movingPoints = points.filter((p) => p.timeMs >= fromMs)
  const stayingPoints = points.filter((p) => p.timeMs < fromMs)

  // Lyric lines with a time.
  const timed = timelineLines(input.chordProContent).filter((l) => l.timeMs !== null) as Array<{ rawIndex: number; timeMs: number; text: string }>
  const movingLines = timed.filter((l) => l.timeMs >= fromMs)
  const stayingLines = timed.filter((l) => l.timeMs < fromMs)

  const movingCues = input.cues.filter((c) => c.timeMs >= fromMs)

  const firstMoving = Math.min(...movingPoints.map((p) => p.timeMs), ...movingLines.map((l) => l.timeMs), ...movingCues.map((c) => c.timeMs))
  if (!Number.isFinite(firstMoving)) return { ok: false, message: 'Ab hier gibt es nichts zu verschieben.' }
  if (firstMoving + delta < 0) {
    return { ok: false, message: `Das würde vor 0:00 rutschen (frühestens um −${formatTimelineTime(firstMoving)} möglich).` }
  }
  if (delta < 0) {
    const lastStayingPoint = Math.max(...stayingPoints.map((p) => p.timeMs))
    const firstMovingPoint = Math.min(...movingPoints.map((p) => p.timeMs))
    if (Number.isFinite(lastStayingPoint) && Number.isFinite(firstMovingPoint) && firstMovingPoint + delta <= lastStayingPoint) {
      return { ok: false, message: 'Das würde einen früheren Ausrichtungspunkt überholen.' }
    }
    const lastStayingLine = Math.max(...stayingLines.map((l) => l.timeMs))
    const firstMovingLine = Math.min(...movingLines.map((l) => l.timeMs))
    if (Number.isFinite(lastStayingLine) && Number.isFinite(firstMovingLine) && firstMovingLine + delta < lastStayingLine) {
      return { ok: false, message: 'Das würde eine frühere Liedzeile überholen.' }
    }
  }

  const beatGrid = input.beatGrid
    ? { ...input.beatGrid, points: points.map((p) => (p.timeMs >= fromMs ? { ...p, timeMs: p.timeMs + delta } : p)) }
    : undefined
  const raw = input.chordProContent.split('\n')
  for (const line of movingLines) raw[line.rawIndex] = setLineTimeTag(raw[line.rawIndex], line.timeMs + delta)
  const cues = input.cues.map((c) => (c.timeMs >= fromMs ? { ...c, timeMs: c.timeMs + delta } : c))

  return {
    ok: true,
    beatGrid,
    chordProContent: raw.join('\n'),
    cues,
    moved: { points: movingPoints.length, lines: movingLines.length, cues: movingCues.length },
  }
}

/** "2", "-1,5", "+0.25" seconds -> ms; null if it isn't a number. */
export function parseShiftSeconds(text: string): number | null {
  const cleaned = text.trim().replace(',', '.').replace(/\s*s$/i, '')
  if (!/^[+-]?\d+(\.\d+)?$/.test(cleaned)) return null
  return Math.round(Number(cleaned) * 1000)
}

/**
 * Pure logic behind the timeline editor (docs/14): the view (which stretch of the song is on
 * screen, how zoomed), the quality colour per bar and formatting. The grid itself lives in
 * beatGrid.ts. No DOM here, so it is testable.
 */

/** A beat of the grid as the quality check needs it. */
export interface TimelineBeat {
  timeMs: number
  beatInBar: number
}

export interface TimelineView {
  /** Song time at the left edge, ms (may be negative: the count-in). */
  startMs: number
  /** Zoom: song ms per screen pixel. */
  msPerPx: number
}

export const MIN_MS_PER_PX = 1 // ~1 s across 1000 px - individual beats far apart
export const MAX_MS_PER_PX = 400 // a whole song on a phone screen

export const timeToX = (ms: number, view: TimelineView) => (ms - view.startMs) / view.msPerPx
export const xToTime = (x: number, view: TimelineView) => view.startMs + x * view.msPerPx

/** Zooms by `factor` (> 1 = further out) keeping the song time under `anchorX` in place. */
export function zoomAround(view: TimelineView, factor: number, anchorX: number): TimelineView {
  const msPerPx = Math.min(MAX_MS_PER_PX, Math.max(MIN_MS_PER_PX, view.msPerPx * factor))
  const anchorMs = xToTime(anchorX, view)
  return { msPerPx, startMs: anchorMs - anchorX * msPerPx }
}

/** Keeps the view within [minMs, maxMs] (the song plus its count-in), with a little margin. */
export function clampView(view: TimelineView, widthPx: number, minMs: number, maxMs: number): TimelineView {
  const span = widthPx * view.msPerPx
  const margin = Math.min(2000, span * 0.1)
  const lo = minMs - margin
  const hi = Math.max(lo, maxMs + margin - span)
  return { ...view, startMs: Math.min(hi, Math.max(lo, view.startMs)) }
}

export type BarQualityLevel = 'good' | 'ok' | 'poor' | 'quiet'

export interface BarQuality {
  startMs: number
  endMs: number
  /** Share of the bar's beats with an onset within `windowMs`. */
  share: number
  level: BarQualityLevel
}

/** How well each bar's beats sit on the track's onsets - the timeline's quality colour. A bar
 * without any onset near it at all (a quiet passage, a fermata) is 'quiet', not 'poor'. */
export function barQuality(beats: readonly TimelineBeat[], onsetsMs: readonly number[], windowMs = 50): BarQuality[] {
  const sorted = [...onsetsMs].sort((a, b) => a - b)
  const nearest = (t: number) => {
    let lo = 0, hi = sorted.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid]! < t) lo = mid + 1
      else hi = mid
    }
    const candidates = [sorted[lo - 1], sorted[lo]].filter((x): x is number => x !== undefined)
    return candidates.length ? Math.min(...candidates.map((c) => Math.abs(c - t))) : Infinity
  }
  const bars: BarQuality[] = []
  let current: number[] = []
  const flush = (endMs: number) => {
    if (current.length === 0) return
    const distances = current.map(nearest)
    const hits = distances.filter((d) => d <= windowMs).length
    const share = hits / current.length
    const quiet = distances.every((d) => d > 3 * windowMs)
    const level: BarQualityLevel = quiet ? 'quiet' : share >= 0.75 ? 'good' : share >= 0.5 ? 'ok' : 'poor'
    bars.push({ startMs: current[0]!, endMs, share, level })
    current = []
  }
  beats.forEach((beat, i) => {
    if (beat.beatInBar === 0 && current.length) flush(beat.timeMs)
    current.push(beat.timeMs)
    if (i === beats.length - 1) flush(beat.timeMs + (beats.length > 1 ? beat.timeMs - beats[i - 1]!.timeMs : 0))
  })
  return bars
}

/**
 * The next bar after `afterMs` that needs a look: red ('poor') first; when no bar is red, orange
 * ('ok'). Wraps around to the song start, so repeated presses cycle through all of them. Null
 * when every bar is fine or quiet.
 */
export function nextProblemBar(bars: readonly BarQuality[], afterMs: number): BarQuality | null {
  const level: BarQualityLevel | null = bars.some((b) => b.level === 'poor') ? 'poor' : bars.some((b) => b.level === 'ok') ? 'ok' : null
  if (!level) return null
  const candidates = bars.filter((b) => b.level === level)
  return candidates.find((b) => b.startMs > afterMs + 1) ?? candidates[0]!
}

/** "1:23.4", "-0:02.0" (count-in) - timeline readout with tenths. */
export function formatTimelineTime(ms: number): string {
  const negative = ms < 0
  const abs = Math.abs(ms)
  const tenths = Math.round(abs / 100)
  const minutes = Math.floor(tenths / 600)
  const seconds = (tenths % 600) / 10
  return `${negative ? '-' : ''}${minutes}:${seconds.toFixed(1).padStart(4, '0')}`
}

/**
 * A colour token as a canvas colour. The app's tokens hold bare channels ("255 255 255") for
 * Tailwind's `rgb(var(--sb-ink) / <alpha>)` - a canvas ignores such a string without an error
 * and keeps its previous colour (on the tablet the waveform and grid lines simply didn't draw).
 */
export function tokenColor(value: string, fallback: string): string {
  const v = value.trim()
  if (!v) return fallback
  if (/^\d+(\.\d+)?\s+\d+(\.\d+)?\s+\d+(\.\d+)?$/.test(v)) return `rgb(${v})`
  return v
}

/** Label every n-th bar (1, 2, 4, 8 …) so bar numbers never overlap: at least `minPx` apart. */
export function barLabelEvery(barPx: number, minPx = 36): number {
  let every = 1
  while (every * barPx < minPx && every < 1024) every *= 2
  return every
}

/**
 * Text wrapped word by word into rows no wider than `maxPx` (as `measure` reports it), at most
 * `maxRows` of them - the timeline's text lane shows a lyric over several rows instead of a few
 * words. When the text doesn't fit, the last row ends in "…"; a single word wider than a row is
 * cut the same way. Nothing at all when not even a short word fits.
 */
export function wrapText(text: string, maxPx: number, maxRows: number, measure: (s: string) => number): string[] {
  if (maxRows < 1 || measure('W…') > maxPx) return []
  const cut = (s: string) => {
    if (measure(s) <= maxPx) return s
    let t = s
    while (t.length > 1 && measure(`${t}…`) > maxPx) t = t.slice(0, -1)
    return `${t}…`
  }
  const words = text.split(/\s+/).filter(Boolean)
  const rows: string[] = []
  let row = ''
  let i = 0
  for (; i < words.length && rows.length < maxRows; i++) {
    const candidate = row ? `${row} ${words[i]}` : words[i]!
    if (measure(candidate) <= maxPx) {
      row = candidate
    } else if (row) {
      rows.push(row)
      row = ''
      i-- // the word starts the next row
    } else {
      rows.push(cut(words[i]!))
    }
  }
  if (row && rows.length < maxRows) rows.push(row)
  else if (row) i-- // the last word never made it into a row
  if (i < words.length && rows.length > 0) rows[rows.length - 1] = cut(`${rows[rows.length - 1]!} ${words.slice(i).join(' ')}`)
  return rows
}

/** Alternating part block fills, so neighbouring parts stay apart (lanes and minimap). */
export const PART_FILL = ['rgba(59,130,246,0.35)', 'rgba(168,85,247,0.35)'] as const

/** The overview strip (#327) maps the whole song, `fromMs`..`toMs`, onto its width. */
export interface MinimapRange {
  fromMs: number
  toMs: number
}

/** Strip x of song time `ms`. */
export function minimapX(ms: number, range: MinimapRange, widthPx: number): number {
  const span = Math.max(1, range.toMs - range.fromMs)
  return ((ms - range.fromMs) / span) * widthPx
}

/** Song time at strip x. */
export function minimapTime(x: number, range: MinimapRange, widthPx: number): number {
  const span = Math.max(1, range.toMs - range.fromMs)
  return range.fromMs + (x / Math.max(1, widthPx)) * span
}

/** Where the view starts when the strip is touched at `x`: a touch inside the visible box keeps
 * the box under the finger where it was grabbed (`grabMs` = touched time minus the view start),
 * a touch outside centres the view there. Returns that offset too, for the rest of the drag. */
export function minimapGrab(x: number, range: MinimapRange, widthPx: number, view: TimelineView, viewSpanMs: number): { startMs: number; grabMs: number } {
  const t = minimapTime(x, range, widthPx)
  const inside = t >= view.startMs && t <= view.startMs + viewSpanMs
  const grabMs = inside ? t - view.startMs : viewSpanMs / 2
  return { startMs: t - grabMs, grabMs }
}


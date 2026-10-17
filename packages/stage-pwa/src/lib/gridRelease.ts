import type { ClickTimeline } from './beatGrid'
import { computeActiveMs, jumpBoundaryMs, type TransportState } from './playbackTransport'

/**
 * "Auf den Takt" for a timed release (docs/23 §4a): the server time of the bar line (or beat)
 * `amount` bars (beats) after the press. The press counts from the nearest line - a press just
 * after or just before the one both count from that one. Counted on the song's grid, so a tempo
 * change in the song is followed; a section jump queued before the target is followed too (the
 * rest is counted from the jump's target). Null while the song isn't playing - then there is no
 * grid to land on.
 */
export function gridReleaseAt(timeline: ClickTimeline, transport: TransportState, now: number, amount: number, unit: 'beats' | 'bars'): number | null {
  if (transport.status !== 'playing' || transport.startedAt === null) return null
  const position = computeActiveMs(transport, now)
  const target = lineAfter(timeline, nearestLine(timeline, position, unit), amount, unit)
  const targetMs = timeline.timeOfBeat(target)

  const boundary = transport.jump && now < transport.jump.at ? jumpBoundaryMs(transport) : null
  if (boundary === null || targetMs <= boundary || !transport.jump) return now + (targetMs - position)
  // The jump comes first: what is left after its boundary is counted on from where it lands.
  const fromBeat = timeline.beatAtOrBefore(boundary + 1)
  const toBeat = timeline.beatAtOrBefore(transport.jump.toMs + 1)
  const rest = unit === 'bars' ? timeline.barOf(target) - timeline.barOf(fromBeat) : target - fromBeat
  const landing = timeline.timeOfBeat(unit === 'bars' ? timeline.barStartBeat(timeline.barOf(toBeat) + rest) : toBeat + rest)
  return transport.jump.at + (landing - transport.jump.toMs)
}

/** The beat (bars: the bar's first beat) nearest to a song time. */
function nearestLine(timeline: ClickTimeline, timeMs: number, unit: 'beats' | 'bars'): number {
  const beat = timeline.beatAtOrBefore(timeMs)
  if (unit === 'beats') return timeMs - timeline.timeOfBeat(beat) > timeline.periodAfter(beat) / 2 ? beat + 1 : beat
  const bar = timeline.barOf(beat)
  const start = timeline.barStartBeat(bar)
  const next = timeline.barStartBeat(bar + 1)
  return timeMs - timeline.timeOfBeat(start) > timeline.timeOfBeat(next) - timeMs ? next : start
}

function lineAfter(timeline: ClickTimeline, line: number, amount: number, unit: 'beats' | 'bars'): number {
  return unit === 'beats' ? line + amount : timeline.barStartBeat(timeline.barOf(line) + amount)
}

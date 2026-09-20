import type { ChordProLine } from './chordpro'

export interface LoopSection {
  label: string
  startMs: number
  /** Where the next section starts, or the track's end for the last one - null when neither is known. */
  endMs: number | null
}

/**
 * The song's timestamped parts (Verse 2, Chorus, ...) as loop endpoints (#61) - the same
 * `{part:}` blocks and `[mm:ss]` time tags the Prompter's section highlighting uses. A part with
 * no time tag on any of its lines has no position on the track, so it cannot be a loop point.
 */
export function loopSections(lines: readonly ChordProLine[], trackDurationMs: number | null): LoopSection[] {
  const starts: { label: string; startMs: number }[] = []
  const seenParts = new Set<number>()
  for (const line of lines) {
    if (line.partLabel === null || line.timeMs === null || seenParts.has(line.partIndex)) continue
    seenParts.add(line.partIndex)
    starts.push({ label: line.partLabel, startMs: line.timeMs })
  }
  starts.sort((a, b) => a.startMs - b.startMs)
  return starts.map((section, index) => ({
    ...section,
    endMs: starts[index + 1]?.startMs ?? trackDurationMs,
  }))
}

/** `83400` -> `1:23.4`, the readout for a loop endpoint. */
export function formatLoopTime(ms: number): string {
  const totalSeconds = Math.max(0, ms) / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds - minutes * 60
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`
}

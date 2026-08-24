export interface ChordSegment {
  chord: string | null
  text: string
}

export interface ChordProLine {
  timeMs: number | null
  segments: ChordSegment[]
}

const TIME_TAG_RE = /^\[(\d{2}):(\d{2}(?:\.\d+)?)\]\s*/
const CHORD_RE = /\[([^\]]+)\]/g

function parseTimeTag(line: string): { timeMs: number | null; rest: string } {
  const match = line.match(TIME_TAG_RE)
  if (!match) return { timeMs: null, rest: line }
  const minutes = Number(match[1])
  const seconds = Number(match[2])
  const timeMs = Math.round((minutes * 60 + seconds) * 1000)
  return { timeMs, rest: line.slice(match[0].length) }
}

function parseChordSegments(line: string): ChordSegment[] {
  const segments: ChordSegment[] = []
  let lastIndex = 0
  let pendingChord: string | null = null
  let match: RegExpExecArray | null
  CHORD_RE.lastIndex = 0

  while ((match = CHORD_RE.exec(line)) !== null) {
    const textBefore = line.slice(lastIndex, match.index)
    if (textBefore.length > 0 || pendingChord !== null) {
      segments.push({ chord: pendingChord, text: textBefore })
    }
    pendingChord = match[1]
    lastIndex = CHORD_RE.lastIndex
  }

  segments.push({ chord: pendingChord, text: line.slice(lastIndex) })
  return segments
}

/** Parses ChordPro-formatted text (e.g. `[01:14.50] I shot the [G] Sheriff`) into lines of chord/text segments. */
export function parseChordPro(content: string): ChordProLine[] {
  return content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const { timeMs, rest } = parseTimeTag(line)
      return { timeMs, segments: parseChordSegments(rest) }
    })
}

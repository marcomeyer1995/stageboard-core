const CHORD_TAG_RE = /\[ch\]([^[]*)\[\/ch\]/g

/** True for a line that, once chord tags are stripped, is nothing but whitespace - i.e. a
 * line of chords sitting alone rather than above a lyric line. */
function isChordOnlyLine(line: string): boolean {
  if (!line.includes('[ch]')) return false
  return line.replace(CHORD_TAG_RE, '').trim() === ''
}

/** Each chord's column position in the *tag-stripped* version of the line - the position it
 * would occupy once `[ch]`/`[/ch]` are gone, which is what lines it up against the lyric
 * line's characters. */
function extractChordPositions(chordLine: string): Array<{ pos: number; chord: string }> {
  const positions: Array<{ pos: number; chord: string }> = []
  let strippedLength = 0
  let lastIndex = 0
  CHORD_TAG_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CHORD_TAG_RE.exec(chordLine)) !== null) {
    strippedLength += match.index - lastIndex
    positions.push({ pos: strippedLength, chord: match[1] })
    // The chord name itself still occupies columns in the untagged line - only the [ch]/[/ch]
    // wrapper disappears - so it has to count toward where the *next* chord's gap starts.
    strippedLength += match[1].length
    lastIndex = CHORD_TAG_RE.lastIndex
  }
  return positions
}

/** Merges a chord line's chords into the lyric line beneath it, at the same column offsets -
 * UG positions chords above lyrics by whitespace alignment; StageBoard's ChordPro wants them
 * inline (`[G]text`). */
function spliceChordsIntoLyric(lyricLine: string, positions: Array<{ pos: number; chord: string }>): string {
  let result = ''
  let cursor = 0
  for (const { pos, chord } of positions) {
    const clamped = Math.min(pos, lyricLine.length)
    result += lyricLine.slice(cursor, clamped) + `[${chord}]`
    cursor = clamped
  }
  return result + lyricLine.slice(cursor)
}

/** A standalone chord line (no lyric beneath it, e.g. an instrumental intro) becomes inline
 * chords with nothing but the original whitespace between them. */
function chordsOnlyLineToInline(chordLine: string): string {
  let result = ''
  let lastIndex = 0
  CHORD_TAG_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CHORD_TAG_RE.exec(chordLine)) !== null) {
    result += chordLine.slice(lastIndex, match.index) + `[${match[1]}]`
    lastIndex = CHORD_TAG_RE.lastIndex
  }
  return result + chordLine.slice(lastIndex)
}

/** `[Verse 1]`, `[Intro]`, `[Chorus]` - anything that's a single bracketed token on its own
 * line and isn't one of UG's own markup tags. */
function sectionLabel(line: string): string | null {
  const match = line.trim().match(/^\[([^\]]+)\]$/)
  if (!match) return null
  if (/^\/?(ch|tab)$/.test(match[1])) return null
  return match[1]
}

/**
 * Converts Ultimate Guitar's chord-sheet markup (`[ch]G[/ch]` tags on their own line above
 * the lyrics, `[Verse 1]` section headers, `[tab]...[/tab]` wrapping both) into StageBoard's
 * ChordPro (`[G]text` inline, `{part: Verse 1}` directives - see chordpro.ts). Pure and unit
 * tested against real content pulled from a live tab page; no network involved here.
 */
export function convertUltimateGuitarContent(raw: string): string {
  const rawLines = raw.replace(/\r\n/g, '\n').split('\n').map((line) => line.replace(/\[\/?tab\]/g, ''))

  const output: string[] = []
  let i = 0
  while (i < rawLines.length) {
    const line = rawLines[i]

    const label = sectionLabel(line)
    if (label !== null) {
      output.push(`{part: ${label}}`)
      i += 1
      continue
    }

    if (isChordOnlyLine(line)) {
      const next = rawLines[i + 1]
      const nextIsLyric = next !== undefined && next.trim() !== '' && !isChordOnlyLine(next) && sectionLabel(next) === null
      if (nextIsLyric) {
        output.push(spliceChordsIntoLyric(next, extractChordPositions(line)))
        i += 2
      } else {
        output.push(chordsOnlyLineToInline(line))
        i += 1
      }
      continue
    }

    output.push(line)
    i += 1
  }

  return output.join('\n')
}

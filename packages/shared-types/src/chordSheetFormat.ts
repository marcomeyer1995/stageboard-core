// "Akkordzeilen zusammenführen" (#605) for pasted text. The `[ch]` tag below is only this file's internal way of marking a chord; reading a website's
// markup (Ultimate Guitar's included) is the business of the add-on that imports from it, not of StageBoard (#964).
const CHORD_TAG_RE = /\[ch\]([^[]*)\[\/ch\]/g

/** A chord symbol UG forgot to wrap in `[ch]` (seen live: `Em7add#5`, `G13sus4/E` on Hotel
 * California's chord lines). Deliberately strict - a root plus only chord-quality vocabulary -
 * so ordinary words ("Be", "Go", "Am I") don't pass as chords. Only ever consulted on a line
 * that already has at least one tagged chord. */
const UNTAGGED_CHORD_RE = /^[A-G][#b]?(?:maj|min|dim|aug|sus|add|m|M|\+|°|ø|[#b]|\d+)*(?:\/[A-G][#b]?)?$/
/** `x4`, `2x`, `(x2)` - how often a chord line repeats. */
const REPEAT_MARK_RE = /^\(?(?:x\s?\d+|\d+\s?x)\)?,?$/i
/** "No chord" - kept as a chord symbol (`[N.C.]`), a common ChordPro convention that
 * transposeChord already leaves untouched. */
const NO_CHORD_RE = /^N\.?C\.?$/i
/** Bar lines and similar layout characters between chords (`| C | F |`, `C - G`, `C / / /`). */
const DECORATION_RE = /^[|\-/.*:%>~,]+$/

interface ChordLineToken {
  /** The column this token aligns to against the lyric line beneath. */
  pos: number
  /** Where `text` itself sits in the tag-stripped line - differs from `pos` only for a wrapped
   * chord like "(C)", whose alignment column is the "(" but whose name starts one later. */
  sourcePos: number
  text: string
  /** `chord` becomes `[text]`; `annotation` (repeat marks, parenthetical comments) is kept as
   * text; `decoration` (bars, parentheses around a chord) is layout only. */
  kind: 'chord' | 'annotation' | 'decoration'
}

/** The line with every `[ch]X[/ch]` replaced by `X`, plus each tagged chord's column in that
 * stripped line - the column that lines it up against the lyric line beneath. */
function stripChordTags(line: string): { stripped: string; tagged: Array<{ pos: number; chord: string }> } {
  const tagged: Array<{ pos: number; chord: string }> = []
  let stripped = ''
  let lastIndex = 0
  CHORD_TAG_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CHORD_TAG_RE.exec(line)) !== null) {
    stripped += line.slice(lastIndex, match.index)
    // The chord name itself still occupies columns in the untagged line - only the [ch]/[/ch]
    // wrapper disappears - so it counts toward where the *next* chord's gap starts.
    tagged.push({ pos: stripped.length, chord: match[1] })
    stripped += match[1]
    lastIndex = CHORD_TAG_RE.lastIndex
  }
  return { stripped: stripped + line.slice(lastIndex), tagged }
}

/**
 * Parses a line UG marked with at least one `[ch]` tag as a chord line: every chord (tagged or
 * not) and every annotation with its column. `null` when anything on the line is neither a
 * chord, a repeat mark, a parenthetical comment nor layout - i.e. real text with a chord tag
 * embedded, which must not be treated as a chord line (nor spliced into as a lyric).
 */
function parseChordLine(line: string): { stripped: string; tokens: ChordLineToken[] } | null {
  if (!line.includes('[ch]')) return null
  const { stripped, tagged } = stripChordTags(line)
  const tokens: ChordLineToken[] = []

  // A parenthetical group is one token even with spaces inside ("(x3, very short)").
  const TOKEN_RE = /\([^()]*\)|\S+/g
  let match: RegExpExecArray | null
  while ((match = TOKEN_RE.exec(stripped)) !== null) {
    const text = match[0]
    const start = match.index
    const end = start + text.length
    const chordsInside = tagged.filter((t) => t.pos >= start && t.pos < end)

    if (chordsInside.length > 0) {
      // A tagged chord, possibly wrapped in layout like "(C)" or "|C|". Whatever surrounds the
      // chord names has to be layout, or this isn't a clean chord token.
      let rest = text
      for (const chord of chordsInside) rest = rest.replace(chord.chord, '')
      if (rest !== '' && !/^[|()\-/.*:~,]+$/.test(rest)) return null
      // "(C)" sits where its "(" is - that's the column UG aligned against the lyric, so a
      // single wrapped chord takes the token's start (else "(C)" over "Say" gave "S[C]ay").
      for (const chord of chordsInside) {
        tokens.push({ pos: chordsInside.length === 1 ? start : chord.pos, sourcePos: chord.pos, text: chord.chord, kind: 'chord' })
      }
      if (rest !== '') tokens.push({ pos: start, sourcePos: start, text: rest, kind: 'decoration' })
    } else if (UNTAGGED_CHORD_RE.test(text) || NO_CHORD_RE.test(text)) {
      tokens.push({ pos: start, sourcePos: start, text, kind: 'chord' })
    } else if (REPEAT_MARK_RE.test(text) || /^\(.*\)$/.test(text)) {
      tokens.push({ pos: start, sourcePos: start, text, kind: 'annotation' })
    } else if (DECORATION_RE.test(text)) {
      tokens.push({ pos: start, sourcePos: start, text, kind: 'decoration' })
    } else {
      return null
    }
  }
  return { stripped, tokens }
}

/** Merges a chord line's chords into the lyric line beneath it, at the same column offsets -
 * UG positions chords above lyrics by whitespace alignment; StageBoard's ChordPro wants them
 * inline (`[G]text`). Annotations (repeat marks, comments) go to the end of the line; layout
 * characters (bars, parentheses around a chord) are dropped. */
function spliceChordsIntoLyric(lyricLine: string, tokens: ChordLineToken[]): string {
  let result = ''
  let cursor = 0
  for (const { pos, text } of tokens.filter((t) => t.kind === 'chord')) {
    const clamped = Math.max(cursor, Math.min(pos, lyricLine.length))
    result += lyricLine.slice(cursor, clamped) + `[${text}]`
    cursor = clamped
  }
  result += lyricLine.slice(cursor)
  const annotations = tokens.filter((t) => t.kind === 'annotation').map((t) => t.text)
  return annotations.length > 0 ? `${result}  ${annotations.join(' ')}` : result
}

/** A chord line with no lyric beneath it (an intro, bar lines, a riff marker) stays a line of
 * its own: every chord becomes `[X]` in place, everything else - spacing, bars, repeat marks,
 * comments - is kept as written. */
function chordLineToInline(stripped: string, tokens: ChordLineToken[]): string {
  let result = ''
  let cursor = 0
  for (const { sourcePos, text } of tokens.filter((t) => t.kind === 'chord')) {
    result += stripped.slice(cursor, sourcePos) + `[${text}]`
    cursor = sourcePos + text.length
  }
  return result + stripped.slice(cursor)
}

/** A word of a pasted chord line that is a chord - the same strict vocabulary as UG's untagged
 * chords, so "Am I" in a lyric never counts. */
function isPlainChord(token: string): boolean {
  return UNTAGGED_CHORD_RE.test(token) || NO_CHORD_RE.test(token)
}

/** A pasted line of only chords (and bars / repeat marks / comments) - `G   D/F#   Em`. Lines
 * that are ChordPro already (`[`, `{`) never are. */
function plainChordLine(line: string): { stripped: string; tokens: ChordLineToken[] } | null {
  if (line.trim() === '' || /[[{]/.test(line)) return null
  // Tag the chords the way UG does, then read the line with the same parser as the UG import -
  // one place decides what a chord line is and where each chord stands.
  const tagged = line.replace(/\S+/g, (token) => (isPlainChord(token) ? `[ch]${token}[/ch]` : token))
  if (!tagged.includes('[ch]')) return null
  return parseChordLine(tagged)
}

/**
 * "Akkordzeilen zusammenführen" (#605): chords written on their own line above the lyric, as
 * copied from websites (`G   D` / `Hello World`), become inline ChordPro (`[G]Hello [D]World`)
 * at exactly the columns they stood at - mid-word too (Marco: UG chord positions stay exact). A
 * chord line with no lyric beneath stays a line of its own, its chords bracketed in place. Every
 * other line - ChordPro already, directives, lyrics - is left as it is.
 */
export function mergeChordLines(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const output: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const chordLine = plainChordLine(lines[i])
    if (!chordLine) {
      output.push(lines[i])
      continue
    }
    const next = lines[i + 1]
    const nextIsLyric = next !== undefined && next.trim() !== '' && !/^\s*[[{]/.test(next) && plainChordLine(next) === null
    if (nextIsLyric) {
      output.push(spliceChordsIntoLyric(next, chordLine.tokens))
      i += 1
    } else {
      output.push(chordLineToInline(chordLine.stripped, chordLine.tokens))
    }
  }
  return output.join('\n')
}

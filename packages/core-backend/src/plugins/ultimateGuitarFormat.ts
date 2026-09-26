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

/** Square brackets that are part of the *text* ("[Radar Love].(Unspoken)", "[Ike] Left a good
 * job...") - in ChordPro every `[...]` is a chord, so they'd turn into bogus chords or, once real
 * chords are spliced in, into nested garbage like `[Radar [F#m7]Love]`. They become parentheses;
 * UG's own `[ch]` tags are left alone for the caller to convert. */
function neutralizeTextBrackets(line: string): string {
  return line
    .split(/(\[ch\][^[]*\[\/ch\])/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(/\[/g, '(').replace(/\]/g, ')')))
    .join('')
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

/** One string of a guitar tab staff: a string name (`e`, `B`, `Gb`, ...), a `|`, then frets and
 * dashes (`e|---5-2---|`, `D|---0-0---| x2`). */
function isStaffLine(line: string): boolean {
  return !line.includes('[ch]') && /^\s*[A-Ga-g][#b]?\s?\|.*-{2,}/.test(line)
}

/** The beat-count line UG puts under a riff (`   3 + 4 + 1 + 2 +`). */
function isCountingLine(line: string): boolean {
  return /\d/.test(line) && /^[\s\d+&.|]+$/.test(line)
}

/**
 * A guitar tab block starting at `start`: an optional chord line naming the chords above the
 * fret columns, two or more staff lines, and an optional counting line below. Returns the
 * block's lines - verbatim, only UG's chord tags stripped so the names keep their columns - and
 * the index after it; null when `start` doesn't open one. Found on 9 of 29 real repertoire tabs
 * (2026-09-26): before, the chord line was spliced *into* the first staff line as if it were a
 * lyric, garbling the riff.
 */
function tabBlockAt(lines: readonly string[], start: number): { block: string[]; next: number } | null {
  let i = start
  const block: string[] = []
  if (!isStaffLine(lines[i] ?? '') && parseChordLine(lines[i] ?? '') !== null) {
    block.push(stripChordTags(lines[i]).stripped.trimEnd())
    i += 1
  }
  let staffLines = 0
  while (i < lines.length && isStaffLine(lines[i])) {
    block.push(lines[i].trimEnd())
    staffLines += 1
    i += 1
  }
  if (staffLines < 2) return null
  if (i < lines.length && isCountingLine(lines[i])) {
    block.push(lines[i].trimEnd())
    i += 1
  }
  return { block, next: i }
}

/** `[Verse 1]`, `[Intro]`, `[Chorus]` - a bracketed token starting the line that isn't one of
 * UG's own markup tags - plus whatever note follows it on the same line (`[Chorus] (x4)`,
 * `[Intro] (G in riff is really G5)`, `[Spoken]   [Ike singing]`; found on 5 of 29 real tabs,
 * 2026-09-26). Before, such a line wasn't a section at all, and the ChordPro parser then read
 * "[Chorus]" as a *chord*. The note has its own brackets stripped. */
function sectionLabel(line: string): { label: string; note: string } | null {
  const match = line.trim().match(/^\[([^\]]+)\](.*)$/)
  if (!match) return null
  if (/^\/?(ch|tab)$/.test(match[1]) || match[2].includes('[ch]')) return null
  const rest = match[2].trim()
  // Only note shapes seen on real tabs - a parenthetical, a repeat mark, another bracketed
  // label. Anything else ("[Ike] Left a good job...") is a lyric line that happens to start
  // with a bracket, and must stay a lyric rather than be demoted to a comment.
  if (rest !== '' && !/^(\(.*\)|\[[^\]]*\]|x\s?\d+|\d+\s?x)$/i.test(rest)) return null
  return { label: match[1], note: rest.replace(/[[\]]/g, '').trim() }
}

/**
 * Converts Ultimate Guitar's chord-sheet markup (`[ch]G[/ch]` tags on their own line above
 * the lyrics, `[Verse 1]` section headers, `[tab]...[/tab]` wrapping both) into StageBoard's
 * ChordPro (`[G]text` inline, `{part: Verse 1}` directives - see chordpro.ts). Pure and unit
 * tested against real content pulled from live tab pages; no network involved here.
 *
 * Chord lines are more than bare tags in practice (found on real tabs, 2026-09-26): bar lines
 * (`| C | F |`), chords in parentheses, repeat marks (`x4`), comments (`(Cesura)`) and chord
 * names UG left untagged - see `parseChordLine`. Guitar tab riffs become ChordPro tab blocks
 * (`{start_of_tab}` ... `{end_of_tab}`, for everyone) - see `tabBlockAt`. Whatever still carries a `[ch]` tag at the end
 * (a chord embedded in real text) is reduced to `[X]`, so raw UG markup never reaches a song.
 */
export function convertUltimateGuitarContent(raw: string): string {
  const rawLines = raw.replace(/\r\n/g, '\n').split('\n').map((line) => line.replace(/\[\/?tab\]/g, ''))

  const output: string[] = []
  let i = 0
  while (i < rawLines.length) {
    const line = rawLines[i]

    const section = sectionLabel(line)
    if (section !== null) {
      output.push(`{part: ${section.label}}`)
      if (section.note !== '') output.push(`{c: ${section.note}}`)
      i += 1
      continue
    }

    // Before chord lines: a chord line directly above a riff belongs to the tab block.
    const tab = tabBlockAt(rawLines, i)
    if (tab) {
      output.push('{start_of_tab}', ...tab.block, '{end_of_tab}')
      i = tab.next
      continue
    }

    const chordLine = parseChordLine(line)
    if (chordLine) {
      const next = rawLines[i + 1]
      // A line that still carries chord tags is never a lyric to splice into - that produced
      // `[Am][ch[E7]]F[/...` garbage when two chord lines followed each other.
      const nextIsLyric =
        next !== undefined && next.trim() !== '' && !next.includes('[ch]') && sectionLabel(next) === null
      if (nextIsLyric) {
        output.push(spliceChordsIntoLyric(neutralizeTextBrackets(next), chordLine.tokens))
        i += 2
      } else {
        output.push(chordLineToInline(chordLine.stripped, chordLine.tokens))
        i += 1
      }
      continue
    }

    output.push(neutralizeTextBrackets(line).replace(CHORD_TAG_RE, '[$1]'))
    i += 1
  }

  return output.join('\n')
}

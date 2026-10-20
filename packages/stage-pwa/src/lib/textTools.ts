import { isTabEndDirective, parseTabStartDirective } from './chordpro'
import { prefersFlats, transposeChord } from './transposeChord'

/** A time tag (`[01:14.50]`) - in brackets like a chord, but never one. */
const TIME_TAG_INNER_RE = /^\d{2}:\d{2}(?:\.\d+)?$/
const CHORD_IN_TEXT_RE = /\[([^\]\n]+)\]/g

/** Applies `edit` to every chord of the text's lyric lines - not inside directives (`{...}`),
 * never to a time tag, never inside a tab block (fret numbers are not chords). */
function mapChords(content: string, edit: (chord: string) => string): string {
  let inTab = false
  return content
    .split('\n')
    .map((line) => {
      if (parseTabStartDirective(line)) {
        inTab = true
        return line
      }
      if (inTab) {
        if (isTabEndDirective(line)) inTab = false
        return line
      }
      if (line.trim().startsWith('{')) return line
      return line.replace(CHORD_IN_TEXT_RE, (whole, chord: string) => (TIME_TAG_INNER_RE.test(chord) ? whole : `[${edit(chord)}]`))
    })
    .join('\n')
}

/**
 * "Transponieren" (#605): shifts the chords of the *text itself* - for a chart written down in the
 * wrong key - unlike the variant's transpose, which only changes what the stage shows. Spelled
 * for the new key, like the variant transpose.
 */
export function transposeText(content: string, semitones: number, key: string | undefined): string {
  const useFlats = prefersFlats(key, semitones)
  return mapChords(content, (chord) => transposeChord(chord, semitones, useFlats))
}

/** A chord written with a lowercase root - `am`, `c#m7`, `bb/f` - and only chord vocabulary after it. */
const LOWER_ROOT_RE = /^([a-g])([#b]?)((?:maj|min|dim|aug|sus|add|m|M|\+|°|ø|\d+)*)(?:\/([a-g])([#b]?))?$/

/**
 * "Aufräumen" (#605): no runs of empty lines (one stays), no trailing spaces, chord roots in
 * capitals (`[am]` → `[Am]`, `[c#m]` → `[C#m]`). The lyrics themselves are not touched.
 */
export function cleanupText(content: string): string {
  const capitalised = mapChords(content, (chord) => {
    const match = LOWER_ROOT_RE.exec(chord)
    if (!match) return chord
    const [, root, accidental, suffix, bass, bassAccidental] = match
    return `${root.toUpperCase()}${accidental}${suffix}${bass ? `/${bass.toUpperCase()}${bassAccidental}` : ''}`
  })
  return capitalised
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
}

export interface BracketProblem {
  /** 1-based, as a person counts lines. */
  line: number
  bracket: '[' | '{'
}

/** Lines where a `[` or `{` is opened and not closed (#605) - a hint, never fixed by itself. */
export function bracketProblems(content: string): BracketProblem[] {
  const problems: BracketProblem[] = []
  content.split('\n').forEach((text, index) => {
    for (const [open, close] of [['[', ']'], ['{', '}']] as const) {
      let depth = 0
      for (const char of text) {
        if (char === open) depth += 1
        else if (char === close && depth > 0) depth -= 1
      }
      if (depth > 0) problems.push({ line: index + 1, bracket: open })
    }
  })
  return problems
}

/** "Suchen & Ersetzen" (#605): every occurrence, literally (no patterns) - with how many it were. */
export function replaceAllText(content: string, find: string, replacement: string): { content: string; count: number } {
  if (!find) return { content, count: 0 }
  const parts = content.split(find)
  return { content: parts.join(replacement), count: parts.length - 1 }
}

import { CUE_BEAT, CUE_NAME, CuePatternSchema, type CuePattern } from 'shared-types'
import { parsePartDirective, parseTimeTag, tappableLines } from './chordpro'

/**
 * A part's own announcement (#63, step 2): the band's cue pattern replaced for this one part, as a
 * line right after its part directive - `{x_announce: <name>, -, -, - | #, #, #, #}` - so it travels
 * with the part through every edit, undo and copy. Cells are separated by `,`, bars by `|`; `-` is
 * nothing, `<name>` the part's name, `#` the beat's number, anything else is said as written.
 * `{x_announce: -}` keeps the part silent. ChordPro's `x_` prefix: other programs ignore the line.
 */

const CUE_DIRECTIVE_RE = /^\{\s*x_announce\s*:([^}]*)\}$/i

/** A word as it may stand in the directive - its separators and braces become spaces. */
function cleanWord(word: string): string {
  return word
    .replace(/[,|{}<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cellToken(cell: string): string {
  const value = cell.trim()
  if (value === CUE_NAME) return '<name>'
  if (value === CUE_BEAT) return '#'
  return cleanWord(value) || '-'
}

function tokenCell(token: string): string {
  const value = token.trim()
  if (value === '' || value === '-') return ''
  if (value.toLowerCase() === '<name>') return CUE_NAME
  return value
}

export function formatCueDirective(pattern: CuePattern): string {
  return `{x_announce: ${pattern.map((bar) => (bar.length ? bar : ['']).map(cellToken).join(', ')).join(' | ')}}`
}

/** The pattern of an `{x_announce: …}` line; null for any other line or one that doesn't parse. */
export function parseCueDirective(line: string): CuePattern | null {
  const match = line.trim().match(CUE_DIRECTIVE_RE)
  if (!match) return null
  const pattern = match[1]!.split('|').map((bar) => bar.split(',').map(tokenCell))
  const parsed = CuePatternSchema.safeParse(pattern)
  return parsed.success ? parsed.data : null
}

/** Whether a pattern says nothing at all - "stumm". */
export function isSilentCue(pattern: CuePattern): boolean {
  return pattern.every((bar) => bar.every((cell) => cell.trim() === ''))
}

export interface PartHead {
  /** Same numbering as `timelineLines` / `partBlocks`. */
  partIndex: number
  /** Line of the part directive in `content.split('\n')`. */
  rawIndex: number
  /** The part's own announcement, null: the band's pattern. */
  cue: CuePattern | null
  /** Line of its `{x_announce}`, null if it has none. */
  cueRawIndex: number | null
}

/**
 * Every part directive with its announcement line - an `{x_announce}` counts for the part when it
 * comes after the directive and before the part's first lyric line. Counted exactly like
 * `timelineLines`: two directives in a row are one part (the later one names it).
 */
export function partHeads(content: string): PartHead[] {
  const raw = content.split('\n')
  const tappable = tappableLines(raw)
  const heads = new Map<number, PartHead>()
  let partIndex = 0
  let partStarted = false
  raw.forEach((line, rawIndex) => {
    if (parsePartDirective(line)) {
      if (partStarted) partIndex += 1
      partStarted = false
      const earlier = heads.get(partIndex)
      heads.set(partIndex, { partIndex, rawIndex, cue: earlier?.cue ?? null, cueRawIndex: earlier?.cueRawIndex ?? null })
      return
    }
    const cue = parseCueDirective(line)
    if (cue) {
      const head = heads.get(partIndex)
      if (head && !partStarted && head.cueRawIndex === null) heads.set(partIndex, { ...head, cue, cueRawIndex: rawIndex })
      return
    }
    if (!tappable[rawIndex]) return
    if (/^\{[^}]*\}$/.test(parseTimeTag(line).rest.trim())) return
    partStarted = true
  })
  return [...heads.values()]
}

/** Gives part `partIndex` its own announcement, or (`null`) back the band's pattern. */
export function setPartCue(content: string, partIndex: number, pattern: CuePattern | null): string {
  const head = partHeads(content).find((h) => h.partIndex === partIndex)
  if (!head) return content
  const raw = content.split('\n')
  if (head.cueRawIndex !== null) {
    if (pattern) raw[head.cueRawIndex] = formatCueDirective(pattern)
    else raw.splice(head.cueRawIndex, 1)
  } else if (pattern) {
    raw.splice(head.rawIndex + 1, 0, formatCueDirective(pattern))
  }
  return raw.join('\n')
}

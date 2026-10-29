import { isTabEndDirective, parsePartDirective, parseTabStartDirective } from './chordpro'

/**
 * "Aufräumen" as single rules to tick (Marco, 2026-10-29): every rule says how many places it
 * would change, and only the ticked ones run - in this order, so e.g. spaces are gone before empty
 * lines are counted. Lyrics are never reworded; chord lines written above a lyric keep their
 * columns. Tab blocks ({start_of_tab} … {end_of_tab}) are left alone by every rule.
 */
export type CleanupRuleId =
  | 'tabsToSpaces'
  | 'chordBracketSpaces'
  | 'chordRootCaps'
  | 'chordSpelling'
  | 'quotes'
  | 'trailingSpaces'
  | 'innerSpaces'
  | 'noGapAfterHeader'
  | 'gapBeforeHeader'
  | 'collapseEmpty'
  | 'trimEdges'

export interface CleanupRule {
  id: CleanupRuleId
  label: string
  /** One sentence for the ⓘ: what it changes, with an example. */
  hint: string
  defaultOn: boolean
  /** The text after this rule, and how many places it changed. */
  run: (text: string) => { text: string; count: number }
}

/** Calls `edit` for every line outside a tab block; `edit` returns the new line (or the same). */
function mapLines(text: string, edit: (line: string) => string): { text: string; count: number } {
  let inTab = false
  let count = 0
  const lines = text.split('\n').map((line) => {
    if (parseTabStartDirective(line)) {
      inTab = true
      return line
    }
    if (inTab) {
      if (isTabEndDirective(line)) inTab = false
      return line
    }
    const next = edit(line)
    if (next !== line) count += 1
    return next
  })
  return { text: lines.join('\n'), count }
}

const isDirective = (line: string) => line.trim().startsWith('{')
const TIME_TAG_INNER_RE = /^\d{2}:\d{2}(?:\.\d+)?$/
const CHORD_RE = /\[([^\]\n]+)\]/g

/** Every chord in brackets of a lyric line - never a time tag, never in a directive. */
function mapChords(text: string, edit: (chord: string) => string): { text: string; count: number } {
  let count = 0
  const result = mapLines(text, (line) =>
    isDirective(line)
      ? line
      : line.replace(CHORD_RE, (whole, chord: string) => {
          if (TIME_TAG_INNER_RE.test(chord.trim())) return whole
          const next = edit(chord)
          if (next !== chord) count += 1
          return `[${next}]`
        }),
  )
  return { text: result.text, count }
}

/** A line of only chords (and bars) written above a lyric - its spaces are the chords' columns. */
const PLAIN_CHORD_TOKEN_RE = /^(?:[A-H][#b]?(?:maj|min|m|dim|aug|sus|add|M|\+|°|ø|\d+)*(?:\/[A-H][#b]?)?|\||x\d+|N\.?C\.?)$/
const isPlainChordLine = (line: string) => !line.includes('[') && line.trim() !== '' && line.trim().split(/\s+/).every((token) => PLAIN_CHORD_TOKEN_RE.test(token))

const LOWER_ROOT_RE = /^([a-g])([#b]?)((?:maj|min|dim|aug|sus|add|m|M|\+|°|ø|\d+)*)(?:\/([a-g])([#b]?))?$/
/** German H (= B) as a root or bass, and spelled-out `min` / `M7`: one way of writing. */
function unifyChordSpelling(chord: string): string {
  return chord
    .replace(/^H(?=[#b]?(?:[^a-z]|$|m|maj|min|dim|aug|sus|add))/, 'B')
    .replace(/\/H(?=[#b]?$)/, '/B')
    .replace(/^([A-G][#b]?)min(?![a-z])/, '$1m')
    .replace(/^([A-G][#b]?)M7$/, '$1maj7')
}

const isHeader = (line: string) => parsePartDirective(line) !== null

/** Removes empty lines right after a section header. */
function noGapAfterHeader(text: string): { text: string; count: number } {
  const lines = text.split('\n')
  const out: string[] = []
  let count = 0
  let afterHeader = false
  for (const line of lines) {
    if (afterHeader && line.trim() === '') {
      count += 1
      continue
    }
    afterHeader = isHeader(line)
    out.push(line)
  }
  return { text: out.join('\n'), count }
}

/** An empty line before every section header - not before the first line of the text. */
function gapBeforeHeader(text: string): { text: string; count: number } {
  const lines = text.split('\n')
  const out: string[] = []
  let count = 0
  for (const line of lines) {
    const previous = out[out.length - 1]
    if (isHeader(line) && previous !== undefined && previous.trim() !== '' && out.some((l) => l.trim() !== '')) {
      out.push('')
      count += 1
    }
    out.push(line)
  }
  return { text: out.join('\n'), count }
}

export const CLEANUP_RULES: readonly CleanupRule[] = [
  {
    id: 'tabsToSpaces',
    label: 'Tabulatoren → Leerzeichen',
    hint: 'Ein Tabulator-Zeichen wird ein Leerzeichen - es sieht sonst auf jedem Gerät anders breit aus.',
    defaultOn: true,
    run: (text) => {
      let count = 0
      const result = mapLines(text, (line) => line.replace(/\t/g, () => (count++, ' ')))
      return { text: result.text, count }
    },
  },
  {
    id: 'chordBracketSpaces',
    label: 'Leerzeichen in Akkord-Klammern entfernen',
    hint: '„[ Am ]“ wird „[Am]“.',
    defaultOn: true,
    run: (text) => mapChords(text, (chord) => chord.trim()),
  },
  {
    id: 'chordRootCaps',
    label: 'Akkord-Grundton groß',
    hint: '„[am]“ wird „[Am]“, „[c#m]“ wird „[C#m]“. Der Liedtext bleibt, wie er ist.',
    defaultOn: true,
    run: (text) =>
      mapChords(text, (chord) => {
        const match = LOWER_ROOT_RE.exec(chord)
        if (!match) return chord
        const [, root, accidental, suffix, bass, bassAccidental] = match
        return `${root!.toUpperCase()}${accidental}${suffix}${bass ? `/${bass.toUpperCase()}${bassAccidental}` : ''}`
      }),
  },
  {
    id: 'chordSpelling',
    label: 'Akkord-Schreibweise vereinheitlichen',
    hint: 'Deutsches H wird B („[H7]“ → „[B7]“), „[Amin]“ wird „[Am]“, „[CM7]“ wird „[Cmaj7]“.',
    defaultOn: false,
    run: (text) => mapChords(text, unifyChordSpelling),
  },
  {
    id: 'quotes',
    label: 'Anführungszeichen und Apostrophe vereinheitlichen',
    hint: 'Typografische Zeichen (’ ‘ “ ” „) werden einfache (\' und ") - so findet die Suche sie auch.',
    defaultOn: false,
    run: (text) => mapLines(text, (line) => line.replace(/[’‘‛]/g, "'").replace(/[“”„]/g, '"')),
  },
  {
    id: 'trailingSpaces',
    label: 'Leerzeichen am Zeilenende entfernen',
    hint: 'Unsichtbare Leerzeichen hinter dem letzten Wort einer Zeile.',
    defaultOn: true,
    run: (text) => mapLines(text, (line) => line.replace(/[ \t]+$/, '')),
  },
  {
    id: 'innerSpaces',
    label: 'Mehrere Leerzeichen in einer Zeile → eines',
    hint: 'Nur in Zeilen mit Text und Akkorden in Klammern. Akkord-Zeilen über dem Text behalten ihre Abstände - die bestimmen, wo ein Akkord steht.',
    defaultOn: false,
    run: (text) => mapLines(text, (line) => (isDirective(line) || isPlainChordLine(line) ? line : line.replace(/(\S) {2,}(?=\S)/g, '$1 '))),
  },
  {
    id: 'noGapAfterHeader',
    label: 'Keine Leerzeile nach einer Abschnitts-Überschrift',
    hint: 'Zwischen „{part: Chorus}“ und der ersten Zeile darunter steht nichts.',
    defaultOn: true,
    run: noGapAfterHeader,
  },
  {
    id: 'gapBeforeHeader',
    label: 'Eine Leerzeile vor jeder Abschnitts-Überschrift',
    hint: 'Jeder Abschnitt („{part: …}“) wird durch eine Leerzeile vom vorigen getrennt.',
    defaultOn: true,
    run: gapBeforeHeader,
  },
  {
    id: 'collapseEmpty',
    label: 'Mehrere Leerzeilen → eine',
    hint: 'Zwei oder mehr Leerzeilen hintereinander werden eine.',
    defaultOn: true,
    run: (text) => {
      let count = 0
      const next = text.replace(/\n(?:[ \t]*\n){2,}/g, (run) => ((count += run.split('\n').length - 3), '\n\n'))
      return { text: next, count }
    },
  },
  {
    id: 'trimEdges',
    label: 'Leerzeilen am Anfang und Ende entfernen',
    hint: 'Der Text beginnt mit seiner ersten Zeile und endet mit seiner letzten.',
    defaultOn: true,
    run: (text) => {
      const lines = text.split('\n')
      let start = 0
      let end = lines.length
      while (start < end && lines[start]!.trim() === '') start += 1
      while (end > start && lines[end - 1]!.trim() === '') end -= 1
      return { text: lines.slice(start, end).join('\n'), count: start + (lines.length - end) }
    },
  },
]

export const DEFAULT_CLEANUP_RULES: CleanupRuleId[] = CLEANUP_RULES.filter((rule) => rule.defaultOn).map((rule) => rule.id)

/** How many places each rule would change, each on its own after the ones before it ran. */
export function cleanupCounts(text: string, enabled: readonly CleanupRuleId[]): Record<CleanupRuleId, number> {
  const counts = {} as Record<CleanupRuleId, number>
  let current = text
  for (const rule of CLEANUP_RULES) {
    const result = rule.run(current)
    counts[rule.id] = result.count
    if (enabled.includes(rule.id)) current = result.text
  }
  return counts
}

/** The text with the ticked rules applied, in the rules' order. */
export function applyCleanupRules(text: string, enabled: readonly CleanupRuleId[]): string {
  return CLEANUP_RULES.reduce((current, rule) => (enabled.includes(rule.id) ? rule.run(current).text : current), text)
}

const STORAGE_KEY = 'sb:text-cleanup-rules'

/** The rules ticked last time on this device - the defaults the first time. */
export function loadCleanupSelection(): CleanupRuleId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CLEANUP_RULES
    const ids = JSON.parse(raw) as unknown
    return Array.isArray(ids) ? CLEANUP_RULES.map((rule) => rule.id).filter((id) => ids.includes(id)) : DEFAULT_CLEANUP_RULES
  } catch {
    return DEFAULT_CLEANUP_RULES
  }
}

export function saveCleanupSelection(ids: readonly CleanupRuleId[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // Private mode / blocked storage: the selection just isn't remembered.
  }
}

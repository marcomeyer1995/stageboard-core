/**
 * "Suchen & Ersetzen" (#605, regular expressions Marco 2026-10-29): literally by default, or as a
 * regular expression with groups ($1, $2, $<name>, $&) in the replacement - always over the lines
 * (^ and $ mean the start and end of a line), case-sensitive or not.
 */
export interface ReplaceOptions {
  find: string
  replacement: string
  regex: boolean
  caseSensitive: boolean
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The pattern as a JS RegExp, or why it isn't one. */
export function buildMatcher(options: Pick<ReplaceOptions, 'find' | 'regex' | 'caseSensitive'>): { re: RegExp } | { error: string } | null {
  if (!options.find) return null
  try {
    return { re: new RegExp(options.regex ? options.find : escapeRegExp(options.find), `gm${options.caseSensitive ? '' : 'i'}`) }
  } catch (err) {
    return { error: err instanceof Error ? err.message.replace(/^Invalid regular expression: /, '') : String(err) }
  }
}

/** Every match replaced - with how many there were. An empty match (e.g. `^` alone) still counts once per place. */
export function replaceText(content: string, options: ReplaceOptions): { content: string; count: number } | { error: string } {
  const matcher = buildMatcher(options)
  if (!matcher) return { content, count: 0 }
  if ('error' in matcher) return matcher
  let count = 0
  const next = content.replace(matcher.re, (...args: unknown[]) => {
    count += 1
    // Literal mode: the replacement is the text itself, no $ meanings.
    if (!options.regex) return options.replacement
    const match = args[0] as string
    const last = args[args.length - 1]
    const named = typeof last === 'object' && last !== null ? (last as Record<string, string | undefined>) : undefined
    const groups = args.slice(1, named ? -3 : -2) as (string | undefined)[]
    return options.replacement.replace(/\$(\$|&|\d{1,2}|<([^>]+)>)/g, (token, what: string, name: string | undefined) => {
      if (what === '$') return '$'
      if (what === '&') return match
      if (name !== undefined) return named?.[name] ?? ''
      const index = Number(what)
      return index >= 1 && index <= groups.length ? (groups[index - 1] ?? '') : token
    })
  })
  return { content: next, count }
}

export interface PreviewLine {
  /** 1-based line in the text before. */
  line: number
  before: string
  after: string
}

/** The lines a replacement changes, before and after - for the preview (up to `max`). A
 * replacement that adds or removes line breaks shows the changed stretch as one entry. */
export function previewChanges(before: string, after: string, max = 20): { lines: PreviewLine[]; more: number } {
  const a = before.split('\n')
  const b = after.split('\n')
  if (a.length === b.length) {
    const changed = a.flatMap((line, i) => (line !== b[i] ? [{ line: i + 1, before: line, after: b[i]! }] : []))
    return { lines: changed.slice(0, max), more: Math.max(0, changed.length - max) }
  }
  // Line count changed: the stretch between the common start and the common end.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }
  return { lines: [{ line: start + 1, before: a.slice(start, endA).join('⏎'), after: b.slice(start, endB).join('⏎') }], more: 0 }
}

/** A building block for the pattern, with what it means - the regex builder's buttons. */
export interface RegexBlock {
  label: string
  insert: string
  meaning: string
  /** Put around the selection in the field (or the cursor goes inside). */
  wrap?: [string, string]
}

export const REGEX_BLOCKS: { group: string; blocks: RegexBlock[] }[] = [
  {
    group: 'Zeichen',
    blocks: [
      { label: 'Beliebiges Zeichen', insert: '.', meaning: 'ein beliebiges Zeichen' },
      { label: 'Ziffer', insert: '\\d', meaning: 'eine Ziffer 0-9' },
      { label: 'Buchstabe/Ziffer', insert: '\\w', meaning: 'ein Buchstabe, eine Ziffer oder _' },
      { label: 'Leerzeichen', insert: '\\s', meaning: 'ein Leerzeichen oder Tabulator' },
      { label: 'Akkord [..]', insert: '\\[[^\\]]+\\]', meaning: 'etwas in eckigen Klammern, z. B. ein Akkord' },
      { label: 'Zeitmarke', insert: '\\[\\d{2}:\\d{2}(?:\\.\\d+)?\\]', meaning: 'eine Zeitmarke wie [01:14.50]' },
    ],
  },
  {
    group: 'Wie oft',
    blocks: [
      { label: 'Einmal oder öfter', insert: '+', meaning: 'das davor einmal oder öfter' },
      { label: 'Beliebig oft', insert: '*', meaning: 'das davor beliebig oft, auch keinmal' },
      { label: 'Optional', insert: '?', meaning: 'das davor kann fehlen' },
    ],
  },
  {
    group: 'Position',
    blocks: [
      { label: 'Zeilenanfang', insert: '^', meaning: 'der Anfang einer Zeile' },
      { label: 'Zeilenende', insert: '$', meaning: 'das Ende einer Zeile' },
      { label: 'Wortgrenze', insert: '\\b', meaning: 'Anfang oder Ende eines Worts' },
    ],
  },
  {
    group: 'Gruppen',
    blocks: [
      { label: 'Gruppe ( )', insert: '()', wrap: ['(', ')'], meaning: 'eine Gruppe - im Ersetzen als $1, $2 … wieder einsetzbar' },
      { label: 'Eins von [ ]', insert: '[]', wrap: ['[', ']'], meaning: 'eines der Zeichen in den Klammern' },
      { label: 'Oder |', insert: '|', meaning: 'das links oder das rechts davon' },
    ],
  },
]

/** Building blocks for the replacement field. */
export const REPLACEMENT_BLOCKS: RegexBlock[] = [
  { label: 'Gruppe 1', insert: '$1', meaning: 'was die erste ( ) gefunden hat' },
  { label: 'Gruppe 2', insert: '$2', meaning: 'was die zweite ( ) gefunden hat' },
  { label: 'Ganzer Treffer', insert: '$&', meaning: 'alles, was gefunden wurde' },
]

const QUANTIFIER_MEANING: Record<string, string> = { '+': 'einmal oder öfter', '*': 'beliebig oft', '?': 'optional' }
const ESCAPE_MEANING: Record<string, string> = {
  d: 'eine Ziffer',
  D: 'keine Ziffer',
  w: 'ein Buchstabe, eine Ziffer oder _',
  W: 'kein Buchstabe und keine Ziffer',
  s: 'ein Leerzeichen',
  S: 'kein Leerzeichen',
  b: 'eine Wortgrenze',
  n: 'ein Zeilenumbruch',
  t: 'ein Tabulator',
}

/**
 * The pattern in words, piece by piece - shown under the field so a pattern explains itself
 * (e.g. `^\[(\w+)\]` → Zeilenanfang · „[“ · Gruppe 1 ( Buchstabe/Ziffer einmal oder öfter ) · „]“).
 * Not a full regex parser: anything it doesn't know is shown as itself.
 */
export function explainPattern(pattern: string): string[] {
  const out: string[] = []
  let literal = ''
  let group = 0
  const flush = () => {
    if (literal) out.push(`der Text „${literal}“`)
    literal = ''
  }
  const quantify = (q: string) => {
    flush()
    const last = out.pop()
    if (last !== undefined) out.push(`${last}, ${QUANTIFIER_MEANING[q] ?? q}`)
  }
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!
    if (c === '\\' && i + 1 < pattern.length) {
      const next = pattern[++i]!
      if (ESCAPE_MEANING[next]) {
        flush()
        out.push(ESCAPE_MEANING[next])
      } else literal += next
    } else if (c === '+' || c === '*' || c === '?') {
      if (literal.length > 1) {
        const keep = literal.slice(0, -1)
        const lastChar = literal.slice(-1)
        literal = keep
        flush()
        out.push(`das Zeichen „${lastChar}“`)
        quantify(c)
      } else quantify(c)
    } else if (c === '{') {
      const m = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(i))
      if (m) {
        flush()
        const last = out.pop() ?? ''
        out.push(`${last}, ${m[2] === undefined ? `genau ${m[1]}-mal` : m[2] === '' ? `mindestens ${m[1]}-mal` : `${m[1]}- bis ${m[2]}-mal`}`)
        i += m[0].length - 1
      } else literal += c
    } else if (c === '.') {
      flush()
      out.push('ein beliebiges Zeichen')
    } else if (c === '^') {
      flush()
      out.push('Zeilenanfang')
    } else if (c === '$') {
      flush()
      out.push('Zeilenende')
    } else if (c === '|') {
      flush()
      out.push('- oder -')
    } else if (c === '(') {
      flush()
      if (pattern.startsWith('(?:', i)) {
        out.push('Anfang einer Klammer (ohne Nummer)')
        i += 2
      } else {
        group += 1
        out.push(`Anfang Gruppe ${group} ($${group})`)
      }
    } else if (c === ')') {
      flush()
      out.push('Ende der Gruppe')
    } else if (c === '[') {
      const end = pattern.indexOf(']', i + 2)
      if (end === -1) {
        literal += c
        continue
      }
      flush()
      const set = pattern.slice(i + 1, end)
      out.push(set.startsWith('^') ? `ein Zeichen außer „${set.slice(1).replace(/\\/g, '')}“` : `eines von „${set.replace(/\\/g, '')}“`)
      i = end
    } else literal += c
  }
  flush()
  return out
}

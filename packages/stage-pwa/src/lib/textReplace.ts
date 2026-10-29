/**
 * "Suchen & Ersetzen" (#605; like Notepad++, Marco 2026-10-29): three modes - normal (the text
 * literally), extended (normal plus \n, \t, \\ as line break, tab, backslash) and regular
 * expression (groups $1, $2, $<name>, $& in the replacement) - always over the lines (^ and $ mean
 * the start and end of a line), case-sensitive or not, whole words only or not.
 */
export type SearchMode = 'normal' | 'extended' | 'regex'

export interface ReplaceOptions {
  find: string
  replacement: string
  mode: SearchMode
  caseSensitive: boolean
  wholeWord?: boolean
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Extended mode's escapes: \n, \t, \\. */
export const unescapeExtended = (text: string) => text.replace(/\\([nt\\])/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : '\\'))

/** The pattern as a JS RegExp, or why it isn't one. */
export function buildMatcher(options: Pick<ReplaceOptions, 'find' | 'mode' | 'caseSensitive' | 'wholeWord'>): { re: RegExp } | { error: string } | null {
  if (!options.find) return null
  const source = options.mode === 'regex' ? options.find : escapeRegExp(options.mode === 'extended' ? unescapeExtended(options.find) : options.find)
  try {
    // Whole words: no letter (umlauts too), digit or _ right before or after - without the u flag,
    // which would refuse escapes people commonly write (`\-`, `\:`).
    return { re: new RegExp(options.wholeWord ? `(?<![\\w\\u00C0-\\u024F])(?:${source})(?![\\w\\u00C0-\\u024F])` : source, `gm${options.caseSensitive ? '' : 'i'}`) }
  } catch (err) {
    return { error: err instanceof Error ? err.message.replace(/^Invalid regular expression: /, '') : String(err) }
  }
}

/** The replacement for one match: literal in normal mode, \n/\t in extended, groups in regex. */
function expand(options: ReplaceOptions, match: RegExpExecArray): string {
  if (options.mode === 'normal') return options.replacement
  if (options.mode === 'extended') return unescapeExtended(options.replacement)
  return options.replacement.replace(/\$(\$|&|\d{1,2}|<([^>]+)>)/g, (token, what: string, name: string | undefined) => {
    if (what === '$') return '$'
    if (what === '&') return match[0]
    if (name !== undefined) return match.groups?.[name] ?? ''
    const index = Number(what)
    return index >= 1 && index < match.length ? (match[index] ?? '') : token
  })
}

/** One match: where in the text (offsets into the whole text), its line, and what it becomes. */
export interface TextMatch {
  start: number
  end: number
  /** 1-based line of its start. */
  line: number
  replacement: string
}

/** Every match in `content` - only within [from, to) when given (the marked lines). */
export function findMatches(content: string, options: ReplaceOptions, from = 0, to = content.length): TextMatch[] | { error: string } {
  const matcher = buildMatcher(options)
  if (!matcher) return []
  if ('error' in matcher) return matcher
  const scope = content.slice(from, to)
  const re = matcher.re
  const out: TextMatch[] = []
  let line = content.slice(0, from).split('\n').length
  let counted = 0
  for (let m = re.exec(scope); m !== null; m = re.exec(scope)) {
    if (m[0] === '') re.lastIndex += 1 // an empty match (e.g. ^) - move on, or it loops
    for (let i = counted; i < m.index; i++) if (scope[i] === '\n') line += 1
    counted = m.index
    out.push({ start: from + m.index, end: from + m.index + m[0].length, line, replacement: expand(options, m) })
    if (out.length >= 10000) break
  }
  return out
}

/** Every match replaced - with how many there were. */
export function replaceText(content: string, options: ReplaceOptions, from = 0, to = content.length): { content: string; count: number } | { error: string } {
  const matches = findMatches(content, options, from, to)
  if ('error' in matches) return matches
  let next = content
  for (const match of [...matches].reverse()) next = next.slice(0, match.start) + match.replacement + next.slice(match.end)
  return { content: next, count: matches.length }
}

/** One match replaced (Notepad++'s "Ersetzen"). */
export function replaceOne(content: string, match: TextMatch): string {
  return content.slice(0, match.start) + match.replacement + content.slice(match.end)
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

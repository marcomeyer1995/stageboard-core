export interface ChordSegment {
  chord: string | null
  text: string
}

export interface ChordProLine {
  timeMs: number | null
  segments: ChordSegment[]
  /** Index of the song part (docs/04) this line belongs to; 0 for lines before the first part directive. */
  partIndex: number
  /** Label of that part, or null when the line sits outside any labelled part. */
  partLabel: string | null
  /** Text of a `{comment:}`/`{c:}`/`{cc:}`/`{cc4...}` directive line (issue #215) - a
   * musician-facing note ("play softer here"), never folded into `segments` since it isn't
   * part of the lyric. Null for an ordinary lyric line. A comment line has empty `segments`
   * and carries no chords. */
  comment: string | null
  /** Lowercased profile-name tokens a `{cc4marco,jamie: ...}` directive targets (issue #215
   * follow-up) - null means "everyone," the case for a plain `{comment:}`/`{c:}`/`{cc:}`/
   * `{cc4all:}` line, and for every ordinary lyric line. See `commentVisibleTo`. */
  commentTargets: string[] | null
}

/** A block of consecutive lines the Paginated View shows as one "page" (docs/07). */
export interface SongPage {
  label: string | null
  /** Index of the first line of the page. */
  startIndex: number
  /** Index *after* the last line of the page. */
  endIndex: number
}

const TIME_TAG_RE = /^\[(\d{2}):(\d{2}(?:\.\d+)?)\]\s*/
const CHORD_RE = /\[([^\]]+)\]/g
const DIRECTIVE_RE = /^\{([^:}]+)(?::([^}]*))?\}$/

/** ChordPro's standard section directives, mapped to the label they imply when none is given. */
const SECTION_ALIASES: Record<string, string> = {
  sov: 'Verse',
  start_of_verse: 'Verse',
  soc: 'Chorus',
  start_of_chorus: 'Chorus',
  sob: 'Bridge',
  start_of_bridge: 'Bridge',
}
const SECTION_END = /^(eov|eoc|eob|end_of_(verse|chorus|bridge|part))$/
const PLAIN_COMMENT_NAME_RE = /^(comment|c)$/i
/** StageBoard's own targeted-comment directive (issue #215 follow-up): `{cc}`/`{cc4all}` for
 * everyone, `{cc4marco}` or `{cc4marco,jamie}` (comma-separated, no spaces required around the
 * commas) for specific band members, matched by `Profile.name` - readable text, not an opaque
 * id, since Marco reads/writes these directives by hand same as any other. */
const CUSTOM_COMMENT_NAME_RE = /^cc(?:4(.+))?$/i

/**
 * Recognises the directive lines that open or close a song part - StageBoard's own
 * `{part: Chorus}` plus ChordPro's standard `{soc}` / `{start_of_chorus: ...}` family.
 * Any other `{...}` line is left alone and rendered as ordinary text.
 */
export function parsePartDirective(line: string): { label: string | null } | null {
  const match = line.trim().match(DIRECTIVE_RE)
  if (!match) return null

  const name = match[1].trim().toLowerCase().replace(/\s+/g, '_')
  const value = match[2]?.trim() ?? ''

  if (name === 'part' || name === 'p') return { label: value.length > 0 ? value : null }
  if (name in SECTION_ALIASES) return { label: value.length > 0 ? value : SECTION_ALIASES[name] }
  if (SECTION_END.test(name)) return { label: null }
  return null
}

export interface ParsedComment {
  text: string
  /** Lowercased target-name tokens, or null for "everyone" - see `ChordProLine.commentTargets`. */
  targets: string[] | null
}

/**
 * Recognises a musician-comment directive line - a note for the band, not part of the lyric,
 * so it must not be folded into `parseChordSegments`'s text. Two families:
 * - Standard ChordPro `{comment: ...}` / `{c: ...}` (docs/04, issue #215) - always "everyone,"
 *   since a plain imported ChordPro file has no concept of StageBoard's roster at all.
 * - StageBoard's own `{cc: ...}` / `{cc4all: ...}` (everyone) / `{cc4marco: ...}` /
 *   `{cc4marco,jamie: ...}` (issue #215 follow-up) - targets specific band members by name.
 * Returns null (not just an empty string/target list) for anything that isn't one of these,
 * so callers can tell "no comment" apart from "an empty `{comment:}`".
 */
export function parseCommentDirective(line: string): ParsedComment | null {
  const match = line.trim().match(DIRECTIVE_RE)
  if (!match) return null

  const name = match[1].trim()
  const text = match[2]?.trim() ?? ''

  if (PLAIN_COMMENT_NAME_RE.test(name)) return { text, targets: null }

  const customMatch = name.match(CUSTOM_COMMENT_NAME_RE)
  if (!customMatch) return null

  const rawTargets = customMatch[1]?.trim() ?? ''
  if (rawTargets.length === 0 || rawTargets.toLowerCase() === 'all') return { text, targets: null }

  const targets = rawTargets
    .split(',')
    .map((target) => target.trim().toLowerCase())
    .filter((target) => target.length > 0)
  return { text, targets: targets.length > 0 ? targets : null }
}

/** Writes a `{cc...}` directive line from a comment's text and targets - the inverse of
 * `parseCommentDirective`, used by the Kommentare tab so nobody has to hand-write the
 * comma-separated syntax. Preserves the targets' original display case (`Profile.name`,
 * not the lowercased tokens `parseCommentDirective` produces for matching). */
export function formatCommentDirective(text: string, targets: string[] | null): string {
  const name = targets === null || targets.length === 0 ? 'cc' : `cc4${targets.join(',')}`
  return `{${name}: ${text}}`
}

export interface CommentDirectiveOccurrence extends ParsedComment {
  /** 0-based index into `content.split('\n')` - lets the Kommentare tab patch this exact line
   * back into `chordProContent` without needing a stable id on the comment itself (there isn't
   * one - the directive's own readable text is the only thing persisted). Recomputed fresh from
   * the current text on every call, so it's only valid until the text next changes. */
  lineNumber: number
}

/** Every comment directive currently in `content`, in the order they appear - what the
 * Kommentare tab (issue #215 follow-up) lists and edits against. */
export function listCommentDirectives(content: string): CommentDirectiveOccurrence[] {
  const occurrences: CommentDirectiveOccurrence[] = []
  content.split('\n').forEach((raw, lineNumber) => {
    const parsed = parseCommentDirective(raw)
    if (parsed) occurrences.push({ ...parsed, lineNumber })
  })
  return occurrences
}

/**
 * Whether a comment's targets should be shown to the given active profile. `targets === null`
 * ("everyone") always matches, including when nobody's signed in on this device - same
 * before-this-feature behavior as every comment being visible to everyone. A targeted comment
 * whose names don't resolve to anyone on the current roster (a typo, or a profile renamed/
 * removed since) also fails open (shown to everyone) rather than silently vanishing forever -
 * missing a real note like "start solo fret 7" live is worse than one extra person seeing it.
 */
export function commentVisibleTo(
  targets: string[] | null,
  activeProfileName: string | null | undefined,
  rosterNames: readonly string[],
): boolean {
  if (targets === null) return true

  const normalizedRoster = rosterNames.map((name) => name.trim().toLowerCase())
  const resolvesToSomeone = targets.some((target) => normalizedRoster.includes(target))
  if (!resolvesToSomeone) return true

  if (!activeProfileName || activeProfileName.trim().length === 0) return true
  return targets.includes(activeProfileName.trim().toLowerCase())
}

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

/**
 * Parses ChordPro-formatted text (e.g. `[01:14.50] I shot the [G] Sheriff`) into lines of
 * chord/text segments. Part directives (`{part: Chorus}`) are consumed here: they produce no
 * line of their own, they tag the lines that follow them.
 */
export function parseChordPro(content: string): ChordProLine[] {
  const lines: ChordProLine[] = []
  let partIndex = 0
  let partLabel: string | null = null
  let partStarted = false

  for (const raw of content.split('\n')) {
    if (raw.trim().length === 0) continue

    const directive = parsePartDirective(raw)
    if (directive) {
      // Only advance the part counter once we actually emitted lines for the current one,
      // so two directives in a row don't leave an empty part behind.
      if (partStarted) partIndex += 1
      partLabel = directive.label
      partStarted = false
      continue
    }

    const comment = parseCommentDirective(raw)
    if (comment !== null) {
      lines.push({
        timeMs: null,
        segments: [],
        partIndex,
        partLabel,
        comment: comment.text,
        commentTargets: comment.targets,
      })
      partStarted = true
      continue
    }

    const { timeMs, rest } = parseTimeTag(raw)
    lines.push({
      timeMs,
      segments: parseChordSegments(rest),
      partIndex,
      partLabel,
      comment: null,
      commentTargets: null,
    })
    partStarted = true
  }

  return lines
}

/** Formats milliseconds as a ChordPro time tag, e.g. `74500` -> `[01:14.50]`. */
export function formatTimeTag(ms: number): string {
  const totalSeconds = Math.max(0, ms) / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds - minutes * 60
  return `[${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}]`
}

/** Replaces (or adds) the leading time tag of a raw ChordPro line, used by Tap-to-Sync. */
export function setLineTimeTag(line: string, ms: number): string {
  const withoutTag = line.replace(TIME_TAG_RE, '')
  return `${formatTimeTag(ms)} ${withoutTag}`
}

/** Index of the last timestamped line whose timeMs has already passed, for Section Highlighting. */
export function currentLineIndex(lines: ChordProLine[], elapsedMs: number): number {
  let index = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].timeMs !== null && lines[i].timeMs! <= elapsedMs) {
      index = i
    }
  }
  return index
}

/**
 * Splits parsed lines into the pages the Paginated View flips through: one page per song part
 * when the song defines them, otherwise fixed-size chunks so an unstructured song still paginates.
 */
export function buildPages(lines: ChordProLine[], fallbackSize = 6): SongPage[] {
  if (lines.length === 0) return []

  if (lines.some((line) => line.partLabel !== null)) {
    const pages: SongPage[] = []
    for (const [index, line] of lines.entries()) {
      const current = pages[pages.length - 1]
      if (current && line.partIndex === lines[current.startIndex].partIndex) {
        current.endIndex = index + 1
      } else {
        pages.push({ label: line.partLabel, startIndex: index, endIndex: index + 1 })
      }
    }
    return pages
  }

  const pages: SongPage[] = []
  for (let start = 0; start < lines.length; start += fallbackSize) {
    pages.push({ label: null, startIndex: start, endIndex: Math.min(start + fallbackSize, lines.length) })
  }
  return pages
}

/** Index of the page holding the given line, for flipping the Paginated View in sync with the clock. */
export function currentPageIndex(pages: SongPage[], lineIndex: number): number {
  const index = pages.findIndex((page) => lineIndex >= page.startIndex && lineIndex < page.endIndex)
  return index === -1 ? 0 : index
}

/**
 * Where a manual "Umblättern" (foot switch, docs/04's No-Timecode Modus) should jump to:
 * the next song part when the song defines parts, otherwise simply the next line. Either way
 * the first *timestamped* line at or after that point wins, since the jump seeks the clock.
 * Returns null at the end of the song, where the trigger does nothing.
 */
export function nextSectionIndex(lines: ChordProLine[], index: number): number | null {
  const current = lines[index]
  if (!current) return null

  const hasParts = lines.some((line) => line.partLabel !== null)
  const from = hasParts
    ? lines.findIndex((line, i) => i > index && line.partIndex !== current.partIndex)
    : index + 1
  if (from === -1) return null

  for (let i = from; i < lines.length; i++) {
    if (lines[i].timeMs !== null) return i
  }
  return null
}

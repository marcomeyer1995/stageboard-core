import {
  formatCommentDirective,
  formatTabStartDirective,
  parseCommentDirective,
  parseTabStartDirective,
  tabBlockSpan,
} from './chordpro'
import { timelineLines, type TimelineLine } from './timelineText'

/**
 * Comments and tab blocks on the timeline (docs/14 §7, phase 3b). Both belong to a lyric line in
 * the ChordPro text - the Prompter shows them right before it - so on the time axis they sit at
 * that line's time, and moving one means attaching it to another line: its directive line (a tab
 * block with all its lines) moves in the text to just before the line playing at the new time.
 * Pure, no DOM; like the Kommentare tab, notes are found by their current line number, recomputed
 * from the text on every call.
 */

export interface TimelineNote {
  kind: 'comment' | 'tab'
  /** Raw line span in the text: `start` is the directive, `end` is exclusive. */
  start: number
  end: number
  /** The comment's text, or the tab block's label (null without one). */
  text: string | null
  /** Lowercased target names ("Sichtbar für"), null = everyone. */
  targets: string[] | null
  /** The lyric line it belongs to (the next one after it, else the one before) and its time. */
  anchorRawIndex: number | null
  timeMs: number | null
}

/** Every comment and tab block, in text order, with the line they belong to. */
export function timelineNotes(content: string): TimelineNote[] {
  const raw = content.split('\n')
  const lines = timelineLines(content)
  const anchor = (end: number): TimelineLine | undefined => lines.find((l) => l.rawIndex >= end) ?? [...lines].reverse().find((l) => l.rawIndex < end)
  const notes: TimelineNote[] = []
  for (let i = 0; i < raw.length; i++) {
    const comment = parseCommentDirective(raw[i]!)
    if (comment) {
      const line = anchor(i + 1)
      notes.push({ kind: 'comment', start: i, end: i + 1, text: comment.text, targets: comment.targets, anchorRawIndex: line?.rawIndex ?? null, timeMs: line?.timeMs ?? null })
      continue
    }
    const tab = parseTabStartDirective(raw[i]!)
    if (tab) {
      const { end } = tabBlockSpan(raw, i)
      const line = anchor(end)
      notes.push({ kind: 'tab', start: i, end, text: tab.label, targets: tab.targets, anchorRawIndex: line?.rawIndex ?? null, timeMs: line?.timeMs ?? null })
      i = end - 1
    }
  }
  return notes
}

/** The timed lyric line playing at `timeMs` - the last one starting at or before it, else the
 * first timed line. Null without any timed line. */
export function lineAtTime(content: string, timeMs: number): TimelineLine | null {
  const timed = timelineLines(content)
    .filter((l) => l.timeMs !== null)
    .sort((a, b) => a.timeMs! - b.timeMs!)
  return [...timed].reverse().find((l) => l.timeMs! <= timeMs) ?? timed[0] ?? null
}

/** Moves the note starting at raw line `start` to just before the line playing at `timeMs`
 * (after any notes already there) - the new text and the note's new start line. Unchanged when it
 * already belongs to that line. */
export function moveNote(content: string, start: number, timeMs: number): { content: string; start: number } {
  const note = timelineNotes(content).find((n) => n.start === start)
  const target = lineAtTime(content, timeMs)
  if (!note || !target || target.rawIndex === note.anchorRawIndex) return { content, start }
  const raw = content.split('\n')
  const block = raw.splice(note.start, note.end - note.start)
  const at = target.rawIndex > note.start ? target.rawIndex - block.length : target.rawIndex
  raw.splice(at, 0, ...block)
  return { content: raw.join('\n'), start: at }
}

/** A new comment for everyone, right before the line playing at `timeMs`. Unchanged without a
 * timed line to attach it to. */
export function insertComment(content: string, timeMs: number, text: string): string {
  const target = lineAtTime(content, timeMs)
  if (!target) return content
  const raw = content.split('\n')
  raw.splice(target.rawIndex, 0, formatCommentDirective(text, null))
  return raw.join('\n')
}

/** Removes a comment line, or a whole tab block. */
export function removeNote(content: string, start: number): string {
  const note = timelineNotes(content).find((n) => n.start === start)
  if (!note) return content
  const raw = content.split('\n')
  raw.splice(note.start, note.end - note.start)
  return raw.join('\n')
}

/** Rewrites a comment's text, or a tab block's label, keeping who sees it. */
export function setNoteText(content: string, start: number, text: string): string {
  const note = timelineNotes(content).find((n) => n.start === start)
  if (!note) return content
  return patchDirective(content, note, text, note.targets)
}

/** Sets who sees a note - display-case profile names, null for everyone. */
export function setNoteTargets(content: string, start: number, targets: string[] | null): string {
  const note = timelineNotes(content).find((n) => n.start === start)
  if (!note) return content
  return patchDirective(content, note, note.text, targets)
}

function patchDirective(content: string, note: TimelineNote, text: string | null, targets: string[] | null): string {
  const raw = content.split('\n')
  raw[note.start] = note.kind === 'comment' ? formatCommentDirective(text ?? '', targets) : formatTabStartDirective(text && text.trim() ? text.trim() : null, targets)
  return raw.join('\n')
}

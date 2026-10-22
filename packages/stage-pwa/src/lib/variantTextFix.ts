import { clearLineTimeTag } from './chordpro'

/** One place in another variant that still has the old line. */
export interface FixTarget {
  variantId: string
  variantLabel: string
  /** 0-based line in that variant's ChordPro text. */
  lineIndex: number
}

/** A line changed in the saved variant, with every other variant that has the same old line. */
export interface TextFixOffer {
  /** The line before and after, without timing tags - what the dialog shows. */
  before: string
  after: string
  targets: FixTarget[]
}

interface OtherVariant {
  id: string
  label: string
  chordProContent: string
}

/** A line as the comparison sees it: no timing tag (each variant has its own), no trailing space. */
const textOf = (line: string) => clearLineTimeTag(line).trimEnd()

/**
 * The lines that were *changed* (not only moved, added or removed) between two versions: a line
 * diff on the text without timing tags, and within each block where lines were replaced, the
 * removed and added lines paired in order. A line whose only change is its timing tag is no fix.
 * `oldIndex` is the line's place in the old text.
 */
export function changedLines(before: string, after: string): { oldIndex: number; before: string; after: string }[] {
  const a = before.split('\n').map(textOf)
  const b = after.split('\n').map(textOf)
  // Longest common subsequence table, from the end.
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  }
  const changes: { oldIndex: number; before: string; after: string }[] = []
  let removed: number[] = []
  let added: number[] = []
  const flush = () => {
    for (let k = 0; k < Math.min(removed.length, added.length); k++) {
      if (a[removed[k]] !== b[added[k]]) changes.push({ oldIndex: removed[k], before: a[removed[k]], after: b[added[k]] })
    }
    removed = []
    added = []
  }
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush()
      i++
      j++
    } else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      added.push(j++)
    } else {
      removed.push(i++)
    }
  }
  flush()
  return changes
}

/**
 * What a save could also fix elsewhere (#600): for every changed line, the other variants that
 * still have the same old line. A line that occurs several times (a chorus) matches by occurrence -
 * the 2nd "Cause I'm T.N.T." changed here is offered as the 2nd one there, never a different one; a
 * shorter variant without that occurrence is simply not offered.
 */
export function textFixOffers(before: string, after: string, others: readonly OtherVariant[]): TextFixOffer[] {
  const oldLines = before.split('\n').map(textOf)
  const offers: TextFixOffer[] = []
  for (const change of changedLines(before, after)) {
    if (change.before.trim() === '') continue
    const occurrence = oldLines.slice(0, change.oldIndex).filter((line) => line === change.before).length
    const targets: FixTarget[] = []
    for (const other of others) {
      const lines = other.chordProContent.split('\n').map(textOf)
      const matches = lines.flatMap((line, index) => (line === change.before ? [index] : []))
      if (matches[occurrence] !== undefined) targets.push({ variantId: other.id, variantLabel: other.label, lineIndex: matches[occurrence] })
    }
    if (targets.length > 0) offers.push({ before: change.before, after: change.after, targets })
  }
  return offers
}

/** Replaces the picked lines of one variant with the fixed text - each line keeps its own timing
 * tag, so a variant's timings never change. */
export function applyTextFixes(content: string, fixes: readonly { lineIndex: number; after: string }[]): string {
  const lines = content.split('\n')
  for (const fix of fixes) {
    const line = lines[fix.lineIndex]
    if (line === undefined) continue
    const tag = line.slice(0, line.length - clearLineTimeTag(line).length)
    lines[fix.lineIndex] = tag + fix.after
  }
  return lines.join('\n')
}

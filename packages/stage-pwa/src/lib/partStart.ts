import { parsePartDirective, parseTimeTag, tappableLines } from './chordpro'
import { partHeads } from './partCues'

/**
 * Where a part starts as a section of the show (#479), set by hand in the timeline: a line right
 * after its part directive - `{x_bar: 17}` - so it travels with the part through every edit, undo
 * and copy, like its announcement (`{x_announce}`, partCues.ts). A bar number, not a time: it stays
 * right when the grid or tempo is edited. Without it the start comes from the part's first lyric
 * line (showSections.ts). ChordPro's `x_` prefix: other programs ignore the line.
 */

const BAR_DIRECTIVE_RE = /^\{\s*x_bar\s*:\s*(-?\d+)\s*\}$/i

export function formatBarDirective(bar: number): string {
  return `{x_bar: ${bar}}`
}

/** The bar of an `{x_bar: …}` line; null for any other line. */
export function parseBarDirective(line: string): number | null {
  const match = line.trim().match(BAR_DIRECTIVE_RE)
  return match ? Number(match[1]) : null
}

/** For each part (numbered like `timelineLines`), the line of its `{x_bar}` and the bar - an
 * `{x_bar}` counts for the part when it comes after the directive and before its first lyric line. */
function partBarLines(content: string): Map<number, { rawIndex: number; bar: number }> {
  const raw = content.split('\n')
  const tappable = tappableLines(raw)
  const found = new Map<number, { rawIndex: number; bar: number }>()
  let partIndex = 0
  let partStarted = false
  let inHead = false
  raw.forEach((line, rawIndex) => {
    if (parsePartDirective(line)) {
      if (partStarted) partIndex += 1
      partStarted = false
      inHead = true
      return
    }
    const bar = parseBarDirective(line)
    if (bar !== null) {
      if (inHead && !partStarted && !found.has(partIndex)) found.set(partIndex, { rawIndex, bar })
      return
    }
    if (!tappable[rawIndex]) return
    if (/^\{[^}]*\}$/.test(parseTimeTag(line).rest.trim())) return
    partStarted = true
  })
  return found
}

/** Every part's start bar set by hand. */
export function partStartBars(content: string): Map<number, number> {
  return new Map([...partBarLines(content)].map(([partIndex, { bar }]) => [partIndex, bar]))
}

/** Sets part `partIndex`'s start bar, or (`null`) back to the automatic one. */
export function setPartStartBar(content: string, partIndex: number, bar: number | null): string {
  const head = partHeads(content).find((h) => h.partIndex === partIndex)
  if (!head) return content
  const raw = content.split('\n')
  const existing = partBarLines(content).get(partIndex)
  if (existing) {
    if (bar === null) raw.splice(existing.rawIndex, 1)
    else raw[existing.rawIndex] = formatBarDirective(bar)
  } else if (bar !== null) {
    raw.splice(head.rawIndex + 1, 0, formatBarDirective(bar))
  }
  return raw.join('\n')
}

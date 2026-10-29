import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'

export interface BackdropMark {
  start: number
  end: number
  current: boolean
}

/**
 * The layer behind the song text field (Marco, 2026-10-29, like Notepad++): what a textarea can't
 * draw itself - invisible characters (· space, → tab, ¶ line end) and every search match in colour,
 * the current one stronger. The same text in the same monospace font, size, padding and wrapping
 * lies exactly under the field's own (transparent) text; only the symbols and the marks show.
 * Follows the field's scrolling and the width its scrollbar takes.
 */
export function EditorBackdrop({ text, textarea, showInvisibles, marks }: { text: string; textarea: RefObject<HTMLTextAreaElement>; showInvisibles: boolean; marks: readonly BackdropMark[] }) {
  const layer = useRef<HTMLDivElement>(null)

  // After every update too, not only on the field's scroll events: new marks replace the layer's
  // content, and its scroll position got lost there - the song's first marks lay over its end
  // (Redmi, 2026-10-29).
  useLayoutEffect(() => {
    const field = textarea.current
    const back = layer.current
    if (field && back) {
      back.scrollTop = field.scrollTop
      back.scrollLeft = field.scrollLeft
    }
  })

  useLayoutEffect(() => {
    const field = textarea.current
    const back = layer.current
    if (!field || !back) return
    const sync = () => {
      back.scrollTop = field.scrollTop
      back.scrollLeft = field.scrollLeft
      // A scrollbar narrows the field's text area; the layer must wrap at the same width.
      const style = getComputedStyle(field)
      const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)
      back.style.paddingRight = `${parseFloat(style.paddingRight) + Math.max(0, field.offsetWidth - field.clientWidth - borders)}px`
    }
    sync()
    field.addEventListener('scroll', sync)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync)
    observer?.observe(field)
    return () => {
      field.removeEventListener('scroll', sync)
      observer?.disconnect()
    }
  }, [textarea, text])

  return (
    <div
      ref={layer}
      aria-hidden="true"
      data-testid="editor-backdrop"
      className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap rounded-control border border-transparent bg-control p-2 font-sb-mono text-base text-transparent [overflow-wrap:break-word]"
    >
      {renderLayer(text, showInvisibles, marks)}
      {/* The field can scroll past its last line by one line height - so can the layer. */}
      {'\n '}
    </div>
  )
}

const SYMBOL = 'pointer-events-none absolute left-0 top-0 text-ink-faint'

/** The text as runs of plain characters, marks and invisible-character symbols. */
function renderLayer(text: string, showInvisibles: boolean, marks: readonly BackdropMark[]): ReactNode[] {
  const nodes: ReactNode[] = []
  // Which mark covers each character (the current one wins where marks overlap).
  const markAt: (BackdropMark | null)[] = new Array<BackdropMark | null>(text.length).fill(null)
  for (const mark of marks) {
    for (let i = Math.max(0, mark.start); i < Math.min(text.length, mark.end); i++) if (!markAt[i]?.current) markAt[i] = mark
  }
  let run = ''
  let runMark: BackdropMark | null = null
  const flush = (key: number) => {
    if (!run) return
    nodes.push(
      runMark ? (
        <mark key={`r${key}`} data-current={runMark.current || undefined} className={`rounded-sm text-transparent ${runMark.current ? 'bg-accent/60' : 'bg-accent/25'}`}>
          {run}
        </mark>
      ) : (
        run
      ),
    )
    run = ''
  }
  for (let i = 0; i < text.length; i++) {
    const mark = markAt[i]!
    const c = text[i]!
    if (mark !== runMark) flush(i)
    runMark = mark
    if (showInvisibles && (c === ' ' || c === '\t' || c === '\n')) {
      flush(i)
      const symbol = c === ' ' ? '·' : c === '\t' ? '→' : '¶'
      // The real character keeps its width (and the wrapping); the symbol floats over it. A line
      // end gets a zero-width anchor before the break, so ¶ sits right after the line's last character.
      nodes.push(
        c === '\n' ? (
          <span key={`s${i}`} className="relative">
            <span className={SYMBOL}>{symbol}</span>
            {'\n'}
          </span>
        ) : (
          <span key={`s${i}`} data-current={mark?.current || undefined} className={`relative ${mark ? (mark.current ? 'bg-accent/60' : 'bg-accent/25') : ''}`}>
            {c}
            <span className={`${SYMBOL} ${c === ' ' ? 'w-full text-center' : ''}`}>{symbol}</span>
          </span>
        ),
      )
      continue
    }
    run += c
  }
  flush(text.length)
  return nodes
}

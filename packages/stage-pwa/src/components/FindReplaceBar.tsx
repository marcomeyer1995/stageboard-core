import { useEffect, useMemo, useState, type MutableRefObject, type SyntheticEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { explainPattern, findMatches, REGEX_BLOCKS, REPLACEMENT_BLOCKS, replaceOne, replaceText, type RegexBlock, type ReplaceOptions, type SearchMode, type TextMatch } from '../lib/textReplace'
import type { BackdropMark } from './EditorBackdrop'
import { Button, Dialog, IconButton, InfoHint, Segmented, ToggleChip } from './ui'
import { INPUT } from './ui/styles'

type Caret = { start: number; end: number }
const caretOf = (e: SyntheticEvent<HTMLInputElement>): Caret => ({ start: e.currentTarget.selectionStart ?? e.currentTarget.value.length, end: e.currentTarget.selectionEnd ?? e.currentTarget.value.length })

function insertAt(value: string, caret: Caret | null, block: RegexBlock): string {
  const at = caret ?? { start: value.length, end: value.length }
  const piece = block.wrap ? `${block.wrap[0]}${value.slice(at.start, at.end)}${block.wrap[1]}` : block.insert
  return value.slice(0, at.start) + piece + value.slice(at.end)
}

/** One line of the preview: the matches in it marked, before and after. */
function PreviewRow({ content, line, matches, onPick, current }: { content: string; line: number; matches: TextMatch[]; onPick: () => void; current: boolean }) {
  const { t } = useTranslation('editor')
  const lineStart = content.split('\n').slice(0, line - 1).reduce((sum, l) => sum + l.length + 1, 0)
  const lineText = content.slice(lineStart, content.indexOf('\n', lineStart) === -1 ? content.length : content.indexOf('\n', lineStart))
  const before: React.ReactNode[] = []
  const after: React.ReactNode[] = []
  let at = 0
  for (const m of matches) {
    const s = m.start - lineStart
    const e = Math.min(m.end - lineStart, lineText.length)
    if (s < at) continue
    before.push(lineText.slice(at, s))
    after.push(lineText.slice(at, s))
    before.push(<mark key={`b${s}`} className="rounded-sm bg-danger/25 text-ink line-through">{lineText.slice(s, e) || '∅'}</mark>)
    after.push(<mark key={`a${s}`} className="rounded-sm bg-ok/25 text-ink">{m.replacement.replace(/\n/g, '⏎') || '∅'}</mark>)
    at = e
  }
  before.push(lineText.slice(at))
  after.push(lineText.slice(at))
  return (
    <button type="button" onClick={onPick} className={`flex w-full flex-col gap-0.5 rounded-control px-3 py-2 text-left font-sb-mono text-base ${current ? 'bg-control-strong' : 'bg-control'}`}>
      <span className="font-sans text-sm text-ink-faint">{t('find.line', { line })}</span>
      <span className="whitespace-pre-wrap break-all text-ink-soft">{before}</span>
      <span className="whitespace-pre-wrap break-all text-ink">{after}</span>
    </button>
  )
}

/**
 * Suchen & Ersetzen as a bar above the song text (Marco, 2026-10-29: like Notepad++) - it stays
 * open while you work in the text. ◀ ▶ go from match to match (marked in the text, the current one
 * stronger, scrolled into view), "Ersetzen" replaces the current one and moves on, "Alle ersetzen"
 * all of them. Modes Normal / Erweitert / Regulärer Ausdruck, case, whole words, wrap around, only
 * the marked lines; in regex mode a builder and the pattern explained in words; a preview of every
 * line with its matches - a tap on one jumps there.
 */
/** What the bar holds - kept by the editor, so switching to Vorschau and back keeps the search. */
export interface FindMemory {
  find?: string
  replacement?: string
  mode?: SearchMode
  caseSensitive?: boolean
  wholeWord?: boolean
  wrap?: boolean
  current?: number
}

export function FindReplaceBar({
  content,
  range,
  memory,
  compact = false,
  onReplace,
  onMarks,
  onClose,
}: {
  content: string
  memory: MutableRefObject<FindMemory>
  /** Little room (keyboard up, a phone): one row - ⇄ shows the replacement, ⚙ the options. */
  compact?: boolean
  /** The lines marked when the bar opened, or null. */
  range: { start: number; end: number } | null
  onReplace: (after: string, label: string) => void
  onMarks: (marks: BackdropMark[], current: TextMatch | null) => void
  onClose: () => void
}) {
  const { t } = useTranslation('editor')
  const [find, setFind] = useState(memory.current.find ?? '')
  const [replacement, setReplacement] = useState(memory.current.replacement ?? '')
  const [mode, setMode] = useState<SearchMode>(memory.current.mode ?? 'normal')
  const [caseSensitive, setCaseSensitive] = useState(memory.current.caseSensitive ?? false)
  const [wholeWord, setWholeWord] = useState(memory.current.wholeWord ?? false)
  const [wrap, setWrap] = useState(memory.current.wrap ?? true)
  const [inSelection, setInSelection] = useState(range !== null)
  const [scope, setScope] = useState(range)
  const [current, setCurrent] = useState(memory.current.current ?? 0)
  const [notice, setNotice] = useState<string | null>(null)
  const [showBuilder, setShowBuilder] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  // Compact: the replacement row only when wanted, the options in their own window.
  const [showReplace, setShowReplace] = useState(Boolean(memory.current.replacement))
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [findCaret, setFindCaret] = useState<Caret | null>(null)
  const [replaceCaret, setReplaceCaret] = useState<Caret | null>(null)

  const options: ReplaceOptions = { find, replacement, mode, caseSensitive, wholeWord }
  const limited = inSelection && scope !== null
  const found = useMemo(
    () => findMatches(content, { find, replacement, mode, caseSensitive, wholeWord }, limited ? scope.start : 0, limited ? scope.end : content.length),
    [content, find, replacement, mode, caseSensitive, wholeWord, limited, scope],
  )
  const error = 'error' in found ? found.error : null
  const matches = 'error' in found ? [] : found
  const index = matches.length === 0 ? -1 : Math.min(current, matches.length - 1)
  const explanation = useMemo(() => (mode === 'regex' && find && !error ? explainPattern(find) : []), [mode, find, error])

  useEffect(() => {
    onMarks(
      matches.map((m, i) => ({ start: m.start, end: m.end, current: i === index })),
      index >= 0 ? matches[index]! : null,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, index])
  useEffect(() => () => onMarks([], null), [onMarks])
  useEffect(() => {
    memory.current = { find, replacement, mode, caseSensitive, wholeWord, wrap, current }
  }, [memory, find, replacement, mode, caseSensitive, wholeWord, wrap, current])

  const go = (by: 1 | -1) => {
    if (matches.length === 0) return
    let next = index + by
    if (next >= matches.length || next < 0) {
      if (!wrap) {
        setNotice(by > 0 ? t('find.endReached') : t('find.startReached'))
        return
      }
      next = (next + matches.length) % matches.length
      setNotice(by > 0 ? t('find.fromStart') : t('find.fromEnd'))
    } else setNotice(null)
    setCurrent(next)
  }
  // The marked lines grow or shrink with what a replacement put in.
  const keepScope = (after: string) => scope && setScope({ start: scope.start, end: scope.end + (after.length - content.length) })

  const replaceCurrent = () => {
    const match = index >= 0 ? matches[index] : undefined
    if (!match) return
    const after = replaceOne(content, match)
    keepScope(after)
    onReplace(after, t('find.replaced'))
    // The same index is now the next match.
    setNotice(null)
  }
  const replaceAll = () => {
    const result = replaceText(content, options, limited ? scope.start : 0, limited ? scope.end : content.length)
    if ('error' in result || result.count === 0) return
    keepScope(result.content)
    onReplace(result.content, t('find.replacedN', { count: result.count }))
    setCurrent(0)
  }

  const field = `h-form flex-1 min-w-0 px-3 font-sb-mono text-base ${INPUT}`
  const chip = 'min-h-touch rounded-control bg-control-strong px-3 text-base text-ink [@media(hover:hover)]:hover:bg-control-hover'
  const byLine = new Map<number, TextMatch[]>()
  for (const m of matches) byLine.set(m.line, [...(byLine.get(m.line) ?? []), m])
  const previewLines = [...byLine.entries()].slice(0, 40)

  const optionsPanel = (
    <>
        {explanation.length > 0 && (
          <p className="rounded-control bg-control px-3 py-2 text-sm text-ink-soft">
            <span className="font-semibold text-ink">{t('find.patternSeeks')}</span>
            {explanation.join(' · ')}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {/* Never narrower than its three words - the ⓘ wrap below it on a phone instead of overlapping. */}
          <div className="min-w-[17rem] flex-1">
          <Segmented
            label={t('find.mode')}
            value={mode}
            onChange={(v) => {
              setMode(v as SearchMode)
              setCurrent(0)
            }}
            options={[
              { value: 'normal', label: t('find.normal') },
              { value: 'extended', label: t('find.extended') },
              { value: 'regex', label: t('find.regex') },
            ]}
          />
          </div>
          <InfoHint text={t('find.modeInfo')} />
        {compact && (
          <span className="flex items-center gap-1 text-sm text-ink-soft">
            {t('find.replace')}
            <InfoHint text={t('find.replaceInfo')} label={t('find.replaceLabel')} />
          </span>
        )}
        </div>
        <div className="flex flex-wrap gap-2">
          <ToggleChip label={t('find.case')} selected={caseSensitive} onToggle={setCaseSensitive} />
          <ToggleChip label={t('find.whole')} selected={wholeWord} onToggle={setWholeWord} />
          <ToggleChip label={t('find.wrap')} selected={wrap} onToggle={setWrap} />
          {scope && <ToggleChip label={t('find.inSelection')} selected={inSelection} onToggle={setInSelection} />}
          {mode === 'regex' && <ToggleChip label={t('find.builder')} selected={showBuilder} onToggle={setShowBuilder} />}
          <ToggleChip label={t('find.preview')} selected={showPreview} onToggle={setShowPreview} />
        </div>

        {mode === 'regex' && showBuilder && (
          <div role="group" aria-label={t('find.builderAria')} className="flex flex-col gap-2">
            <p className="flex items-center gap-2 text-sm text-ink-soft">
              {t('find.builderHint')}
            </p>
            {REGEX_BLOCKS.map(({ group, blocks }) => (
              <div key={group} className="flex flex-wrap items-center gap-2">
                <span className="w-20 text-sm font-semibold text-ink-faint">{group}</span>
                {blocks.map((block) => (
                  <button key={block.label} type="button" className={chip} title={block.meaning} onClick={() => setFind((value) => insertAt(value, findCaret, block))}>
                    {block.label} <span className="font-sb-mono text-ink-soft">{block.insert}</span>
                  </button>
                ))}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20 text-sm font-semibold text-ink-faint">{t('find.replace')}</span>
              {REPLACEMENT_BLOCKS.map((block) => (
                <button key={block.label} type="button" className={chip} title={block.meaning} onClick={() => setReplacement((value) => insertAt(value, replaceCaret, block))}>
                  {block.label} <span className="font-sb-mono text-ink-soft">{block.insert}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {showPreview && matches.length > 0 && (
          <div role="region" aria-label={t('find.preview')} className="flex flex-col gap-1">
            {previewLines.map(([line, inLine]) => (
              <PreviewRow
                key={line}
                content={content}
                line={line}
                matches={inLine}
                current={index >= 0 && matches[index]!.line === line}
                onPick={() => setCurrent(matches.indexOf(inLine[0]!))}
              />
            ))}
            {byLine.size > previewLines.length && <p className="text-sm text-ink-faint">{t('find.more', { count: byLine.size - previewLines.length })}</p>}
          </div>
        )}
    </>
  )

  return (
    <section aria-label={t('find.aria')} className={`flex flex-shrink-0 flex-col gap-2 rounded-container border border-line bg-surface ${compact ? 'p-1' : 'max-h-[60%] overflow-y-auto p-2'}`}>
      {/* Side by side where wide enough, else one under the other. */}
      <div className="flex flex-wrap items-center gap-2">
      <div className="flex min-w-[18rem] flex-1 flex-wrap items-center gap-2">
        {/* The field keeps a readable width; on a narrow phone the buttons wrap below it. */}
        <div className="flex min-w-[12rem] flex-1 items-center gap-2">
        <input
          aria-label={t('find.search')}
          value={find}
          autoFocus
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={t('find.search')}
          aria-invalid={error ? true : undefined}
          className={`${field} ${error ? '!border-danger' : ''}`}
          onChange={(e) => {
            setFind(e.target.value)
            setFindCaret(caretOf(e))
            setCurrent(0)
            setNotice(null)
          }}
          onSelect={(e) => setFindCaret(caretOf(e))}
          onKeyDown={(e) => e.key === 'Enter' && go(e.shiftKey ? -1 : 1)}
        />
        <span className="min-w-14 text-center text-base tabular-nums text-ink-soft" aria-live="polite">
          {find && !error ? (matches.length === 0 ? '0' : `${index + 1}/${matches.length}`) : ''}
        </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
        <IconButton icon="previous" label={t('find.prev')} disabled={matches.length === 0} onClick={() => go(-1)} />
        <IconButton icon="next" label={t('find.next')} disabled={matches.length === 0} onClick={() => go(1)} />
        {compact && (
          <>
            <IconButton icon="edit" label={showReplace ? t('find.hideReplace') : t('find.showReplace')} variant={showReplace ? 'primary' : 'secondary'} onClick={() => setShowReplace((on) => !on)} />
            <IconButton
              icon="details"
              label={t('find.options')}
              onClick={() => {
                // The keyboard goes down first: the options get the whole height.
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
                setOptionsOpen(true)
              }}
            />
          </>
        )}
        <IconButton icon="close" label={t('find.close')} variant="quiet" onClick={onClose} />
        </div>
      </div>
      {(!compact || showReplace) && (
        <div className={`flex items-center gap-2 ${compact ? 'min-w-[18rem] flex-1' : 'w-full flex-wrap'}`}>
          <input
            aria-label={t('find.replaceWith')}
            value={replacement}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={t('find.replaceWith')}
            className={field}
            onChange={(e) => {
              setReplacement(e.target.value)
              setReplaceCaret(caretOf(e))
            }}
            onSelect={(e) => setReplaceCaret(caretOf(e))}
          />
          {!compact && <InfoHint text={t('find.replaceInfo')} />}
          <Button disabled={index < 0} onClick={replaceCurrent}>
            {t('find.replace')}
          </Button>
          <Button variant="primary" disabled={matches.length === 0} onClick={replaceAll}>
            {compact
              ? matches.length > 0
                ? t('find.allShortN', { count: matches.length })
                : t('find.allShort')
              : matches.length > 0
                ? t('find.allN', { count: matches.length })
                : t('find.all')}
          </Button>
        </div>
      )}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {notice && <p className="text-sm text-ink-soft">{notice}</p>}
      {!compact && optionsPanel}
      {compact && optionsOpen && (
        <Dialog title={t('find.options')} size="l" onClose={() => setOptionsOpen(false)}>
          {optionsPanel}
        </Dialog>
      )}
    </section>
  )
}

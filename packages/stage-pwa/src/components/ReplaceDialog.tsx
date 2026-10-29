import { useMemo, useState, type SyntheticEvent } from 'react'
import { explainPattern, previewChanges, REGEX_BLOCKS, REPLACEMENT_BLOCKS, replaceText, type RegexBlock } from '../lib/textReplace'
import { Button, Dialog, Field, InfoHint, Switch } from './ui'

const REGEX_INFO =
  'Ein regulärer Ausdruck ist ein Suchmuster statt eines festen Texts: „\\d+“ findet jede Zahl, „^\\[“ jede Zeile, die mit „[“ beginnt. ' +
  'Mit ( ) gefundene Teile lassen sich beim Ersetzen als $1, $2 … wieder einsetzen. ^ und $ meinen Anfang und Ende einer Zeile. ' +
  'Die Knöpfe unten setzen die Bausteine an der Cursor-Stelle ein.'
const REPLACE_INFO = 'Womit jeder Treffer ersetzt wird. Leer: der Treffer wird gelöscht. Mit regulären Ausdrücken: $1, $2 … = was die erste, zweite ( ) gefunden hat, $& = der ganze Treffer, $$ = ein Dollarzeichen.'

/** Where the cursor (or selection) of a field was last - the builder inserts there. */
type Caret = { start: number; end: number }
const caretOf = (e: SyntheticEvent<HTMLInputElement>): Caret => ({ start: e.currentTarget.selectionStart ?? e.currentTarget.value.length, end: e.currentTarget.selectionEnd ?? e.currentTarget.value.length })

function insertAt(value: string, caret: Caret | null, block: RegexBlock): string {
  const at = caret ?? { start: value.length, end: value.length }
  const selected = value.slice(at.start, at.end)
  const piece = block.wrap ? `${block.wrap[0]}${selected}${block.wrap[1]}` : block.insert
  return value.slice(0, at.start) + piece + value.slice(at.end)
}

/**
 * "Suchen & Ersetzen" (#605, Marco 2026-10-29): literally by default; with "Reguläre Ausdrücke" a
 * pattern with groups, a builder to click patterns together, the pattern explained in words, and a
 * preview of every line it would change before anything is replaced.
 */
export function ReplaceDialog({ text, scope, onApply, onCancel }: { text: string; scope: string; onApply: (after: string, count: number) => void; onCancel: () => void }) {
  const [find, setFind] = useState('')
  const [replacement, setReplacement] = useState('')
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(true)
  const [findCaret, setFindCaret] = useState<Caret | null>(null)
  const [replaceCaret, setReplaceCaret] = useState<Caret | null>(null)

  const result = useMemo(() => replaceText(text, { find, replacement, regex, caseSensitive }), [text, find, replacement, regex, caseSensitive])
  const error = 'error' in result ? result.error : null
  const count = 'error' in result ? 0 : result.count
  const preview = useMemo(() => ('error' in result || result.count === 0 ? null : previewChanges(text, result.content)), [text, result])
  const explanation = useMemo(() => (regex && find && !error ? explainPattern(find) : []), [regex, find, error])

  const chip = 'min-h-touch rounded-control bg-control px-3 text-base text-ink [@media(hover:hover)]:hover:bg-control-hover'

  return (
    <Dialog
      title="Suchen & Ersetzen"
      size="l"
      closeOnBackdrop={false}
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onCancel}>Abbrechen</Button>
          <Button variant="primary" disabled={count === 0 || error !== null} onClick={() => !('error' in result) && onApply(result.content, result.count)}>
            {count === 0 ? 'Ersetzen' : `${count}× ersetzen`}
          </Button>
        </>
      }
    >
      <p className="text-base text-ink-soft">Gilt für: {scope}.</p>
      <Field
        label="Suchen"
        value={find}
        autoFocus
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="font-sb-mono"
        error={error ?? undefined}
        hint={find && !error ? (count === 0 ? 'Kein Treffer.' : `${count} ${count === 1 ? 'Treffer' : 'Treffer'}.`) : undefined}
        onChange={(e) => {
          setFind(e.target.value)
          setFindCaret(caretOf(e))
        }}
        onSelect={(e) => setFindCaret(caretOf(e))}
      />
      {regex && explanation.length > 0 && (
        <div className="rounded-control bg-control px-3 py-2 text-base text-ink-soft">
          <span className="font-semibold text-ink">Das Muster sucht: </span>
          {explanation.join(' · ')}
        </div>
      )}
      <Field
        label="Ersetzen durch"
        value={replacement}
        info={REPLACE_INFO}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="font-sb-mono"
        onChange={(e) => {
          setReplacement(e.target.value)
          setReplaceCaret(caretOf(e))
        }}
        onSelect={(e) => setReplaceCaret(caretOf(e))}
      />
      <Switch label="Reguläre Ausdrücke" checked={regex} onChange={setRegex} info={REGEX_INFO} />
      <Switch label="Groß-/Kleinschreibung beachten" checked={caseSensitive} onChange={setCaseSensitive} description={caseSensitive ? '„Chorus“ findet nicht „chorus“.' : '„Chorus“ findet auch „chorus“ und „CHORUS“.'} />

      {regex && (
        <section aria-label="Regex-Baukasten" className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-base font-semibold text-ink">
            Baukasten
            <InfoHint text="Tippen fügt den Baustein an der Cursor-Stelle im Feld „Suchen“ ein. „Gruppe“ und „Eins von“ legen sich um markierten Text. Die Bausteine unter „Ersetzen“ gehen ins Feld „Ersetzen durch“." />
          </h3>
          {REGEX_BLOCKS.map(({ group, blocks }) => (
            <div key={group} className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-ink-faint">{group}</span>
              <div className="flex flex-wrap gap-2">
                {blocks.map((block) => (
                  <button key={block.label} type="button" className={chip} title={block.meaning} onClick={() => setFind((value) => insertAt(value, findCaret, block))}>
                    {block.label} <span className="font-sb-mono text-ink-soft">{block.insert}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-ink-faint">Ersetzen</span>
            <div className="flex flex-wrap gap-2">
              {REPLACEMENT_BLOCKS.map((block) => (
                <button key={block.label} type="button" className={chip} title={block.meaning} onClick={() => setReplacement((value) => insertAt(value, replaceCaret, block))}>
                  {block.label} <span className="font-sb-mono text-ink-soft">{block.insert}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {preview && (
        <section aria-label="Vorschau" className="flex flex-col gap-2">
          <h3 className="text-base font-semibold text-ink">Vorschau</h3>
          {preview.lines.map((line) => (
            <div key={line.line} className="flex flex-col gap-0.5 rounded-control bg-control px-3 py-2 font-sb-mono text-base">
              <span className="text-sm text-ink-faint">Zeile {line.line}</span>
              <span className="whitespace-pre-wrap break-all text-ink-faint line-through">{line.before || ' '}</span>
              <span className="whitespace-pre-wrap break-all text-ink">{line.after || '(leer)'}</span>
            </div>
          ))}
          {preview.more > 0 && <p className="text-base text-ink-faint">… und {preview.more} weitere Zeilen.</p>}
        </section>
      )}
    </Dialog>
  )
}

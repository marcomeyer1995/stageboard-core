import i18n from '../i18n'
import { useState } from 'react'
import { CUE_BEAT, CUE_NAME, type CuePattern } from 'shared-types'
import { AddRow, Button, Dialog, Field, Select } from './ui'
import { useTranslation } from 'react-i18next'

export interface CuePreset {
  label: string
  pattern: CuePattern
}

const N = CUE_NAME
const B = CUE_BEAT

/** Ready-made patterns for the bars before a part (#63) - a start, every cell can be changed. */
export const PART_CUE_PRESETS: CuePreset[] = [
  { get label() {
      return i18n.t('addons:cue.onlyName')
    }, pattern: [[N, '', '', '']] },
  { get label() {
      return i18n.t('addons:cue.nameCount')
    }, pattern: [[N, B, B, B]] },
  { get label() {
      return i18n.t('addons:cue.nameHalf')
    }, pattern: [[N, '', B, '']] },
  {
    get label() {
      return i18n.t('addons:cue.nameThenCount')
    },
    pattern: [
      [N, '', '', ''],
      [B, B, B, B],
    ],
  },
  {
    get label() {
      return i18n.t('addons:cue.countdown')
    },
    pattern: [
      [N, '', '3', ''],
      ['2', '', '1', ''],
    ],
  },
]

/** Ready-made patterns for the count-in before bar 1 (#63). */
export const COUNT_IN_CUE_PRESETS: CuePreset[] = [
  {
    get label() {
      return i18n.t('addons:cue.classic')
    },
    pattern: [
      ['1', '', '2', ''],
      [B, B, B, B],
    ],
  },
  {
    get label() {
      return i18n.t('addons:cue.everyBeat')
    },
    pattern: [
      [B, B, B, B],
      [B, B, B, B],
    ],
  },
  { get label() {
      return i18n.t('addons:cue.lastBar')
    }, pattern: [[B, B, B, B]] },
  {
    get label() {
      return i18n.t('addons:cue.intro')
    },
    pattern: [
      [N, '', '', ''],
      [B, B, B, B],
    ],
  },
  { get label() {
      return i18n.t('addons:cue.nothing')
    }, pattern: [['', '', '', '']] },
]

const MIN_CELLS = 4
const MAX_CELLS = 12

/** Empty cells at a bar's end carry nothing - two patterns that only differ there are the same. */
function trimBar(cells: readonly string[]): string[] {
  const out = cells.map((c) => c.trim())
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out
}

export function samePattern(a: CuePattern, b: CuePattern): boolean {
  return a.length === b.length && a.every((bar, i) => JSON.stringify(trimBar(bar)) === JSON.stringify(trimBar(b[i]!)))
}

function cellLabel(cell: string, beat: number): string {
  const value = cell.trim()
  if (!value) return '–'
  if (value === CUE_NAME) return i18n.t('addons:cue.name')
  if (value === CUE_BEAT) return `${beat}`
  return value
}

/**
 * One cue pattern (#63): a preset to start from, then the bars before the part, one cell per beat
 * - tap a cell to choose nothing, the part's name, the beat's number or a word of your own.
 */
export function CuePatternEditor({ label, pattern, presets, onChange }: { label: string; pattern: CuePattern; presets: CuePreset[]; onChange: (pattern: CuePattern) => void }) {
  const { t } = useTranslation('addons')
  const [editing, setEditing] = useState<{ bar: number; cell: number } | null>(null)
  const preset = presets.findIndex((p) => samePattern(p.pattern, pattern))
  const bars = pattern.map((bar) => {
    const cells = trimBar(bar)
    return [...cells, ...Array<string>(Math.max(0, MIN_CELLS - cells.length)).fill('')]
  })

  function setCell(bar: number, cell: number, value: string) {
    const next = bars.map((cells) => [...cells])
    next[bar]![cell] = value
    onChange(next.map(trimBar).map((cells) => (cells.length ? cells : [''])))
  }

  return (
    <div className="flex flex-col gap-3">
      <Select
        label={label}
        value={preset >= 0 ? String(preset) : 'own'}
        onChange={(e) => e.target.value !== 'own' && onChange(presets[Number(e.target.value)]!.pattern)}
        options={[...presets.map((p, i) => ({ value: String(i), label: p.label })), ...(preset < 0 ? [{ value: 'own', label: t('cue.own') }] : [])]}
      />
      {bars.map((cells, b) => (
        <div key={b} className="flex flex-col gap-1">
          <span className="text-sm text-ink-muted">{bars.length - b === 1 ? t('cue.barBefore') : t('cue.barsBefore', { n: bars.length - b })}</span>
          <div className="flex flex-wrap gap-2">
            {cells.map((cell, c) => (
              <Button
                key={c}
                aria-label={t('cue.cellAria', { bar: b + 1, beat: c + 1, value: cellLabel(cell, c + 1) })}
                onClick={() => setEditing({ bar: b, cell: c })}
                className="min-w-16 flex-1 basis-0 truncate"
              >
                <span className={cell.trim() ? 'text-ink' : 'text-ink-faint'}>{cellLabel(cell, c + 1)}</span>
              </Button>
            ))}
            {cells.length < MAX_CELLS && (
              <Button variant="quiet" className="shrink-0" aria-label={t('cue.addBeat', { bar: b + 1 })} onClick={() => setCell(b, cells.length, '')}>
                +
              </Button>
            )}
          </div>
        </div>
      ))}
      {bars.length === 1 ? (
        <AddRow label={t('cue.addBar')} onClick={() => onChange([['', '', '', ''], ...pattern])} />
      ) : (
        <Button variant="quiet" className="self-start" onClick={() => onChange(pattern.slice(1))}>
          {t('cue.removeBar')}
        </Button>
      )}
      {editing && (
        <CellDialog
          beat={editing.cell + 1}
          value={bars[editing.bar]![editing.cell] ?? ''}
          onPick={(value) => {
            setCell(editing.bar, editing.cell, value)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function CellDialog({ beat, value, onPick, onClose }: { beat: number; value: string; onPick: (value: string) => void; onClose: () => void }) {
  const { t } = useTranslation('addons')
  const own = value.trim() !== '' && value !== CUE_NAME && value !== CUE_BEAT
  const [text, setText] = useState(own ? value : '')
  return (
    <Dialog title={t('cue.beat', { beat })} onClose={onClose} size="s">
      <div className="flex flex-col gap-3">
        <Button variant={value.trim() === '' ? 'primary' : 'secondary'} onClick={() => onPick('')}>
          {t('cue.none')}
        </Button>
        <Button variant={value === CUE_NAME ? 'primary' : 'secondary'} onClick={() => onPick(CUE_NAME)}>
          {t('cue.partName')}
        </Button>
        <Button variant={value === CUE_BEAT ? 'primary' : 'secondary'} onClick={() => onPick(CUE_BEAT)}>
          {t('cue.beatNumber', { beat })}
        </Button>
        <Field label={t('cue.ownWord')} value={text} maxLength={30} placeholder={t('cue.ownPlaceholder')} onChange={(e) => setText(e.target.value)} />
        <Button variant={own ? 'primary' : 'secondary'} disabled={text.trim() === ''} onClick={() => onPick(text.trim())}>
          {t('cue.takeWord')}
        </Button>
      </div>
    </Dialog>
  )
}

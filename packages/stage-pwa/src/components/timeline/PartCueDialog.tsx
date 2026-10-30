import { useState } from 'react'
import { CUE_BEAT, CUE_NAME, type CuePattern } from 'shared-types'
import { isSilentCue } from '../../lib/partCues'
import { COUNT_IN_CUE_PRESETS, CuePatternEditor, PART_CUE_PRESETS } from '../CuePatternEditor'
import { Button, Dialog, Segmented } from '../ui'
import { useTranslation } from 'react-i18next'

type Mode = 'band' | 'silent' | 'own'

/** "Chorus – – – | 1 2 3 4": a pattern in words, for the band's default shown beside the choice. */
export function describeCuePattern(pattern: CuePattern, name: string): string {
  return pattern.map((bar) => bar.map((cell, i) => (cell === CUE_NAME ? name : cell === CUE_BEAT ? String(i + 1) : cell.trim() || '–')).join(' ')).join(' | ')
}

/**
 * One part's announcement in the timeline (#63 step 2): the band's pattern (Standard), nothing
 * (Stumm) or a pattern of its own, edited with the same cells as the band settings. On the part
 * on bar 1 the band's pattern is the count-in pattern.
 */
export function PartCueDialog({
  name,
  own,
  bandPattern,
  countIn,
  onSave,
  onClose,
}: {
  /** The part's name as spoken (the band's text for it). */
  name: string
  own: CuePattern | null
  bandPattern: CuePattern
  countIn: boolean
  onSave: (pattern: CuePattern | null) => void
  onClose: () => void
}) {
  const { t } = useTranslation('editor')
  const [mode, setMode] = useState<Mode>(own === null ? 'band' : isSilentCue(own) ? 'silent' : 'own')
  const [draft, setDraft] = useState<CuePattern>(own && !isSilentCue(own) ? own : bandPattern)
  return (
    <Dialog
      title={t('pc.title', { name })}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" onClick={() => onSave(mode === 'band' ? null : mode === 'silent' ? [['']] : draft)}>
            {t('apply')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented
          label={t('pc.label')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'band', label: t('pc.standard') },
            { value: 'silent', label: t('pc.silent') },
            { value: 'own', label: t('pc.own') },
          ]}
        />
        {mode === 'band' && (
          <p className="text-base text-ink">
            {t('pc.likeAll')}
            <span className="font-semibold">{describeCuePattern(bandPattern, name)}</span>
            <span className="block text-sm text-ink-muted">{t('pc.where')}</span>
          </p>
        )}
        {mode === 'silent' && <p className="text-base text-ink">{t('pc.nothing')}</p>}
        {mode === 'own' && <CuePatternEditor label={t('pc.pattern')} pattern={draft} presets={countIn ? COUNT_IN_CUE_PRESETS : PART_CUE_PRESETS} onChange={setDraft} />}
        <p className="text-sm text-ink-muted">
          {countIn ? t('pc.countIn') : t('pc.onlyHere')}
        </p>
      </div>
    </Dialog>
  )
}

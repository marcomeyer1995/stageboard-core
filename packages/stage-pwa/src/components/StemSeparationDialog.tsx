import { useState } from 'react'
import type { StemModel } from 'shared-types'
import { Button, Dialog, Segmented, Switch } from './ui'
import { useTranslation } from 'react-i18next'

/**
 * "Spuren trennen" (#9): which stems the Stage-Server splits a track into. Standard = drums, bass,
 * vocals, rest; Erweitert = also guitar and keys. Two main guitars panned left and right can come
 * out as two stems - Demucs itself can't tell two guitars apart, their stereo side can.
 */
export function StemSeparationDialog({
  trackLabel,
  hasStems,
  onStart,
  onClose,
}: {
  trackLabel: string
  /** The track was separated before - a new separation replaces those stems. */
  hasStems: boolean
  onStart: (options: { model: StemModel; splitGuitar: boolean }) => void
  onClose: () => void
}) {
  const { t } = useTranslation('editor')
  const [model, setModel] = useState<StemModel>('standard')
  const [splitGuitar, setSplitGuitar] = useState(false)
  return (
    <Dialog
      title={t('sep.title', { name: trackLabel })}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" onClick={() => onStart({ model, splitGuitar: model === 'extended' && splitGuitar })}>
            {t('sep.go')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented
          label={t('sep.tracks')}
          showLabel
          value={model}
          onChange={setModel}
          options={[
            { value: 'standard', label: t('sep.standard') },
            { value: 'extended', label: t('sep.extended') },
          ]}
        />
        <p className="text-base text-ink">
          {model === 'standard' ? t('sep.standardHint') : t('sep.extendedHint')}
        </p>
        {model === 'extended' && (
          <Switch
            label={t('sep.splitGuitar')}
            info={t('sep.splitGuitarInfo')}
            checked={splitGuitar}
            onChange={setSplitGuitar}
          />
        )}
        <p className="text-sm text-ink-muted">
          {t('sep.runs')}
          {hasStems ? t('sep.replaces') : ''}
        </p>
      </div>
    </Dialog>
  )
}

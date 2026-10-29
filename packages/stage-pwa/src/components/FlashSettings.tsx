import { FLASH_SECONDS, useFlashPrefsStore, type FlashMode } from '../store/useFlashPrefsStore'
import { Button, Segmented, Stepper } from './ui'
import { showLocalFlash } from '../lib/flash'
import { useTranslation } from 'react-i18next'

const MODES: FlashMode[] = ['banner', 'fullscreen', 'off']

/** Per device: how Stage-Messenger messages and song alerts show (#26). */
export function FlashSettings() {
  const { t } = useTranslation('system')
  const mode = useFlashPrefsStore((state) => state.mode)
  const setMode = useFlashPrefsStore((state) => state.setMode)
  const seconds = useFlashPrefsStore((state) => state.seconds)
  const setSeconds = useFlashPrefsStore((state) => state.setSeconds)
  return (
    <div className="flex flex-col gap-2">
      <Segmented label={t('flash.show')} value={mode} onChange={setMode} options={MODES.map((option) => ({ value: option, label: t(`flash.${option}`) }))} />
      <p className="text-sm text-ink-faint">{t(`flash.${mode}Hint`, { seconds })}</p>
      {/* Shows a sample with the current look and duration - on this device only, nobody else
          gets it (Marco, 2026-10-07). */}
      {mode !== 'off' && (
        <Button icon="eye" onClick={() => showLocalFlash(t('flash.sample'))} className="self-start">
          {t('flash.preview')}
        </Button>
      )}
      {mode !== 'off' && (
        // − / + instead of a slider (Marco, 2026-10-16), like the text size.
        <Stepper label={t('flash.duration')} value={seconds} unit="s" min={FLASH_SECONDS.min} max={FLASH_SECONDS.max} onChange={setSeconds} />
      )}
    </div>
  )
}

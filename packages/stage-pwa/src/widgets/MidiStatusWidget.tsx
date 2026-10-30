import i18n from '../i18n'
import { useTranslation } from 'react-i18next'
import { useShowPart } from '../lib/widgetParts'
import { useMidiTrigger, type MidiStatus } from '../lib/useMidiTrigger'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type MidiStatusConfig } from './midiStatusConfig'
import { SizeRatioSlider } from './SizeRatioSlider'
import { stageFontSize } from '../lib/stageSize'

const STATUS_LABEL: Record<MidiStatus, string> = {
  get unsupported() {
    return i18n.t('widgets:midi.unsupported')
  },
  get 'no-device'() {
    return i18n.t('widgets:midi.noDevice')
  },
  get connected() {
    return i18n.t('widgets:midi.connected')
  },
}

const STATUS_DOT: Record<MidiStatus, string> = {
  unsupported: 'bg-control-strong-hover',
  'no-device': 'bg-control-strong-hover',
  connected: 'bg-ok',
}

/** Sized as a ratio of the device-wide default (System/Einstellungen), not auto-fit to the
 * tile (Marco, 2026-09-14). The button reuses the same computed size for visual consistency,
 * same as before. */
export function MidiStatusWidget({ config }: { config: MidiStatusConfig }) {
  const { t } = useTranslation('widgets')
  // Parts left out under "Anzeigen" in the ⋯ menu (Marco, 2026-10-17: declutter every widget).
  const showSimulate = useShowPart('simulate')
  const { status, jumpToNextSection } = useMidiTrigger()
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = stageFontSize(baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO))

  return (
    <div className="flex h-full items-center gap-3 text-ink-soft">
      <div className="flex h-full min-w-0 flex-1 items-center overflow-hidden">
        <span style={{ fontSize }} className="flex items-center gap-[0.4em] whitespace-nowrap">
          <span
            className={`inline-block flex-shrink-0 rounded-full ${STATUS_DOT[status]}`}
            style={{ width: '0.6em', height: '0.6em' }}
          />
          {STATUS_LABEL[status]}
        </span>
      </div>
      {showSimulate && (
      <button
        type="button"
        onClick={jumpToNextSection}
        style={{ fontSize }}
        className="min-h-form flex-shrink-0 whitespace-nowrap rounded-control bg-control-strong px-3 font-semibold text-ink [@media(hover:hover)]:hover:bg-control-strong-hover"
      >
        {t('midi.simulate')}
      </button>
      )}
    </div>
  )
}

export function MidiStatusConfigPanel({
  config,
  onChange,
}: {
  config: MidiStatusConfig
  onChange: (next: MidiStatusConfig) => void
}) {
  const { t } = useTranslation('widgets')
  return (
    <SizeRatioSlider
      label={t('w.size')}
      ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
      onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
    />
  )
}

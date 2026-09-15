import { useMidiTrigger, type MidiStatus } from '../lib/useMidiTrigger'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type MidiStatusConfig } from './midiStatusConfig'
import { SizeRatioSlider } from './SizeRatioSlider'

const STATUS_LABEL: Record<MidiStatus, string> = {
  unsupported: 'Kein WebMIDI',
  'no-device': 'Kein Fußtaster',
  connected: 'Fußtaster verbunden',
}

const STATUS_DOT: Record<MidiStatus, string> = {
  unsupported: 'bg-control-strong-hover',
  'no-device': 'bg-control-strong-hover',
  connected: 'bg-green-500',
}

/** Sized as a ratio of the device-wide default (System/Einstellungen), not auto-fit to the
 * tile (Marco, 2026-09-14). The button reuses the same computed size for visual consistency,
 * same as before. */
export function MidiStatusWidget({ config }: { config: MidiStatusConfig }) {
  const { status, jumpToNextSection } = useMidiTrigger()
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO)

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
      <button
        type="button"
        onClick={jumpToNextSection}
        style={{ fontSize }}
        className="flex-shrink-0 whitespace-nowrap rounded-sb-sm bg-control-strong px-3 py-1 font-medium text-ink hover:bg-control-strong-hover"
      >
        Fußtaster simulieren
      </button>
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
  return (
    <SizeRatioSlider
      label="Größe"
      ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
      onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
    />
  )
}

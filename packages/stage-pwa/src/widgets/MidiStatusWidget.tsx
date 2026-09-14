import { useAutoFitFontSize } from '../lib/useAutoFitFontSize'
import { useMidiTrigger, type MidiStatus } from '../lib/useMidiTrigger'

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

export function MidiStatusWidget() {
  const { status, jumpToNextSection } = useMidiTrigger()
  // Chosen over cq units/discrete tiers after Marco compared all three live (2026-09-14,
  // see the widget-font-autofit memory). The button reuses the same computed size for
  // visual consistency, same as ShowTransportWidget's shared button font size.
  const [containerRef, textRef, fontSize] = useAutoFitFontSize<HTMLDivElement, HTMLSpanElement>(
    { min: 10, max: 48 },
    [status],
  )

  return (
    <div className="flex h-full items-center gap-3 text-ink-soft">
      <div ref={containerRef} className="flex h-full min-w-0 flex-1 items-center overflow-hidden">
        <span ref={textRef} style={{ fontSize }} className="flex items-center gap-[0.4em] whitespace-nowrap">
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

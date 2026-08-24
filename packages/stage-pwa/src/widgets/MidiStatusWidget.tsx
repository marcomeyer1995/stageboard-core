import { useMidiTrigger, type MidiStatus } from '../lib/useMidiTrigger'

const STATUS_LABEL: Record<MidiStatus, string> = {
  unsupported: 'Kein WebMIDI',
  'no-device': 'Kein Fußtaster',
  connected: 'Fußtaster verbunden',
}

const STATUS_DOT: Record<MidiStatus, string> = {
  unsupported: 'bg-neutral-600',
  'no-device': 'bg-neutral-600',
  connected: 'bg-green-500',
}

export function MidiStatusWidget() {
  const { status, jumpToNextSection } = useMidiTrigger()

  return (
    <div className="flex items-center gap-3 rounded-lg bg-neutral-900 px-4 py-3 text-sm text-neutral-300">
      <span className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
        {STATUS_LABEL[status]}
      </span>
      <button
        type="button"
        onClick={jumpToNextSection}
        className="rounded bg-neutral-700 px-3 py-1 font-medium text-white hover:bg-neutral-600"
      >
        Fußtaster simulieren
      </button>
    </div>
  )
}

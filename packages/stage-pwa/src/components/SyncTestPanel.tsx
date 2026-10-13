import { useEffect, useState } from 'react'
import { Button, Select, Switch } from './ui'
import { getDeviceId } from '../lib/deviceId'
import { getSyncTestStatus, startSyncTest, stopSyncTest } from '../lib/syncTest'
import { listMidiOutputs } from '../lib/webMidiOutput'

const DURATION_S = 60

/** A per-device default channel, so two devices started with defaults rarely collide. */
function defaultChannel(): number {
  let hash = 0
  for (const char of getDeviceId()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % 16
}

/**
 * Sync test (docs/21 §4): marks every full second of server time with a MIDI note and/or the real
 * click, on every device started at once - a laptop logs it against the Stage-Server's clock
 * (scripts/midi-timing-probe/sync-receiver.py).
 */
export function SyncTestPanel() {
  const [outputs, setOutputs] = useState<{ id: string; name: string }[]>([])
  const [outputId, setOutputId] = useState('')
  const [channel, setChannel] = useState(defaultChannel)
  const [click, setClick] = useState(false)
  const [, rerender] = useState(0)

  useEffect(() => {
    void listMidiOutputs().then((list) => {
      setOutputs(list)
      if (list[0]) setOutputId((current) => current || list[0].id)
    })
    const timer = setInterval(() => rerender((n) => n + 1), 500)
    return () => clearInterval(timer)
  }, [])

  const status = getSyncTestStatus()

  return (
    <section className="flex flex-col gap-3 rounded-container border border-line bg-surface p-4" aria-label="Synchron-Test">
      <h3 className="text-base font-bold text-ink">Synchron-Test</h3>
      <p className="text-sm text-ink-muted">
        Markiert {DURATION_S} s lang jede volle Sekunde der Server-Zeit - mit einer MIDI-Note und/oder dem echten Klick. Auf allen Geräten gleichzeitig starten; ein
        Laptop am Stage-Server misst den Versatz.
      </p>
      <Select
        label="MIDI-Ausgang"
        value={outputId}
        onChange={(e) => setOutputId(e.target.value)}
        options={[{ value: '', label: '- keiner (nur Klick) -' }, ...outputs.map((o) => ({ value: o.id, label: o.name }))]}
      />
      <Select
        label="MIDI-Kanal (je Gerät ein anderer)"
        value={String(channel)}
        onChange={(e) => setChannel(Number(e.target.value))}
        options={Array.from({ length: 16 }, (_, i) => ({ value: String(i), label: String(i + 1) }))}
      />
      <Switch label="Klick hörbar (Lautstärke vorher prüfen)" checked={click} onChange={setClick} />
      <div className="flex flex-wrap items-center gap-3">
        {status.running ? (
          <Button onClick={() => { stopSyncTest(); rerender((n) => n + 1) }}>Stoppen</Button>
        ) : (
          <Button
            variant="primary"
            disabled={!outputId && !click}
            onClick={() => void startSyncTest({ outputId: outputId || null, channel, click, durationS: DURATION_S }).then(() => rerender((n) => n + 1))}
          >
            Starten
          </Button>
        )}
        <span role="status" className="text-base text-ink">
          {status.running ? `Läuft - ${status.marked} Sekunden markiert` : status.marked > 0 ? `Fertig - ${status.marked} Sekunden markiert` : ''}
        </span>
      </div>
    </section>
  )
}

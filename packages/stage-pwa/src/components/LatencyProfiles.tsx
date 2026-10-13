import { useState } from 'react'
import { AUDIO_OUTPUT, SERVER_EXECUTION_TARGET, latencyProfileId, type AudioRoute, type LatencyProfileDoc } from 'shared-types'
import { getDeviceId } from '../lib/deviceId'
import { useAudioRouteStore } from '../store/useAudioRouteStore'
import { useLatencyProfilesStore } from '../store/useLatencyProfilesStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { ROUTE_LABEL } from '../lib/latencyProfiles'
import { Button, Dialog, Field, Select } from './ui'


const SOURCE_LABEL: Record<LatencyProfileDoc['source'], string> = { measured: 'gemessen', manual: 'von Hand', 'plugin-default': 'Plugin' }

function useOutputName(): (output: string) => string {
  const logicalDevices = useLogicalDevicesStore((state) => state.devices)
  return (output) => (output === AUDIO_OUTPUT ? 'Ton' : (logicalDevices.find((d) => d.id === output)?.name ?? 'Gelöschtes Gerät'))
}

function profileLabel(profile: LatencyProfileDoc, outputName: (output: string) => string): string {
  const where = profile.route ? `${outputName(profile.output)} · ${ROUTE_LABEL[profile.route]}` : outputName(profile.output)
  return `${where} ${Math.round(profile.latencyMs)} ms (${SOURCE_LABEL[profile.source]})`
}

/** One line per device in the Geräte tab: its stored latencies (docs/21 §3, #491). Nothing when none. */
export function LatencySummary({ deviceId }: { deviceId: string }) {
  const profiles = useLatencyProfilesStore((state) => state.profiles).filter((p) => p.deviceId === deviceId)
  const outputName = useOutputName()
  if (profiles.length === 0) return null
  return <p className="mt-2 text-sm text-ink-soft">Latenz: {profiles.map((p) => profileLabel(p, outputName)).join(' · ')}</p>
}

/**
 * Enter or remove latencies for one device (or the Stage-Server) by hand - values from a
 * measurement (docs/21 §8.4) until automatic calibration exists. Audio is per route; every other
 * output is a Logical Device this device drives.
 */
export function LatencyProfileDialog({ deviceId, deviceName, onClose }: { deviceId: string; deviceName: string; onClose: () => void }) {
  const profiles = useLatencyProfilesStore((state) => state.profiles).filter((p) => p.deviceId === deviceId)
  const save = useLatencyProfilesStore((state) => state.save)
  const remove = useLatencyProfilesStore((state) => state.remove)
  const logicalDevices = useLogicalDevicesStore((state) => state.devices)
  const currentRoute = useAudioRouteStore((state) => state.route)
  const outputName = useOutputName()

  const isServer = deviceId === SERVER_EXECUTION_TARGET
  const driven = logicalDevices.filter((d) => (isServer ? d.executionTarget === SERVER_EXECUTION_TARGET : d.executionTarget === deviceId))
  const outputs = [...(isServer ? [] : [{ value: AUDIO_OUTPUT, label: 'Ton (Klick und Backing-Track)' }]), ...driven.map((d) => ({ value: d.id, label: d.name }))]

  const [output, setOutput] = useState(outputs[0]?.value ?? '')
  const [route, setRoute] = useState<AudioRoute>(deviceId === getDeviceId() ? currentRoute : 'speaker')
  const [value, setValue] = useState('')
  const latencyMs = Number(value.replace(',', '.'))
  const valid = value.trim() !== '' && Number.isFinite(latencyMs) && latencyMs >= 0 && latencyMs <= 2000

  async function add() {
    if (!valid || !output) return
    const profileRoute = output === AUDIO_OUTPUT ? route : null
    await save({
      id: latencyProfileId(deviceId, output, profileRoute),
      deviceId,
      output,
      route: profileRoute,
      latencyMs: Math.round(latencyMs),
      source: 'manual',
      measuredAt: Date.now(),
    })
    setValue('')
  }

  return (
    <Dialog title={`Latenz - ${deviceName}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">
          Wie viel später als geplant ein Ausgang wirklich klingt oder schaltet. Das Gerät sendet um diesen Wert früher, damit alles auf dem Schlag ankommt. Ton gilt je
          Ausgabeweg (Lautsprecher, Kopfhörer, Bluetooth, USB).
        </p>
        {profiles.length > 0 && (
          <ul className="flex flex-col gap-2">
            {profiles.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 rounded-container border border-line px-3 py-2">
                <span className="text-base text-ink">{profileLabel(p, outputName)}</span>
                <Button variant="quiet" onClick={() => void remove(p.id)}>
                  Entfernen
                </Button>
              </li>
            ))}
          </ul>
        )}
        {outputs.length === 0 ? (
          <p className="text-base text-ink-faint">Dieses Gerät steuert keinen Ausgang.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <Select label="Ausgang" value={output} onChange={(e) => setOutput(e.target.value)} options={outputs} />
            {output === AUDIO_OUTPUT && (
              <Select
                label="Ausgabeweg"
                value={route}
                onChange={(e) => setRoute(e.target.value as AudioRoute)}
                options={(Object.keys(ROUTE_LABEL) as AudioRoute[]).map((r) => ({ value: r, label: ROUTE_LABEL[r] }))}
              />
            )}
            <Field label="Latenz in ms" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="z. B. 70" />
            <Button variant="primary" disabled={!valid} onClick={() => void add()} className="self-start">
              Speichern
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  )
}

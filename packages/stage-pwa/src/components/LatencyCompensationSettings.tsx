import { getDeviceId } from '../lib/deviceId'
import { useAudioCompensationStore } from '../lib/latencyCompensation'
import { audioOutputLatencyMs, ROUTE_LABEL } from '../lib/latencyProfiles'
import { useAudioRouteStore } from '../store/useAudioRouteStore'
import { useLatencyProfilesStore } from '../store/useLatencyProfilesStore'
import { Switch } from './ui'

/** Per device (#491): start click and backing track earlier by the stored latency of the current
 * output route, so they are heard on the beat. Values come from the Geräte tab ("Latenz…"). */
export function LatencyCompensationSettings() {
  const on = useAudioCompensationStore((state) => state.on)
  const set = useAudioCompensationStore((state) => state.set)
  const route = useAudioRouteStore((state) => state.route)
  const profiles = useLatencyProfilesStore((state) => state.profiles)
  const stored = audioOutputLatencyMs(profiles, getDeviceId(), route, true)
  const status = stored > 0 ? `${stored} ms für ${ROUTE_LABEL[route]}` : `kein Wert für ${ROUTE_LABEL[route]} - im Tab Geräte unter „Latenz…“ eintragen`
  return (
    <Switch
      label="Ton-Latenz ausgleichen"
      description={`Klick und Backing-Track starten um die gemessene Latenz dieses Ausgabewegs früher, damit sie auf dem Schlag klingen. Jetzt: ${status}.`}
      checked={on}
      onChange={set}
    />
  )
}

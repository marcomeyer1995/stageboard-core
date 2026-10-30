import { getDeviceId } from '../lib/deviceId'
import { useAudioCompensationStore } from '../lib/latencyCompensation'
import { audioOutputLatencyMs, routeLabel } from '../lib/latencyProfiles'
import { useAudioRouteStore } from '../store/useAudioRouteStore'
import { useLatencyProfilesStore } from '../store/useLatencyProfilesStore'
import { Switch } from './ui'
import { useTranslation } from 'react-i18next'

/** Per device (#491): start click and backing track earlier by the stored latency of the current
 * output route, so they are heard on the beat. Sits in this device's "Latenz…" dialog (Tablets & Handys),
 * above the values it uses. */
export function LatencyCompensationSettings() {
  const { t } = useTranslation('devices')
  const on = useAudioCompensationStore((state) => state.on)
  const set = useAudioCompensationStore((state) => state.set)
  const route = useAudioRouteStore((state) => state.route)
  const profiles = useLatencyProfilesStore((state) => state.profiles)
  const stored = audioOutputLatencyMs(profiles, getDeviceId(), route, true)
  const status = stored > 0 ? t('comp.stored', { ms: stored, route: routeLabel(route) }) : t('comp.none', { route: routeLabel(route) })
  return (
    <Switch
      label={t('comp.label')}
      description={t('comp.now', { status })}
      info={t('comp.info')}
      checked={on}
      onChange={set}
    />
  )
}

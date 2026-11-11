import { useEffect, useMemo, useState } from 'react'
import type { SignalFlow, StageEquipment, StageSetup } from 'shared-types'
import { useDeviceInfoStore } from '../store/useDeviceInfoStore'
import { useLatencyProfilesStore } from '../store/useLatencyProfilesStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useStageMapStore } from '../store/useStageMapStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { useOutputPlanStore } from './audioMix'
import { getServerTime } from './clockSync'
import { getDeviceId } from './deviceId'
import { silencedSources } from './outputPlan'
import { stageLive, type StageLive } from './stageLive'
import { knownMidiOutputNames, watchMidiPorts } from './webMidiOutput'

/** How often "now" moves on: a report going stale (a tablet in flight mode) shows without a new
 * answer from anywhere. */
const TICK_MS = 2_000

export interface StageLiveMap {
  equipment: readonly StageEquipment[]
  setup: StageSetup | undefined
  flows: readonly SignalFlow[]
  outputs: readonly { id: string; name: string; pluginId: string | null }[]
  builtInIds: readonly string[]
}

/**
 * The map's live layer (#747) while "Prüfen" is on: polls the devices' reports (as the Geräte
 * list does, only while open), listens to this device's own MIDI ports, and recomputes. Null
 * while off, or before the first answer.
 */
export function useStageLive(active: boolean, map: StageLiveMap): StageLive | null {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const deviceInfo = useDeviceInfoStore((state) => state.deviceInfo)
  const loaded = useDeviceInfoStore((state) => state.loaded)
  const reachable = useDeviceInfoStore((state) => state.reachable)
  const health = usePluginsStore((state) => state.health)
  const front = useStageMapStore((state) => state.front)
  const profiles = useLatencyProfilesStore((state) => state.profiles)
  const plan = useOutputPlanStore((state) => state.plan)
  const [now, setNow] = useState(() => getServerTime())
  const [ownMidi, setOwnMidi] = useState<string[] | null>(null)

  useEffect(() => {
    if (!active || !workspaceId) return
    void useDeviceInfoStore.getState().init(workspaceId)
    return () => useDeviceInfoStore.getState().stop()
  }, [active, workspaceId])

  useEffect(() => {
    if (!active) return
    let stopped = false
    const read = () => void knownMidiOutputNames().then((names) => !stopped && setOwnMidi(names))
    read()
    const stopWatching = watchMidiPorts(read)
    const tick = setInterval(() => setNow(getServerTime()), TICK_MS)
    return () => {
      stopped = true
      stopWatching()
      clearInterval(tick)
    }
  }, [active])

  const { equipment, setup, flows, outputs, builtInIds } = map
  return useMemo(() => {
    if (!active || !setup || (!loaded && reachable === null)) return null
    return stageLive({ equipment, setup, flows, outputs, builtInIds, deviceInfo, now, serverReachable: reachable, health, ownDeviceId: getDeviceId(), ownMidiOutputs: ownMidi, ownSilenced: silencedSources(plan), front, profiles })
  }, [active, setup, loaded, reachable, equipment, flows, outputs, builtInIds, deviceInfo, now, health, ownMidi, plan, front, profiles])
}

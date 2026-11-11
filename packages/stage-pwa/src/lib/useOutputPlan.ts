import { useEffect } from 'react'
import { useOutputPlanStore } from './audioMix'
import { outputPlan, usePracticeOutputStore } from './outputPlan'
import { useAppModeStore } from '../store/useAppModeStore'
import { useAudioRouteStore } from '../store/useAudioRouteStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useStageMapStore } from '../store/useStageMapStore'

/** Keeps the output plan in step with mode, map, front app and Android's output route. */
export function useOutputPlan(): void {
  const mode = useAppModeStore((state) => state.mode)
  const deviceId = useShowStateStore((state) => state.deviceId)
  const loaded = useStageMapStore((state) => state.loaded)
  const equipment = useStageMapStore((state) => state.equipment)
  const setups = useStageMapStore((state) => state.setups)
  const front = useStageMapStore((state) => state.front)
  const route = useAudioRouteStore((state) => state.route)
  const practiceSetupId = usePracticeOutputStore((state) => state.setupId)
  useEffect(() => {
    const { plan, fellBack } = outputPlan({ mode, map: loaded ? { equipment, setups } : null, deviceId, front, route, practiceSetupId })
    useOutputPlanStore.getState().setPlan(plan, fellBack)
  }, [mode, deviceId, loaded, equipment, setups, front, route, practiceSetupId])
}

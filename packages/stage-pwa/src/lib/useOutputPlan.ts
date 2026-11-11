import { useEffect } from 'react'
import { equipmentOffered } from 'shared-types'
import { useOutputPlanStore } from './audioMix'
import { outputPlan, usePracticeOutputStore } from './outputPlan'
import { useActiveProfileStore } from '../store/useActiveProfileStore'
import { useAppModeStore } from '../store/useAppModeStore'
import { useAudioRouteStore } from '../store/useAudioRouteStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useStageMapStore } from '../store/useStageMapStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/** Keeps the output plan in step with mode, map, front app and Android's output route. */
export function useOutputPlan(): void {
  const mode = useAppModeStore((state) => state.mode)
  const deviceId = useShowStateStore((state) => state.deviceId)
  const loaded = useStageMapStore((state) => state.loaded)
  const equipment = useStageMapStore((state) => state.equipment)
  const setups = useStageMapStore((state) => state.setups)
  const ownSetups = useStageMapStore((state) => state.ownSetups)
  const ownEquipment = useStageMapStore((state) => state.ownEquipment)
  const front = useStageMapStore((state) => state.front)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const profileId = useActiveProfileStore((state) => state.byWorkspace[workspaceId] ?? '')
  const route = useAudioRouteStore((state) => state.route)
  const practiceSetupId = usePracticeOutputStore((state) => state.setupId)
  useEffect(() => {
    // The Gig goes by the band's map alone; practising may go by one of this person's own setups (#799).
    const mine = mode === 'practice' && profileId !== '' ? ownSetups.filter((s) => s.owner === profileId) : []
    const map = loaded ? { equipment: [...equipment, ...equipmentOffered(ownEquipment, { owner: profileId || undefined })], setups: [...setups, ...mine] } : null
    const { plan, fellBack } = outputPlan({ mode, map, deviceId, front, route, practiceSetupId })
    useOutputPlanStore.getState().setPlan(plan, fellBack)
  }, [mode, deviceId, loaded, equipment, setups, ownSetups, ownEquipment, profileId, front, route, practiceSetupId])
}

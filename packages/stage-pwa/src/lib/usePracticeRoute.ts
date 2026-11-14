import { useMemo } from 'react'
import { routedLogicalDevices, type LogicalDevice } from 'shared-types'
import { usePracticeRouteStore } from './outputPlan'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'

/**
 * The plugin devices as the practice setup routes them (#799 step 4): one executes here when this
 * device's matrix there puts it on one of its ports, everything else nowhere - at home there is no
 * band rig to send to. Null in the Gig and while practising without a setup.
 */
export function usePracticeDevices(): LogicalDevice[] | null {
  const route = usePracticeRouteStore((state) => state.route)
  const stored = useLogicalDevicesStore((state) => state.stored)
  return useMemo(() => (route ? routedLogicalDevices(stored, route.map, {}, route.setupId) : null), [route, stored])
}

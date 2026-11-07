import { useEffect } from 'react'
import { appsOf } from 'shared-types'
import { getDeviceId } from './deviceId'
import { useStageMapStore } from '../store/useStageMapStore'

/**
 * Several apps on one device (the release app, the Dev app, Chrome - Marco, 2026-11-07): the one
 * that comes to the front says so, and only it plays (mapPlays). Written only when this app shares
 * its device box with another and isn't already the one in front.
 */
export function useFrontAppClaim(): void {
  const own = getDeviceId()
  const box = useStageMapStore((state) => state.equipment.find((e) => e.kind === 'stageboard' && appsOf(e).includes(own)))
  const front = useStageMapStore((state) => (box ? state.front[box.id] : undefined))
  const claimFront = useStageMapStore((state) => state.claimFront)
  const shared = box !== undefined && appsOf(box).length > 1
  useEffect(() => {
    if (!box || !shared) return
    const claim = () => {
      if (document.visibilityState === 'visible' && useStageMapStore.getState().front[box.id] !== own) void claimFront(box.id, own)
    }
    claim()
    document.addEventListener('visibilitychange', claim)
    return () => document.removeEventListener('visibilitychange', claim)
  }, [box, shared, front, own, claimFront])
}

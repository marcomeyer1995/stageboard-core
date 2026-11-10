import { useEffect, useState } from 'react'
import { fetchHostCapabilities } from './fetchHostCapabilities'
import { getDeviceId } from './deviceId'
import { findHelper, type HelperInfo } from './nativeHelper'
import { activeDeviceJobs, leftoverDeviceJobs, YOUTUBE_ADDON_ID, youtubeRoute, type YoutubeRoute } from './youtubeDevice'
import { putAsyncJob } from './asyncJobsDb'
import { useAsyncJobsStore } from '../store/useAsyncJobsStore'

let leftoversCleared = false

/**
 * Where YouTube runs for this device right now (youtubeDevice.ts): asked when `wanted` turns on
 * (the add-track dialog opens) - the host's capabilities and this device's helper can change
 * between two openings. `null` while asking.
 */
export function useYoutubeRoute(wanted: boolean): { route: YoutubeRoute | null; helper: HelperInfo | null } {
  const [state, setState] = useState<{ route: YoutubeRoute | null; helper: HelperInfo | null }>({ route: null, helper: null })
  useEffect(() => {
    if (!wanted) return
    let cancelled = false
    void Promise.all([fetchHostCapabilities(), findHelper(YOUTUBE_ADDON_ID)]).then(([host, helper]) => {
      if (!cancelled) setState({ route: youtubeRoute(host, helper), helper })
    })
    // Once per app session: what this device was running when it last stopped, nothing finishes.
    if (!leftoversCleared) {
      leftoversCleared = true
      for (const job of leftoverDeviceJobs(useAsyncJobsStore.getState().jobs, getDeviceId(), activeDeviceJobs)) {
        void putAsyncJob({ ...job, status: 'error', error: 'interrupted', errorCode: 'youtube.interrupted', updatedAt: Date.now() }).catch(() => {})
      }
    }
    return () => {
      cancelled = true
    }
  }, [wanted])
  return state
}

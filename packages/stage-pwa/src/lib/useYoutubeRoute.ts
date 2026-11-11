import { useEffect, useState } from 'react'
import { androidHelperCerts } from 'shared-types'
import { fetchHostCapabilities } from './fetchHostCapabilities'
import { getDeviceId } from './deviceId'
import { findHelper, type HelperInfo } from './nativeHelper'
import { activeDeviceJobs, leftoverDeviceJobs, YOUTUBE_ADDON_ID, youtubeRoute, type YoutubeRoute } from './youtubeDevice'
import { putAsyncJob } from './asyncJobsDb'
import { useAsyncJobsStore } from '../store/useAsyncJobsStore'
import { usePluginsStore } from '../store/usePluginsStore'

let leftoversCleared = false

/**
 * Where YouTube runs for this device right now (youtubeDevice.ts): asked when `wanted` turns on
 * (the add-track dialog opens) - the host's capabilities and this device's helper can change
 * between two openings. `null` while asking.
 */
export function useYoutubeRoute(wanted: boolean): { route: YoutubeRoute | null; helper: HelperInfo | null; trusted: readonly string[] } {
  const [state, setState] = useState<{ route: YoutubeRoute | null; helper: HelperInfo | null }>({ route: null, helper: null })
  // The helpers this band's installed add-on trusts (its manifest, #756) - no add-on, no helper.
  const manifest = usePluginsStore((s) => s.installed.find((plugin) => plugin.id === YOUTUBE_ADDON_ID && plugin.enabled))
  const trusted = manifest ? androidHelperCerts(manifest) : NO_CERTS
  useEffect(() => {
    if (!wanted) return
    let cancelled = false
    void Promise.all([fetchHostCapabilities(), findHelper(YOUTUBE_ADDON_ID)]).then(([host, helper]) => {
      if (!cancelled) setState({ route: youtubeRoute(host, helper, trusted), helper })
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
  }, [wanted, trusted])
  return { ...state, trusted }
}

const NO_CERTS: readonly string[] = []

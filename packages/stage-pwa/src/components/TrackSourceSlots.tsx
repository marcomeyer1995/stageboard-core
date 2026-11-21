import { useEffect, useMemo } from 'react'
import type { SlotId } from 'shared-types'
import { addonsForSlot, type BuiltinAddon } from '../lib/addonUi/builtinAddons'
import { putAsyncJob } from '../lib/asyncJobsDb'
import { useAsyncJobsStore } from '../store/useAsyncJobsStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { activeDeviceJobs, leftoverDeviceJobs } from '../lib/deviceJobs'
import { getDeviceId } from '../lib/deviceId'
import { Button } from './ui'

const SLOT: SlotId = 'song-editor.track-source'
let leftoversCleared = false

/** The entries of add-ons that declared the `song-editor.track-source` slot (docs/36 §6, #964). Opening one leaves this dialog to the add-on's own. */
export function TrackSourceSlots({ query, onOpen }: { query: string; onOpen: (addon: BuiltinAddon, query: string) => void }) {
  const installed = usePluginsStore((s) => s.installed)
  const entries = useMemo(() => addonsForSlot(SLOT, installed.filter((p) => p.enabled).map((p) => p.id)), [installed])

  // Once per app session: a job this device was running when it last stopped will not finish - the band sees it end instead of run for ever.
  useEffect(() => {
    if (leftoversCleared) return
    leftoversCleared = true
    for (const job of leftoverDeviceJobs(useAsyncJobsStore.getState().jobs, getDeviceId(), activeDeviceJobs).filter((j) => j.type === 'audio-import')) {
      void putAsyncJob({ ...job, status: 'error', error: 'interrupted', errorCode: 'job.interrupted', updatedAt: Date.now() }).catch(() => {})
    }
  }, [])
  if (entries.length === 0) return null
  return (
    <>
      {/* The initial search text comes from the song's title and band - handed to the add-on by TrackManagerField's dialog context. */}
      {entries.map(({ addon, entry }) => (
        <Button key={`${addon.id}:${entry.id}`} variant="secondary" fullWidth onClick={() => onOpen(addon, query)}>
          {entry.title}
        </Button>
      ))}
    </>
  )
}

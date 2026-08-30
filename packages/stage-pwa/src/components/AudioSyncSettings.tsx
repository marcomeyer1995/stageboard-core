import { useEffect, useState } from 'react'
import {
  getCatalogSizeBytes,
  getStorageEstimate,
  isFullSyncSafe,
  SAFE_QUOTA_FRACTION,
  type StorageEstimate,
} from '../lib/audioStorageManager'
import { useAudioSyncStore, type AudioSyncMode } from '../store/useAudioSyncStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

const MODE_LABEL: Record<AudioSyncMode, string> = {
  none: 'Keine',
  selective: 'Selektiv',
  full: 'Komplett',
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
}

/**
 * The "Storage & Sync" settings for #49: which audio-caching strategy this device uses for
 * the active band, and a glanceable quota readout. "Komplett" disables itself once the
 * catalog no longer safely fits (see audioStorageManager.ts's SAFE_QUOTA_FRACTION) - the
 * reconciliation itself (fetch/evict on mode change) runs from useAudioSyncReconciler, not
 * from here; this component only reads and writes the chosen mode.
 */
export function AudioSyncSettings() {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const mode = useAudioSyncStore((state) => state.modeFor(workspaceId))
  const setMode = useAudioSyncStore((state) => state.setMode)
  const variants = useSongVariantsStore((state) => state.variants)
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null)

  useEffect(() => {
    void getStorageEstimate().then(setEstimate)
  }, [])

  const catalogSizeBytes = getCatalogSizeBytes(variants)
  const fullIsSafe = isFullSyncSafe(catalogSizeBytes, estimate)

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-soft">
        {estimate
          ? `${formatMb(estimate.usageBytes)} von ${formatMb(estimate.quotaBytes)} genutzt`
          : 'Speicherbelegung unbekannt'}
        {' · '}
        Katalog: {formatMb(catalogSizeBytes)}
      </p>

      <div className="flex gap-2">
        {(['none', 'selective', 'full'] as const).map((candidate) => {
          const disabled = candidate === 'full' && !fullIsSafe
          return (
            <button
              key={candidate}
              type="button"
              disabled={disabled}
              onClick={() => setMode(workspaceId, candidate)}
              title={
                disabled
                  ? `Katalog zu groß für "Komplett" (mehr als ${Math.round(SAFE_QUOTA_FRACTION * 100)}% des verfügbaren Speichers)`
                  : undefined
              }
              className={`h-10 flex-1 rounded-sb-pill text-sm font-medium disabled:opacity-40 ${
                mode === candidate
                  ? 'bg-accent text-accent-ink'
                  : 'bg-control text-ink-soft hover:bg-control-hover'
              }`}
            >
              {MODE_LABEL[candidate]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

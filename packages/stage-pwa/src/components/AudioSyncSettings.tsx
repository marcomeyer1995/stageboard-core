import { useEffect, useState } from 'react'
import {
  getCatalogSizeBytes,
  getStemCatalogSizeBytes,
  getStorageEstimate,
  isFullSyncSafe,
  SAFE_QUOTA_FRACTION,
  type StorageEstimate,
} from '../lib/audioStorageManager'
import { useAudioSyncStore, type AudioSyncMode } from '../store/useAudioSyncStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { Segmented } from './ui'

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
  const stemMode = useAudioSyncStore((state) => state.stemModeFor(workspaceId))
  const setStemMode = useAudioSyncStore((state) => state.setStemMode)
  const variants = useSongVariantsStore((state) => state.variants)
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null)

  useEffect(() => {
    void getStorageEstimate().then(setEstimate)
  }, [])

  const catalogSizeBytes = getCatalogSizeBytes(variants)
  const fullIsSafe = isFullSyncSafe(catalogSizeBytes, estimate)
  const stemCatalogSizeBytes = getStemCatalogSizeBytes(variants)
  // Both together must fit, not each on its own.
  const stemsFullIsSafe = isFullSyncSafe(stemCatalogSizeBytes + (mode === 'full' ? catalogSizeBytes : 0), estimate)

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-soft">
        {estimate
          ? `${formatMb(estimate.usageBytes)} von ${formatMb(estimate.quotaBytes)} genutzt`
          : 'Speicherbelegung unbekannt'}
        {' · '}
        Katalog: {formatMb(catalogSizeBytes)} · Stems: {formatMb(stemCatalogSizeBytes)}
      </p>

      <div className="flex gap-2">
        <Segmented
          label="Speicher & Sync"
          value={mode}
          onChange={(candidate) => setMode(workspaceId, candidate)}
          options={(['none', 'selective', 'full'] as const).map((candidate) => {
            const disabled = candidate === 'full' && !fullIsSafe
            return {
              value: candidate,
              label: MODE_LABEL[candidate],
              disabled,
              title: disabled ? `Katalog zu groß für "Komplett" (mehr als ${Math.round(SAFE_QUOTA_FRACTION * 100)}% des verfügbaren Speichers)` : undefined,
            }
          })}
        />
      </div>

      {/* Stems on their own (Marco, 2026-10-16): they are big, and not every device needs them. */}
      <Segmented
        label="Stems"
        showLabel
        hint={stemMode === 'none' ? 'Keine: nur die Stems, die gerade geübt werden - vom Stage-Server geladen.' : 'Selektiv: Stems der aktiven Setlist und angehefteter Songs. Komplett: alle.'}
        value={stemMode}
        onChange={(candidate) => setStemMode(workspaceId, candidate)}
        options={(['none', 'selective', 'full'] as const).map((candidate) => ({
          value: candidate,
          label: MODE_LABEL[candidate],
          disabled: candidate === 'full' && !stemsFullIsSafe,
        }))}
      />
    </div>
  )
}

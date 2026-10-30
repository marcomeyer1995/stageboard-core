import { useEffect, useState } from 'react'
import {
  getCatalogSizeBytes,
  getStemCatalogSizeBytes,
  getStorageEstimate,
  isFullSyncSafe,
  SAFE_QUOTA_FRACTION,
  type StorageEstimate,
} from '../lib/audioStorageManager'
import { useAudioSyncStore } from '../store/useAudioSyncStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { Segmented } from './ui'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation('system')
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
          ? t('sync.usage', { used: formatMb(estimate.usageBytes), quota: formatMb(estimate.quotaBytes) })
          : t('sync.usageUnknown')}
        {' · '}
        {t('sync.catalog', { catalog: formatMb(catalogSizeBytes), stems: formatMb(stemCatalogSizeBytes) })}
      </p>

      <div className="flex gap-2">
        <Segmented
          label={t('sync.label')}
          value={mode}
          onChange={(candidate) => setMode(workspaceId, candidate)}
          options={(['none', 'selective', 'full'] as const).map((candidate) => {
            const disabled = candidate === 'full' && !fullIsSafe
            return {
              value: candidate,
              label: t(`sync.${candidate}`),
              disabled,
              title: disabled ? t('sync.tooBig', { percent: Math.round(SAFE_QUOTA_FRACTION * 100) }) : undefined,
            }
          })}
        />
      </div>

      {/* Stems on their own (Marco, 2026-10-16): they are big, and not every device needs them. */}
      <Segmented
        label={t('sync.stems')}
        showLabel
        info={t('sync.stemsInfo')}
        value={stemMode}
        onChange={(candidate) => setStemMode(workspaceId, candidate)}
        options={(['none', 'selective', 'full'] as const).map((candidate) => ({
          value: candidate,
          label: t(`sync.${candidate}`),
          disabled: candidate === 'full' && !stemsFullIsSafe,
        }))}
      />
    </div>
  )
}

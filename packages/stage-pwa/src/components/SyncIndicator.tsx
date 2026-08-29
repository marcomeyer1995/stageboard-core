import { deriveSyncProgress, deriveSyncStatus, useSyncStore, type SyncStatus } from '../store/useSyncStore'

const STATUS_TEXT: Record<SyncStatus, { icon: string; label: string }> = {
  idle: { icon: '✓', label: 'Synchronisiert' },
  syncing: { icon: '☁', label: 'Synchronisiere…' },
  offline: { icon: '⃠', label: 'Offline' },
  error: { icon: '⚠', label: 'Fehler' },
}

/**
 * Discreet by design (docs/07): a text row inside AppMenu, not a floating badge over the
 * live dashboard - see #33. Reflects the worst status across every live PouchDB<->CouchDB
 * stream (trackedSync.ts / useSyncStore.ts), not just one collection. The percentage is a
 * best-effort addition (#49 follow-up): CouchDB only reports it for pull batches, so it's
 * shown only once at least one stream has actually reported a number, never a fake 0%.
 */
export function SyncIndicator() {
  const status = useSyncStore((state) => deriveSyncStatus(state.streams))
  const progress = useSyncStore((state) => deriveSyncProgress(state.progress))
  const { icon, label } = STATUS_TEXT[status]
  const displayLabel = status === 'syncing' && progress !== null ? `${label} (${progress}%)` : label

  return (
    <div
      className="flex h-12 items-center gap-2 rounded-sb bg-control px-4 text-base text-ink-soft"
      title={displayLabel}
    >
      <span className={`text-lg leading-none ${status === 'syncing' ? 'animate-pulse' : ''}`}>{icon}</span>
      {displayLabel}
    </div>
  )
}

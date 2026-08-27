import { deriveSyncStatus, useSyncStore, type SyncStatus } from '../store/useSyncStore'

const STATUS_TEXT: Record<SyncStatus, { icon: string; label: string }> = {
  idle: { icon: '✓', label: 'Synchronisiert' },
  syncing: { icon: '☁', label: 'Synchronisiere…' },
  offline: { icon: '⃠', label: 'Offline' },
  error: { icon: '⚠', label: 'Fehler' },
}

/**
 * Discreet by design (docs/07): a text row inside AppMenu, not a floating badge over the
 * live dashboard - see #33. Reflects the worst status across every live PouchDB<->CouchDB
 * stream (trackedSync.ts / useSyncStore.ts), not just one collection.
 */
export function SyncIndicator() {
  const status = useSyncStore((state) => deriveSyncStatus(state.streams))
  const { icon, label } = STATUS_TEXT[status]

  return (
    <div
      className="flex h-12 items-center gap-2 rounded-sb bg-control px-4 text-base text-ink-soft"
      title={label}
    >
      <span className={`text-lg leading-none ${status === 'syncing' ? 'animate-pulse' : ''}`}>{icon}</span>
      {label}
    </div>
  )
}

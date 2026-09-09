import { getDeviceId } from '../lib/deviceId'
import { deriveSyncProgress, deriveSyncStatus, useSyncStore, type SyncStatus } from '../store/useSyncStore'
import { useDialogStore } from '../store/useDialogStore'
import { deriveOwnProfileId, useWorkspaceStore } from '../store/useWorkspaceStore'

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
 *
 * "Reparieren" (found live, 2026-09-09): a 401/403 is fatal to PouchDB's replication engine -
 * unlike a network drop, it never retries, so `error` here means genuinely dead, not just
 * temporarily stuck. The usual cause is this device's own cached CouchDB password going stale
 * (e.g. an admin resetting a PIN elsewhere reissues it) - previously the only fix was deleting
 * the whole band and rejoining. `joinAsMember` already handles "this workspace exists locally,
 * refresh its credentials" correctly (BandManagementView.tsx's own join path reuses it the same
 * way), so repairing in place just needs the access code and this device's own already-known
 * `ownProfileId` - no need to route through a full re-join/roster-picker flow.
 *
 * Found live, 2026-09-10, on Marco's own admin/founder device: an admin roster entry needs a
 * *second* 4-digit value beyond the access code itself (JoinBandView.tsx's own admin row -
 * either that person's self-assigned PIN, or the universal recovery code, which is just the
 * access code's own last 4 digits, per resolveOutcome's doc comment in core-backend/src/index.ts).
 * Without it the server 403s any admin repair with "Admin accounts require a code", which reads
 * exactly like a wrong access code even though it wasn't one. Since the user already typed the
 * full code once here, its last 4 digits double as that universal recovery password for free -
 * no second prompt needed, and it's simply ignored server-side for a non-admin profile.
 */
export function SyncIndicator() {
  const status = useSyncStore((state) => deriveSyncStatus(state.streams))
  const progress = useSyncStore((state) => deriveSyncProgress(state.progress))
  const workspace = useWorkspaceStore((state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId))
  const joinAsMember = useWorkspaceStore((state) => state.joinAsMember)
  const promptText = useDialogStore((state) => state.promptText)
  const alert = useDialogStore((state) => state.alert)
  const { icon, label } = STATUS_TEXT[status]
  const displayLabel = status === 'syncing' && progress !== null ? `${label} (${progress}%)` : label

  async function repair() {
    const profileId = workspace && (workspace.ownProfileId ?? deriveOwnProfileId(workspace, getDeviceId()))
    if (!workspace || !profileId) {
      void alert('Reparatur hier nicht möglich - Band unter „Von diesem Gerät entfernen" verlassen und neu beitreten.')
      return
    }
    const code = await promptText('Sync reparieren', { label: `Zugangscode für „${workspace.name}"` })
    if (!code) return
    await joinAsMember(workspace.id, workspace.name, code, profileId, code.slice(-4))
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex h-12 items-center gap-2 rounded-sb bg-control px-4 text-base text-ink-soft"
        title={displayLabel}
      >
        <span className={`text-lg leading-none ${status === 'syncing' ? 'animate-pulse' : ''}`}>{icon}</span>
        {displayLabel}
      </div>
      {status === 'error' && (
        <button
          type="button"
          onClick={() => void repair()}
          className="h-10 rounded-sb-sm bg-control-strong px-4 text-sm font-medium text-ink hover:bg-control-strong-hover"
        >
          Reparieren
        </button>
      )}
    </div>
  )
}

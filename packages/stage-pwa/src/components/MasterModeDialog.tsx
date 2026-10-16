import type { Workspace } from '../store/useWorkspaceStore'
import { useDialogStore } from '../store/useDialogStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { Dialog, Segmented } from './ui'

export const MASTER_MODE_LABEL: Record<'device' | 'account', string> = {
  device: 'pro Gerät',
  account: 'pro Person',
}

/**
 * How master works in a band (Marco, 2026-10-16: a band setting, so it sits with the band - the
 * badge beside "Aktiv" and the band's ⋯ open this; it used to be a section below the members).
 * Admins of a server-connected band change it; everyone else reads what it means.
 */
export function MasterModeDialog({ workspace, onClose }: { workspace: Workspace; onClose: () => void }) {
  const setMasterMode = useWorkspaceStore((state) => state.setMasterMode)
  const alert = useDialogStore((state) => state.alert)
  const canChange = workspace.isAdmin && !!workspace.username
  const mode = workspace.masterMode ?? 'device'

  return (
    <Dialog title={`Master-Kontrolle - ${workspace.name}`} size="s" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-base text-ink-soft">
          <strong>Pro Gerät:</strong> genau ein Gerät steuert die Show. <strong>Pro Person:</strong> alle Geräte der Person, die Master ist (z. B. Tablet und Handy des Bandleaders), steuern gemeinsam.
        </p>
        {canChange ? (
          <Segmented
            label="Master-Kontrolle"
            value={mode}
            size="stage"
            onChange={async (next) => {
              // Saved on the Stage-Server - say so when that didn't work instead of silently staying (#409 review).
              if (!(await setMasterMode(workspace.id, next))) void alert('Nicht gespeichert - Stage-Server nicht erreichbar oder keine Admin-Anmeldung auf diesem Gerät.')
            }}
            options={[
              { value: 'device', label: 'Pro Gerät' },
              { value: 'account', label: 'Pro Person' },
            ]}
          />
        ) : (
          <p className="text-base text-ink">
            Diese Band: <strong>Master {MASTER_MODE_LABEL[mode]}</strong>. Nur Band-Admins können das ändern.
          </p>
        )}
      </div>
    </Dialog>
  )
}

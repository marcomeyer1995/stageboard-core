import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Dashboard } from 'shared-types'
import { useBackHandler } from '../lib/backNavigation'
import { canRemoveMode, isDashboardAvailableInMode, toggleDashboardMode } from '../lib/dashboardLayout'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useActiveDashboardStore } from '../store/useActiveDashboardStore'
import { useDashboardsStore } from '../store/useDashboardsStore'
import { useDialogStore } from '../store/useDialogStore'
import { useEditModeStore } from '../store/useEditModeStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { Icon } from './Icon'

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-bold uppercase tracking-widest text-ink-faint">{title}</p>
      {children}
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
    </div>
  )
}

const segment = (selected: boolean) =>
  `h-12 rounded-sb text-base font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
    selected ? 'bg-accent text-accent-ink' : 'bg-control text-ink-soft hover:bg-control-hover'
  }`

/**
 * The dashboard's settings behind ⋯ in the edit bar - in the burger menu's own look (Marco):
 * yellow = on, dark = off, every choice a button, never a label that changes its text.
 */
export function DashboardSettingsDialog({ dashboard, onClose }: { dashboard: Dashboard; onClose: () => void }) {
  useBackHandler(onClose)
  const dashboards = useDashboardsStore((state) => state.dashboards)
  const save = useDashboardsStore((state) => state.save)
  const duplicate = useDashboardsStore((state) => state.duplicate)
  const remove = useDashboardsStore((state) => state.remove)
  const resetToDefaults = useDashboardsStore((state) => state.resetToDefaults)
  const setActive = useActiveDashboardStore((state) => state.setActive)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const setEditing = useEditModeStore((state) => state.setEditing)
  const confirm = useDialogStore((state) => state.confirm)
  const profile = useActiveProfile()
  const isAdmin = profile?.stageRoles.includes('admin') ?? false
  // The band keeps at least one shared dashboard.
  const lastPublic = dashboard.visibility !== 'private' && dashboards.filter((d) => d.visibility !== 'private').length <= 1

  const modeButton = (mode: 'gig' | 'practice', label: string) => {
    const on = isDashboardAvailableInMode(dashboard, mode)
    // The last dashboard of a mode stays offered there.
    const locked = on && !canRemoveMode(dashboards, dashboard, mode)
    return (
      <button
        type="button"
        aria-pressed={on}
        disabled={locked}
        title={locked ? `Einziges Dashboard für ${label} - bleibt dort` : undefined}
        onClick={() => void save({ ...dashboard, modes: toggleDashboardMode(dashboard, mode) })}
        className={segment(on)}
      >
        {label}
      </button>
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Einstellungen: ${dashboard.name}`}
        className="flex max-h-[min(85vh,85dvh)] w-full max-w-md flex-col overflow-hidden rounded-sb border border-line bg-surface shadow-sb"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2">
          <p className="min-w-0 truncate text-sm font-bold uppercase tracking-widest text-ink-faint">{dashboard.name}</p>
          <button
            type="button"
            onClick={onClose}
            className="flex h-touch flex-shrink-0 items-center gap-2 rounded-sb bg-control-strong px-4 text-base font-medium text-ink hover:bg-control-strong-hover"
          >
            <Icon name="close" size="1.25rem" />
            Schließen
          </button>
        </div>
        <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-4">
          <Section title="Anbieten in" hint="Gelb = in diesem Modus im Menü. Beides geht.">
            <div className="grid grid-cols-2 gap-2">
              {modeButton('gig', 'Gig')}
              {modeButton('practice', 'Solo Üben')}
            </div>
          </Section>

          <Section title="Statusleiste">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" aria-pressed={dashboard.statusBar !== false} onClick={() => void save({ ...dashboard, statusBar: undefined })} className={segment(dashboard.statusBar !== false)}>
                An
              </button>
              <button type="button" aria-pressed={dashboard.statusBar === false} onClick={() => void save({ ...dashboard, statusBar: false })} className={segment(dashboard.statusBar === false)}>
                Aus
              </button>
            </div>
          </Section>

          <Section title="Sichtbar für" hint={lastPublic ? 'Das einzige geteilte Dashboard bleibt geteilt.' : undefined}>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={dashboard.visibility !== 'private'}
                onClick={() => void save({ ...dashboard, visibility: 'public', ownerProfileId: undefined, ownerRole: undefined })}
                className={segment(dashboard.visibility !== 'private')}
              >
                Ganze Band
              </button>
              <button
                type="button"
                aria-pressed={dashboard.visibility === 'private'}
                disabled={dashboard.visibility !== 'private' && (lastPublic || !profile)}
                onClick={() => void save({ ...dashboard, visibility: 'private', ownerProfileId: profile?.id, ownerRole: undefined })}
                className={segment(dashboard.visibility === 'private')}
              >
                Nur ich
              </button>
            </div>
          </Section>

          {isAdmin && (
            <Section title="Vorlage" hint="Geschützt: nur Admins ändern es, alle können es duplizieren.">
              <div className="grid grid-cols-2 gap-2">
                <button type="button" aria-pressed={dashboard.isReadOnly !== true} onClick={() => void save({ ...dashboard, isReadOnly: undefined })} className={segment(dashboard.isReadOnly !== true)}>
                  Frei
                </button>
                <button type="button" aria-pressed={dashboard.isReadOnly === true} onClick={() => void save({ ...dashboard, isReadOnly: true })} className={segment(dashboard.isReadOnly === true)}>
                  Geschützt
                </button>
              </div>
            </Section>
          )}

          <Section title="Aktionen">
            <button
              type="button"
              onClick={async () => {
                const copy = await duplicate(dashboard.id, `${dashboard.name} Kopie`)
                if (copy) setActive(workspaceId, copy.id)
                onClose()
              }}
              className="flex h-12 items-center justify-between rounded-sb bg-control px-4 text-base text-ink-soft hover:bg-control-hover"
            >
              Duplizieren
            </button>
            <button
              type="button"
              disabled={lastPublic}
              title={lastPublic ? 'Das einzige geteilte Dashboard bleibt bestehen' : undefined}
              onClick={async () => {
                if (!(await confirm(`„${dashboard.name}“ löschen?`, { confirmLabel: 'Löschen', danger: true }))) return
                await remove(dashboard.id)
                setEditing(false)
                onClose()
              }}
              className="flex h-12 items-center justify-between rounded-sb bg-control px-4 text-base text-red-400 hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              Dashboard löschen
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!(await confirm('Alle Dashboards verwerfen und zurücksetzen?', { confirmLabel: 'Zurücksetzen', danger: true }))) return
                void resetToDefaults()
                onClose()
              }}
              className="flex h-12 items-center justify-between rounded-sb bg-control px-4 text-base text-red-400 hover:bg-control-hover"
            >
              Alle Dashboards zurücksetzen
            </button>
          </Section>
        </div>
      </div>
    </div>,
    document.body,
  )
}

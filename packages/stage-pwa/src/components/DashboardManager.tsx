import { useState } from 'react'
import type { Dashboard, Profile } from 'shared-types'
import { isDashboardVisible } from '../lib/dashboardLayout'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useActiveDashboardStore } from '../store/useActiveDashboardStore'
import { useDashboardsStore } from '../store/useDashboardsStore'
import { useProfilesStore } from '../store/useProfilesStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

interface DashboardManagerProps {
  onClose: () => void
}

function ownerLabel(dashboard: Dashboard, profiles: Profile[]): string {
  if (dashboard.ownerProfileId) {
    return profiles.find((profile) => profile.id === dashboard.ownerProfileId)?.name ?? 'Unbekannt'
  }
  if (dashboard.ownerRole) return `Rolle: ${dashboard.ownerRole}`
  return 'Geteilt'
}

/**
 * Replaces the old prompt()/confirm()-driven CRUD in DashboardEditBar with a real list:
 * reorder, rename inline, duplicate, delete (guarded on the last public dashboard), and
 * create a new one - including, unlike the old flow, actually choosing an owner and
 * visibility instead of every dashboard defaulting to public/unowned.
 */
export function DashboardManager({ onClose }: DashboardManagerProps) {
  const dashboards = useDashboardsStore((state) => state.dashboards)
  const save = useDashboardsStore((state) => state.save)
  const create = useDashboardsStore((state) => state.create)
  const duplicate = useDashboardsStore((state) => state.duplicate)
  const rename = useDashboardsStore((state) => state.rename)
  const remove = useDashboardsStore((state) => state.remove)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const setActive = useActiveDashboardStore((state) => state.setActive)
  const profiles = useProfilesStore((state) => state.profiles)
  const activeProfile = useActiveProfile()

  const roles = [...new Set(profiles.map((profile) => profile.role))]

  const [newName, setNewName] = useState('')
  const [newOwner, setNewOwner] = useState(activeProfile ? `profile:${activeProfile.id}` : 'public')

  const visible = [...dashboards]
    .filter((dashboard) => isDashboardVisible(dashboard, activeProfile))
    .sort((a, b) => a.order - b.order)

  const mine = activeProfile
    ? visible.filter(
        (dashboard) =>
          dashboard.visibility === 'private' &&
          (dashboard.ownerProfileId === activeProfile.id ||
            dashboard.ownerRole === activeProfile.role),
      )
    : []
  const shared = visible.filter((dashboard) => !mine.includes(dashboard))

  const publicCount = dashboards.filter((dashboard) => dashboard.visibility !== 'private').length

  function isLastPublic(dashboard: Dashboard) {
    return dashboard.visibility !== 'private' && publicCount <= 1
  }

  function move(list: Dashboard[], dashboard: Dashboard, direction: -1 | 1) {
    const index = list.findIndex((item) => item.id === dashboard.id)
    const neighbor = list[index + direction]
    if (!neighbor) return
    void save({ ...dashboard, order: neighbor.order })
    void save({ ...neighbor, order: dashboard.order })
  }

  function createDashboard() {
    const name = newName.trim()
    if (!name) return
    const owner = newOwner.startsWith('profile:')
      ? { ownerProfileId: newOwner.slice('profile:'.length), visibility: 'private' as const }
      : newOwner.startsWith('role:')
        ? { ownerRole: newOwner.slice('role:'.length), visibility: 'private' as const }
        : { visibility: 'public' as const }
    void create(name, owner).then((created) => {
      setActive(workspaceId, created.id)
      setNewName('')
    })
  }

  function row(dashboard: Dashboard, list: Dashboard[]) {
    const locked = isLastPublic(dashboard)
    return (
      <div
        key={dashboard.id}
        className="flex flex-wrap items-center gap-2 rounded-sb border border-line bg-surface px-3 py-2 shadow-sb"
      >
        <div className="flex flex-col text-xs leading-none text-ink-faint">
          <button
            type="button"
            onClick={() => move(list, dashboard, -1)}
            className="px-1 py-0.5 hover:text-ink-soft"
            title="Nach oben"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={() => move(list, dashboard, 1)}
            className="px-1 py-0.5 hover:text-ink-soft"
            title="Nach unten"
          >
            ▼
          </button>
        </div>

        <input
          value={dashboard.name}
          onChange={(e) => void rename(dashboard.id, e.target.value)}
          className="min-w-0 flex-1 rounded-sb-sm bg-control px-2 py-1 text-ink"
        />

        <span
          className={`whitespace-nowrap rounded-sb-sm px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
            dashboard.visibility === 'private'
              ? 'bg-accent-2 text-accent-ink'
              : 'bg-control-strong text-ink-soft'
          }`}
        >
          {dashboard.visibility === 'private' ? ownerLabel(dashboard, profiles) : 'Geteilt'}
        </span>

        <button
          type="button"
          onClick={() => setActive(workspaceId, dashboard.id)}
          className="rounded-sb-sm bg-control px-2 py-1 text-xs text-ink-soft hover:bg-control-hover"
        >
          Anzeigen
        </button>
        <button
          type="button"
          onClick={async () => {
            const copy = await duplicate(dashboard.id, `${dashboard.name} Kopie`)
            if (copy) setActive(workspaceId, copy.id)
          }}
          className="rounded-sb-sm bg-control px-2 py-1 text-xs text-ink-soft hover:bg-control-hover"
        >
          Duplizieren
        </button>
        <button
          type="button"
          disabled={locked}
          title={locked ? 'Das letzte öffentliche Dashboard bleibt bestehen' : undefined}
          onClick={() => {
            if (window.confirm(`"${dashboard.name}" löschen?`)) void remove(dashboard.id)
          }}
          className="rounded-sb-sm bg-control px-2 py-1 text-xs text-ink-soft hover:bg-control-hover disabled:opacity-40"
        >
          Löschen
        </button>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-sb border border-line bg-surface p-4 shadow-sb"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Dashboards verwalten</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sb-sm bg-control px-3 py-1 text-sm text-ink-soft hover:bg-control-hover"
          >
            Fertig
          </button>
        </div>

        {mine.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-bold uppercase tracking-widest text-ink-faint">
              Meine Stations
            </p>
            {mine.map((dashboard) => row(dashboard, mine))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold uppercase tracking-widest text-ink-faint">Geteilt</p>
          {shared.map((dashboard) => row(dashboard, shared))}
        </div>

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="text-xs font-bold uppercase tracking-widest text-ink-faint">+ Neu</p>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name"
            className="rounded-sb-sm bg-control px-2 py-1 text-ink"
          />
          <select
            value={newOwner}
            onChange={(e) => setNewOwner(e.target.value)}
            className="rounded-sb-sm bg-control px-2 py-1 text-ink"
          >
            <option value="public">Geteilt (öffentlich)</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={`profile:${profile.id}`}>
                {profile.name} (privat)
              </option>
            ))}
            {roles.map((role) => (
              <option key={role} value={`role:${role}`}>
                Rolle: {role} (privat)
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={createDashboard}
            className="rounded-sb-sm bg-accent-2 px-3 py-2 font-bold text-accent-ink hover:bg-accent-2-hover"
          >
            Anlegen
          </button>
        </div>
      </div>
    </div>
  )
}

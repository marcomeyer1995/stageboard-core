import { useActiveProfileStore } from '../store/useActiveProfileStore'
import { useProfilesStore } from '../store/useProfilesStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * Which musician this tablet is showing right now - not a login. Any device can pick any
 * profile from the roster; it exists so a private Station can be told apart from
 * everyone else's, not to gate access. See profile.ts / useActiveProfileStore.ts.
 */
export function ProfileSwitcher() {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const profiles = useProfilesStore((state) => state.profiles)
  const create = useProfilesStore((state) => state.create)
  const update = useProfilesStore((state) => state.update)
  const remove = useProfilesStore((state) => state.remove)
  const activeProfileId = useActiveProfileStore((state) => state.byWorkspace[workspaceId])
  const setActive = useActiveProfileStore((state) => state.setActive)

  const active = profiles.find((profile) => profile.id === activeProfileId)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          className="h-12 flex-1 rounded-sb bg-control px-3 text-base text-ink-soft"
          value={activeProfileId ?? ''}
          onChange={(e) => setActive(workspaceId, e.target.value || null)}
        >
          <option value="">— Kein Profil —</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name} ({profile.role})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            const name = window.prompt('Name?')
            if (!name?.trim()) return
            const role = window.prompt('Rolle? (z.B. Vocalist, Gitarre, Crew)')
            if (!role?.trim()) return
            void create(name.trim(), role.trim()).then((profile) => setActive(workspaceId, profile.id))
          }}
          title="Neues Profil anlegen"
          className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-sb bg-control text-xl text-ink-soft hover:bg-control-hover"
        >
          +
        </button>
      </div>

      {active && (
        <div className="flex items-center gap-3 text-xs text-ink-faint">
          <button
            type="button"
            onClick={() => {
              const name = window.prompt('Neuer Name?', active.name)
              if (!name?.trim()) return
              const role = window.prompt('Neue Rolle?', active.role)
              if (!role?.trim()) return
              void update(active.id, name.trim(), role.trim())
            }}
            className="underline hover:text-ink-soft"
          >
            Bearbeiten
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Profil "${active.name}" löschen?`)) {
                void remove(active.id)
                setActive(workspaceId, null)
              }
            }}
            className="underline hover:text-ink-soft"
          >
            Löschen
          </button>
        </div>
      )}

      <p className="text-[10px] text-ink-faint">
        Kein Login - jedes Tablet kann jedes Profil wählen. Steuert nur, welche privaten
        Dashboards sichtbar sind.
      </p>
    </div>
  )
}

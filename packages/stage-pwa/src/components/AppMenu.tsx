import type { ReactNode } from 'react'
import { EditLock } from './EditLock'
import { MasterControl } from './MasterControl'
import { SessionModeControl } from './SessionModeControl'
import { isDashboardVisible } from '../lib/dashboardLayout'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useFullscreen } from '../lib/useFullscreen'
import { useActiveDashboardStore } from '../store/useActiveDashboardStore'
import { useAppModeStore } from '../store/useAppModeStore'
import { useDashboardsStore } from '../store/useDashboardsStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { MODE_LABEL, MODES, type Mode } from '../lib/modes'

interface AppMenuProps {
  mode: Mode
  onSelectMode: (mode: Mode) => void
  onClose: () => void
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-bold uppercase tracking-widest text-ink-faint">{title}</p>
      {children}
    </div>
  )
}

/**
 * Just what's actually touched during a show - band/theme/sync-detail settings moved out to
 * SystemView.tsx's "Einstellungen" tab in the 2026-08-30 menu-decluttering pass (this menu had
 * grown to nine always-expanded sections, most of them "set once, forget it" device settings
 * crowding out the handful of things someone actually reaches for mid-gig). What's left:
 * screen navigation, a direct Dashboard picker (#35 - switch which one is active from any
 * mode without needing a DashboardSwitcherWidget on the grid or opening Edit Mode; jumps to
 * Live automatically since picking one only makes sense there), Master-Kontrolle (live token
 * handoff), the Dashboard edit-lock (live mode only), and Vollbild - Fullscreen stayed here
 * (not moved to SystemView with the rest) because it's something reached for at the start of
 * a set, not a set-once device setting like the others.
 *
 * 2026-09-02 follow-up, at Marco's explicit request: the "Wer bin ich" section (band + profile
 * switching) was removed from here entirely - `WorkspaceSwitcher.tsx`/`ProfileSwitcher.tsx`
 * (deleted) let any device silently switch to displaying as any roster member with zero
 * credential check, which stopped making sense once real per-person accounts existed. Switching
 * which band and which member this device is now happens in one place,
 * `BandManagementView.tsx`'s "Band" tab, by picking the corresponding entry - selecting a
 * password-protected member there asks for the password (same recovery semantics as everywhere
 * else: blank resets a non-admin account, is refused for an admin one).
 */
export function AppMenu({ mode, onSelectMode, onClose }: AppMenuProps) {
  const fullscreen = useFullscreen()
  const sessionMode = useAppModeStore((state) => state.mode)

  const dashboards = useDashboardsStore((state) => state.dashboards)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const byWorkspace = useActiveDashboardStore((state) => state.byWorkspace)
  const setActiveDashboard = useActiveDashboardStore((state) => state.setActive)
  const activeProfile = useActiveProfile()
  // Same visibility rule DashboardSwitcherWidget.tsx uses - a private Station never appears
  // as a switch target for anyone but its owner. Hidden entirely with only one (or zero)
  // dashboard to switch to - nothing to pick from, so the section would just be clutter
  // (#35: "screen navigation... what's actually touched during a show", same paring-down
  // this menu already went through once).
  const switchableDashboards = dashboards.filter((dashboard) => isDashboardVisible(dashboard, activeProfile))
  const activeDashboardId = byWorkspace[workspaceId] ?? switchableDashboards[0]?.id

  function selectDashboard(dashboardId: string) {
    setActiveDashboard(workspaceId, dashboardId)
    onSelectMode('live')
    onClose()
  }

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-sm flex-col gap-5 overflow-y-auto rounded-sb border border-line bg-surface p-4 shadow-sb"
        onClick={(e) => e.stopPropagation()}
      >
        <Section title="Ansicht">
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() => {
                  onSelectMode(candidate)
                  onClose()
                }}
                className={`h-14 rounded-sb text-base font-semibold ${
                  mode === candidate
                    ? 'bg-accent text-accent-ink'
                    : 'bg-control text-ink-soft hover:bg-control-hover'
                }`}
              >
                {MODE_LABEL[candidate]}
              </button>
            ))}
          </div>
        </Section>

        {switchableDashboards.length > 1 && (
          <Section title="Dashboards">
            <div className="flex flex-col gap-1">
              {switchableDashboards.map((dashboard) => (
                <button
                  key={dashboard.id}
                  type="button"
                  onClick={() => selectDashboard(dashboard.id)}
                  className={`flex h-11 items-center justify-between rounded-sb px-4 text-sm font-medium ${
                    dashboard.id === activeDashboardId
                      ? 'bg-accent text-accent-ink'
                      : 'bg-control text-ink-soft hover:bg-control-hover'
                  }`}
                >
                  {dashboard.name}
                  {dashboard.id === activeDashboardId && <span aria-hidden="true">✓</span>}
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section title="Modus">
          <SessionModeControl />
        </Section>

        {sessionMode === 'gig' && (
          <Section title="Master-Kontrolle">
            <MasterControl />
          </Section>
        )}

        {mode === 'live' && (
          <Section title="Dashboard">
            <EditLock onUnlock={onClose} />
          </Section>
        )}

        {fullscreen.supported && (
          <Section title="Anzeige">
            <button
              type="button"
              onClick={() => void fullscreen.toggle()}
              className="flex h-12 items-center justify-between rounded-sb bg-control px-4 text-base text-ink-soft hover:bg-control-hover"
            >
              Vollbild
              <span>{fullscreen.isFullscreen ? '⤡ Aus' : '⤢ An'}</span>
            </button>
          </Section>
        )}

        <button
          type="button"
          onClick={onClose}
          className="h-12 rounded-sb bg-control-strong text-base font-medium text-ink hover:bg-control-strong-hover"
        >
          Fertig
        </button>
      </div>
    </div>
  )
}

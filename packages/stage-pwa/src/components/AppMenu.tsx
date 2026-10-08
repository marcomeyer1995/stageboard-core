import { DashboardMenuList } from './DashboardMenuList'
import { MasterControl } from './MasterControl'
import { PracticeSetlistPicker } from './PracticeSetlistPicker'
import { SessionModeControl } from './SessionModeControl'
import { useFullscreen } from '../lib/useFullscreen'
import { isNativeApp } from '../lib/native'
import { useActiveDashboardStore } from '../store/useActiveDashboardStore'
import { useAppModeStore } from '../store/useAppModeStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { MODE_LABEL, MODES, type Mode } from '../lib/modes'
import { Dialog, Section, Segmented, Switch } from './ui'
import { useIsPanelLayout } from '../lib/useIsPanelLayout'
import { LOW_SCREEN, useMediaQuery } from '../lib/useMediaQuery'

interface AppMenuProps {
  mode: Mode
  onSelectMode: (mode: Mode) => void
  onClose: () => void
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
  // Two columns from tablet width in portrait too (Marco, 2026-10-08: on the Fire in portrait the
  // single 384 px column looked crowded and wasted half the screen, and scrolled with more
  // dashboards) - only a phone in portrait keeps one column.
  const panelLayout = useIsPanelLayout()
  const tabletWide = useMediaQuery('(min-width: 600px)')
  // Phone in landscape: so little height that each part gets its own column (Marco, 2026-10-08).
  const lowScreen = useMediaQuery(LOW_SCREEN)
  const wide = useMediaQuery('(min-width: 1000px)')
  const lowAndWide = useMediaQuery('(min-width: 700px)') && lowScreen
  const twoColumns = panelLayout || tabletWide
  const sessionMode = useAppModeStore((state) => state.mode)
  // The middle column holds Master-Kontrolle (Gig only) and Anzeige (browser only) - with neither,
  // three columns would leave an empty third in the middle (#432 review); two columns then.
  const middleColumnEmpty = sessionMode !== 'gig' && !(fullscreen.supported && !isNativeApp())
  const threeColumns = (wide || lowAndWide) && twoColumns && !middleColumnEmpty

  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const setActiveDashboard = useActiveDashboardStore((state) => state.setActive)

  function selectDashboard(dashboardId: string) {
    setActiveDashboard(workspaceId, dashboardId)
    onSelectMode('boards')
    onClose()
  }

  // A dialog like every other (docs/15 D6): the way out is the "Fertig" at the bottom - the
  // bottom row never scrolls away (#376: on the phone the old end-of-list close was cut off).
  const viewSection = (
    <>
      {/* Ansicht as the same joined bar as Modus (Marco, 2026-10-07: separate buttons above a bar
          looked like two systems). Choosing a screen closes the menu. */}
      <Section title="Ansicht">
        <Segmented
          label="Ansicht"
          size={lowScreen ? 'form' : 'stage'}
          compact={lowScreen}
          value={mode}
          onChange={(candidate) => {
            onSelectMode(candidate)
            onClose()
          }}
          options={MODES.map((candidate) => ({ value: candidate, label: MODE_LABEL[candidate] }))}
        />
      </Section>
    </>
  )
  const dashboardSection = (
    <>
      {/* Tap switches; "Bearbeiten" below the list opens order, hiding, new ones and the pen
          (Marco's redesign - replaces "Dashboards verwalten" and the separate lock row). */}
      <Section title="Dashboards">
        <DashboardMenuList
          onSelect={selectDashboard}
          onEdit={() => {
            onSelectMode('boards')
            onClose()
          }}
        />
      </Section>
    </>
  )
  const modeSection = (
    <>
      <Section title="Modus">
        <SessionModeControl />
        {sessionMode === 'practice' && <PracticeSetlistPicker />}
      </Section>
    </>
  )
  const masterSection = (
    <>
      {sessionMode === 'gig' && (
        <Section title="Master-Kontrolle">
          <MasterControl />
        </Section>
      )}
    </>
  )
  const displaySection = (
    <>
      {/* The native app always runs full screen (#412) - the switch is for the browser/PWA only. */}
      {fullscreen.supported && !isNativeApp() && (
        <Section title="Anzeige">
          <Switch label="Vollbild" checked={fullscreen.isFullscreen} onChange={() => void fullscreen.toggle()} />
        </Section>
      )}
    </>
  )

  // Landscape tablet and laptop (Marco, 2026-10-07: a portrait-shaped menu meant scrolling
  // there, "perfect not to need to scroll"): from 1000 px three columns - the Xiaomi in landscape
  // has only ~470 px of height for the menu's content - otherwise two; the dashboard list, the
  // part that grows, always on the right. Portrait keeps the single column in the familiar order.
  return (
    <Dialog title="Menü" size={threeColumns ? 'xl' : twoColumns ? 'l' : 's'} onClose={onClose}>
      {threeColumns ? (
        <div className={`grid items-start ${lowScreen ? 'grid-cols-[1.25fr_1fr_1fr] gap-4' : 'grid-cols-3 gap-6'}`}>
          <div className="flex min-w-0 flex-col gap-4">
            {viewSection}
            {modeSection}
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            {masterSection}
            {displaySection}
          </div>
          <div className="flex min-w-0 flex-col gap-4">{dashboardSection}</div>
        </div>
      ) : twoColumns ? (
        <div className="grid grid-cols-2 items-start gap-6">
          <div className="flex min-w-0 flex-col gap-4">
            {viewSection}
            {modeSection}
            {masterSection}
            {displaySection}
          </div>
          <div className="flex min-w-0 flex-col gap-4">{dashboardSection}</div>
        </div>
      ) : (
        <>
          {viewSection}
          {dashboardSection}
          {modeSection}
          {masterSection}
          {displaySection}
        </>
      )}
    </Dialog>
  )
}

import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BandPickRow } from './BandPickRow'
import { GigSetlistPicker } from './GigSetlistPicker'
import { MasterControl } from './MasterControl'
import { PracticeSetlistPicker } from './PracticeSetlistPicker'
import { SessionModeControl } from './SessionModeControl'
import { useFullscreen } from '../lib/useFullscreen'
import { isNativeApp } from '../lib/native'
import { useAppModeStore } from '../store/useAppModeStore'
import { MODES, type Mode } from '../lib/modes'
import { Icon } from './Icon'
import { SwitchProfileDialog } from './SwitchProfileDialog'
import { useActiveProfile } from '../lib/useActiveProfile'
import { Drawer, Switch } from './ui'
import { CONTROL, FOCUS, HOVER, SELECTED } from './ui/styles'

/**
 * A group in the drawer with what it is for (Marco, 2026-10-16): in portrait the name sits above it,
 * in landscape - where height is short and width is plenty - beside it on the left, so ☰ fits one
 * screen. A thin line sets it apart from the group above.
 */
function MenuGroup({ label, first = false, children }: { label: string; first?: boolean; children: ReactNode }) {
  return (
    <section aria-label={label} className={`grid gap-2 landscape:grid-cols-[6.5rem_minmax(0,1fr)] landscape:gap-x-3 ${first ? '' : 'border-t border-line pt-4'}`}>
      <h3 className="text-xs font-bold uppercase tracking-widest text-ink-faint landscape:pt-[1.1rem]">{label}</h3>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </section>
  )
}

interface AppMenuProps {
  mode: Mode
  onSelectMode: (mode: Mode) => void
  onClose: () => void
  /** Status bar hidden: room for the corner buttons on top. */
  clearCornerButtons?: boolean
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
 *
 * 2026-10-16 (docs/15 D8, Marco): a drawer sliding in from the left instead of a dialog, one
 * column; the dashboard list moved out to the bento menu top right (`DashboardMenu.tsx`).
 */
export function AppMenu({ mode, onSelectMode, onClose, clearCornerButtons }: AppMenuProps) {
  const { t } = useTranslation('common')
  const fullscreen = useFullscreen()
  const sessionMode = useAppModeStore((state) => state.mode)
  const me = useActiveProfile()
  const [switchingProfile, setSwitchingProfile] = useState(false)

  return (
    <Drawer title="Menü" side="left" onClose={onClose} clearCornerButtons={clearCornerButtons}>
      {/* "Wohin?" = navigation (docs/15 §4): in a drawer one row per screen, below each other, the
          current one yellow (Marco, 2026-10-16) - not a pick-one bar. Choosing closes the menu. */}
      <MenuGroup label="Ansicht" first>
        <nav aria-label="Ansicht" className="flex flex-col gap-1">
          {MODES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-current={candidate === mode ? 'page' : undefined}
              onClick={() => {
                onSelectMode(candidate)
                onClose()
              }}
              className={`flex h-stage w-full items-center gap-3 px-4 text-left text-lg ${CONTROL} ${FOCUS} ${candidate === mode ? SELECTED : `bg-control text-ink ${HOVER}`}`}
            >
              <Icon name={candidate} size="1.4rem" />
              {t(`mode.${candidate}`)}
            </button>
          ))}
        </nav>
      </MenuGroup>
      {/* No headings over Modus and Master - the bar and the row say it themselves; a thin line
          sets the groups apart instead, so ☰ fits one landscape screen (Marco, 2026-10-16). */}
      <MenuGroup label="Modus">
        <SessionModeControl />
      </MenuGroup>
      {sessionMode === 'gig' && (
        <MenuGroup label="Master">
          <MasterControl />
        </MenuGroup>
      )}
      {/* One place for the setlist in both modes (Marco, 2026-10-16: under Modus in Solo and under
          Master in Gig made no sense) - the band's in Gig, this device's own in Solo Üben. */}
      <MenuGroup label="Setlist">{sessionMode === 'gig' ? <GigSetlistPicker /> : <PracticeSetlistPicker />}</MenuGroup>
      <MenuGroup label="Band">
        {/* Who and which band at the bottom - rarely touched (Marco, 2026-10-16: what matters on stage
          first, so the views, Modus, Master and setlist fit the first screen in landscape). */}
        {/* Which band this device shows, switchable here (Marco, 2026-10-16). */}
        <BandPickRow />
        {/* Who uses this device, same band (Marco, 2026-10-16) - here only, never on the status bar. */}
        <button
          type="button"
          onClick={() => setSwitchingProfile(true)}
          className={`flex h-stage w-full items-center justify-between gap-3 bg-control px-4 text-left text-lg text-ink ${CONTROL} ${FOCUS} ${HOVER}`}
        >
          <span className="min-w-0 truncate">
            <span className="text-ink-muted">Ich bin: </span>
            {me?.name ?? 'kein Profil'}
          </span>
          <Icon name="next" size="1.4rem" className="text-ink-faint" />
        </button>
        {switchingProfile && <SwitchProfileDialog onClose={() => setSwitchingProfile(false)} />}
      </MenuGroup>
      {/* The native app always runs full screen (#412) - the switch is for the browser/PWA only. */}
      {fullscreen.supported && !isNativeApp() && (
        <MenuGroup label="Anzeige">
          <Switch label="Vollbild" checked={fullscreen.isFullscreen} onChange={() => void fullscreen.toggle()} />
        </MenuGroup>
      )}
    </Drawer>
  )
}

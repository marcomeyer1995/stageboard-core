import { useState } from 'react'
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
import { Drawer, Section, Switch } from './ui'
import { CONTROL, FOCUS, HOVER, SELECTED } from './ui/styles'

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
      <Section title="Modus">
        <SessionModeControl />
        {sessionMode === 'practice' && <PracticeSetlistPicker />}
      </Section>
      {sessionMode === 'gig' && (
        <Section title="Master-Kontrolle">
          <MasterControl />
          <GigSetlistPicker />
        </Section>
      )}
      {/* The native app always runs full screen (#412) - the switch is for the browser/PWA only. */}
      {fullscreen.supported && !isNativeApp() && (
        <Section title="Anzeige">
          <Switch label="Vollbild" checked={fullscreen.isFullscreen} onChange={() => void fullscreen.toggle()} />
        </Section>
      )}
    </Drawer>
  )
}

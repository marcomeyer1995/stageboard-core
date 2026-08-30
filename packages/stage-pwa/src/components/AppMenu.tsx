import type { ReactNode } from 'react'
import { EditLock } from './EditLock'
import { MasterControl } from './MasterControl'
import { ProfileSwitcher } from './ProfileSwitcher'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { useFullscreen } from '../lib/useFullscreen'
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
 * screen navigation, Master-Kontrolle (live token handoff), the Dashboard edit-lock (live mode
 * only), "Wer bin ich" (which band + which profile), and Vollbild - Fullscreen stayed here
 * (not moved to SystemView with the rest) because it's something reached for at the start of
 * a set, not a set-once device setting like the others.
 */
export function AppMenu({ mode, onSelectMode, onClose }: AppMenuProps) {
  const fullscreen = useFullscreen()

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

        <Section title="Master-Kontrolle">
          <MasterControl />
        </Section>

        {mode === 'live' && (
          <Section title="Dashboard">
            <EditLock onUnlock={onClose} />
          </Section>
        )}

        <Section title="Wer bin ich">
          <WorkspaceSwitcher />
          <ProfileSwitcher />
        </Section>

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

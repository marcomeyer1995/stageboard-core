import type { ReactNode } from 'react'
import { EditLock } from './EditLock'
import { ProfileSwitcher } from './ProfileSwitcher'
import { ThemeSwitcher } from './ThemeSwitcher'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useCapabilities } from '../lib/useCapabilities'
import { useFullscreen } from '../lib/useFullscreen'
import { availableModes, MODE_LABEL, type Mode } from '../lib/modes'

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
 * Everything that used to sit in a row of tiny buttons along the bottom edge - band,
 * theme, fullscreen, and screen navigation. None of it is touched often enough to earn
 * permanent space on a touch device, and at the size a real touch target needs, eight
 * buttons in a row simply don't fit. One menu button opens this instead.
 */
export function AppMenu({ mode, onSelectMode, onClose }: AppMenuProps) {
  const fullscreen = useFullscreen()
  const capabilities = useCapabilities()
  const activeProfile = useActiveProfile()
  const modes = availableModes(capabilities, activeProfile?.role)

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
          <div className="grid grid-cols-2 gap-2">
            {modes.map((candidate) => (
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

        {mode === 'live' && (
          <Section title="Dashboard">
            <EditLock onUnlock={onClose} />
          </Section>
        )}

        <Section title="Band">
          <WorkspaceSwitcher />
        </Section>

        <Section title="Profil">
          <ProfileSwitcher />
        </Section>

        <Section title="Darstellung">
          <ThemeSwitcher />
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

import { Segmented } from './ui'
import { useAppModeStore, type SessionMode } from '../store/useAppModeStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useTranslation } from 'react-i18next'

const OPTIONS: { mode: SessionMode; label: 'session.gig' | 'session.practice'; hint: 'session.gigHint' | 'session.practiceHint' }[] = [
  { mode: 'gig', label: 'session.gig', hint: 'session.gigHint' },
  { mode: 'practice', label: 'session.practice', hint: 'session.practiceHint' },
]

/**
 * Gig vs. Practice (useAppModeStore.ts) - per-device, so switching this on one tablet never
 * affects anyone else's. Deliberately not gated behind Master-Kontrolle: it's a decision about
 * *this device*, unrelated to who's steering the live show.
 *
 * Safety feature (Marco, explicit request): the Solo Üben button is disabled while the shared
 * show is playing in Gig mode - `useAppModeStore.setMode` itself already refuses that switch,
 * this is just the "tell the user why, don't just make it disappear" surface for that same rule
 * (same instinct as e.g. LibraryView's disabled "+" button). The other direction (Solo Üben ->
 * Gig) is never blocked: it just force-stops this device's own local practice playback (#233).
 */
export function SessionModeControl() {
  const mode = useAppModeStore((state) => state.mode)
  const setMode = useAppModeStore((state) => state.setMode)
  const gigPlaying = useShowStateStore((state) => state.state.playbackStatus === 'playing')
  const isBlocked = mode === 'gig' && gigPlaying
  const { t } = useTranslation('menu')
  const blockedTitle = t('session.blocked')

  return (
    <div className="flex flex-col gap-2">
      <Segmented
        label={t('session.label')}
        size="stage"
        value={mode}
        onChange={setMode}
        options={OPTIONS.map((option) => ({
          value: option.mode,
          label: t(option.label),
          disabled: isBlocked && option.mode !== mode,
          title: isBlocked && option.mode !== mode ? blockedTitle : t(option.hint),
        }))}
      />
      {/* Only why Solo Üben is locked - the plain explanation became the tooltip, so ☰ fits one
          landscape screen (Marco, 2026-10-16). */}
      {isBlocked && <p className="text-sm text-ink-faint">{blockedTitle}</p>}
    </div>
  )
}

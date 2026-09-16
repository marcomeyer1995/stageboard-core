import { playLocalTrack } from '../lib/localAudioEngine'
import { useShowMode } from '../lib/showMode'
import { useLocalAudioOutputStore } from '../store/useLocalAudioOutputStore'

/**
 * Full-screen, unmissable blocking overlay for the one moment useAudioOutputDriver.ts's
 * gestureless reload-time auto-resume gets rejected by the browser's autoplay policy (see
 * localAudioEngine.ts's own doc comment on `playLocalTrack`) - not just cosmetic: this device's
 * backing track can only ever resume via a genuine tap, and a discreet in-widget banner risks
 * going unnoticed if whoever's holding this tablet is looking at a different widget (Prompter,
 * Setlist) when it happens. A missed backing track mid-song is worse than blocking the whole UI
 * for one tap (Marco, explicit request, 2026-09-16, after weighing that tradeoff).
 *
 * Mounted once in App.tsx alongside DialogHost/DiscoveryBanner, so it fires regardless of which
 * top-level tab is currently showing - same "must survive independently of any one widget being
 * mounted" reasoning as useAudioOutputDriver.ts itself. A higher z-index than every other overlay
 * in the app (DialogHost is z-30) is deliberate: losing the band's audio outranks anything else
 * this device could be showing right now.
 */
export function AudioResumeOverlay() {
  const audioBlocked = useLocalAudioOutputStore((state) => state.audioBlocked)
  const { elapsedMs } = useShowMode()

  if (!audioBlocked) return null

  async function resume() {
    const result = await playLocalTrack(elapsedMs ?? 0)
    useLocalAudioOutputStore.setState({ audioBlocked: result.status === 'error' })
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-red-900/95 p-6 text-center">
      <p className="text-2xl font-bold text-white">Wiedergabe unterbrochen</p>
      <p className="max-w-sm text-base text-red-100">
        Der Browser hat die automatische Fortsetzung des Backing-Tracks blockiert. Zum
        Weiterspielen antippen.
      </p>
      <button
        type="button"
        onClick={() => void resume()}
        className="animate-pulse rounded-sb bg-white px-8 py-4 text-xl font-bold uppercase tracking-wide text-red-700 hover:bg-red-50"
      >
        Antippen zum Fortsetzen
      </button>
    </div>
  )
}

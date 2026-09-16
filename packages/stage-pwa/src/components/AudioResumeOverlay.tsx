import { getServerTime } from '../lib/clockSync'
import { playLocalTrack } from '../lib/localAudioEngine'
import { computeActiveMs } from '../lib/playbackTransport'
import { useLocalAudioOutputStore } from '../store/useLocalAudioOutputStore'
import { useShowStateStore } from '../store/useShowStateStore'

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
 *
 * Deliberately does NOT read `useShowMode()`/`elapsedMs` reactively (Marco, found live,
 * 2026-09-16: the button needed up to 5 taps to register) - `usePlaybackElapsedMs.ts` ticks via
 * `requestAnimationFrame`, up to 60 times a second, for as long as `playbackStatus` stays
 * 'playing' (which it does the whole time this overlay is up - the audio being silently blocked
 * doesn't change ShowState). Subscribing to that here re-rendered this component (plus
 * `useShowMode()`'s own `useQueue()`/`usePracticeQueue()` work) 60x/sec purely to show a static
 * overlay, competing with the main thread for exactly the touch event this component exists to
 * catch. The elapsed position is only ever needed once, at the moment of the actual tap - read
 * imperatively there instead, the same computation `usePlaybackElapsedMs.ts` does, just without
 * its reactive subscription.
 */
export function AudioResumeOverlay() {
  const audioBlocked = useLocalAudioOutputStore((state) => state.audioBlocked)

  if (!audioBlocked) return null

  async function resume() {
    const { playbackStatus, playbackStartedAt, playbackAccumulatedMs } = useShowStateStore.getState().state
    const elapsedMs = computeActiveMs(
      { status: playbackStatus, startedAt: playbackStartedAt, accumulatedMs: playbackAccumulatedMs },
      getServerTime(),
    )
    const result = await playLocalTrack(Math.max(0, elapsedMs))
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

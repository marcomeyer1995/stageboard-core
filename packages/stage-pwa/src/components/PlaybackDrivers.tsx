import { useLoopTrainerDriver } from '../lib/loopTrainer'
import { useAnnouncementDriver } from '../lib/useAnnouncementDriver'
import { useAudioOutputDriver } from '../lib/useAudioOutputDriver'
import { useAutoStopDriver } from '../lib/useAutoStopDriver'
import { useClickOutputDriver } from '../lib/useClickOutputDriver'
import { useCueScheduler } from '../lib/useCueScheduler'
import { useFootswitch } from '../lib/useFootswitch'
import { useMidiClock } from '../lib/useMidiClock'
import { useMasterSelfCheck } from '../lib/useMasterSelfCheck'
import { useSongAlerts } from '../lib/useSongAlerts'
import { useStallMonitor } from '../lib/useStallMonitor'
import { useStemPlaybackDriver } from '../lib/useStemPlaybackDriver'
import { useTrackDurationBackfill } from '../lib/useTrackDurationBackfill'

/**
 * The always-on playback hooks that follow the song time (useShowMode's elapsed time re-renders
 * its caller on every animation frame while a song plays). They used to sit in App itself - and a
 * hook re-renders the component it is in, so the whole screen (status bar, dashboard, every widget,
 * the grid) re-rendered about 60 times a second during every song. Here they re-render only this
 * component, which draws nothing. The master self-check (#378) is here for the same reason: it
 * re-checks every 2 s, which re-rendered the whole app every 2 s.
 *
 * Mounted once by App on every screen, like before (they must keep running whichever tab is open -
 * see each hook's doc comment). Keep the order: useAutoStopDriver relies on useAudioOutputDriver's
 * load effect running first.
 */
export function PlaybackDrivers({ footswitchActive }: { footswitchActive: boolean }) {
  // Bluetooth foot switch / keyboard (#27): only on the dashboards, not while arranging them.
  useFootswitch(footswitchActive)
  // Song alerts `{alert: ...}` flash on this device when the song passes them (#26).
  useSongAlerts()
  useCueScheduler()
  // MIDI beat clock to the MIDI-Clock devices this device drives (#478).
  useMidiClock()
  // Main-thread stalls while a song plays - sets the cue look-ahead (#477, Diagnose tab).
  useStallMonitor()
  useAudioOutputDriver()
  // Solo practice: the song's stems instead of its track, when switched on (docs/22 §3).
  useStemPlaybackDriver()
  useClickOutputDriver()
  // Spoken section announcements next to the click (#63).
  useAnnouncementDriver()
  useAutoStopDriver()
  useLoopTrainerDriver()
  useTrackDurationBackfill()
  useMasterSelfCheck()
  return null
}

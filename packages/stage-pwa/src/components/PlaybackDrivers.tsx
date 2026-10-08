import { useLoopTrainerDriver } from '../lib/loopTrainer'
import { useAudioOutputDriver } from '../lib/useAudioOutputDriver'
import { useAutoStopDriver } from '../lib/useAutoStopDriver'
import { useClickOutputDriver } from '../lib/useClickOutputDriver'
import { useCueScheduler } from '../lib/useCueScheduler'
import { useFootswitch } from '../lib/useFootswitch'
import { useMasterSelfCheck } from '../lib/useMasterSelfCheck'
import { useSongAlerts } from '../lib/useSongAlerts'
import { useTrackDurationBackfill } from '../lib/useTrackDurationBackfill'

/**
 * The always-on playback hooks that follow the song time. They used to sit in App itself - and a
 * hook re-renders the component it is in, so the whole screen re-rendered about 60 times a second
 * during every song (#440). Here they draw nothing.
 *
 * Each driver that follows the time is its own component (#457): a hook re-renders the component
 * it is in, so in one shared component the audio driver's per-frame position re-ran every other
 * hook here on every frame too (measured: a quarter of the Fire's CPU while playing). Now a frame
 * re-renders only the driver that needs it; the others render when their own state changes.
 *
 * Mounted once by App on every screen (they must keep running whichever tab is open - see each
 * hook's doc comment). Keep the order: useAutoStopDriver relies on useAudioOutputDriver's load
 * effect running first - React runs sibling effects in order.
 */
export function PlaybackDrivers({ footswitchActive }: { footswitchActive: boolean }) {
  return (
    <>
      <Footswitch active={footswitchActive} />
      <SongAlerts />
      <CueScheduler />
      <AudioOutput />
      <ClickOutput />
      <AutoStop />
      <LoopTrainer />
      <TrackDurationBackfill />
      <MasterSelfCheck />
    </>
  )
}

// Bluetooth foot switch / keyboard (#27): only on the dashboards, not while arranging them.
function Footswitch({ active }: { active: boolean }) {
  useFootswitch(active)
  return null
}

// Song alerts `{alert: ...}` flash on this device when the song passes them (#26).
function SongAlerts() {
  useSongAlerts()
  return null
}

function CueScheduler() {
  useCueScheduler()
  return null
}

function AudioOutput() {
  useAudioOutputDriver()
  return null
}

function ClickOutput() {
  useClickOutputDriver()
  return null
}

function AutoStop() {
  useAutoStopDriver()
  return null
}

function LoopTrainer() {
  useLoopTrainerDriver()
  return null
}

function TrackDurationBackfill() {
  useTrackDurationBackfill()
  return null
}

function MasterSelfCheck() {
  useMasterSelfCheck()
  return null
}

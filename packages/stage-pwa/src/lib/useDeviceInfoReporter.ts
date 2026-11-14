import { useEffect } from 'react'
import { deriveSyncStatus, useSyncStore } from '../store/useSyncStore'
import { batteryState } from './battery'
import { detectEnvironment } from './detectEnvironment'
import { summarizeVitals, vitalsSnapshot } from './deviceVitals'
import { getDeviceId } from './deviceId'
import { guessDeviceName } from './guessDeviceName'
import { nativeOutputHealth } from './nativeOutput'
import { reportDeviceInfo } from './reportDeviceInfo'
import { knownMidiOutputNames, watchMidiPorts } from './webMidiOutput'
import { useLeadNeededStore } from './leadCheck'
import { useOutputPlanStore } from './audioMix'
import { silencedSources } from './outputPlan'

/** Comfortably inside DEVICE_INFO_TIMEOUT_MS (shared-types), same margin usePresenceReporter.ts
 * keeps against PRESENCE_TIMEOUT_MS. */
const REPORT_INTERVAL_MS = 10_000

/**
 * Mounted once in App.tsx, same shape as usePresenceReporter.ts - but deliberately *not* the
 * same gating. Presence only reports while a real profile is active (its own doc comment: a
 * device with no profile chosen "shouldn't show this device as anyone in particular"); this
 * reports whenever a workspace is active at all, because a device with no profile chosen yet is
 * still exactly the kind of thing the Device Ledger (DeviceLedgerView.tsx, Marco's explicit
 * request) needs to show - "the app is open on this tablet but nobody's picked a profile on it"
 * is itself a useful debugging signal, not a state to hide.
 *
 * No explicit "I'm leaving" report on stop - same reasoning as presence: an entry just goes
 * stale and times out (DEVICE_INFO_TIMEOUT_MS), robust to a tab closing or a tablet losing
 * power. Only hiding the page is reported at once (`foreground`, #815).
 */
export function useDeviceInfoReporter(workspaceId: string): void {
  useEffect(() => {
    if (!workspaceId) return
    const deviceId = getDeviceId()
    const report = async () => {
      const [battery, midiOutputs] = await Promise.all([batteryState(), knownMidiOutputNames()])
      await reportDeviceInfo(workspaceId, {
        deviceId,
        os: guessDeviceName(),
        environment: detectEnvironment(),
        syncStatus: deriveSyncStatus(useSyncStore.getState().streams, useSyncStore.getState().browserOffline),
        audioOutput: nativeOutputHealth(),
        vitals: summarizeVitals(vitalsSnapshot()),
        leadNeededMs: useLeadNeededStore.getState().neededMs,
        battery,
        midiOutputs,
        silenced: silencedSources(useOutputPlanStore.getState().plan),
        foreground: document.visibilityState !== 'hidden',
      })
    }
    void report()
    const interval = setInterval(() => void report(), REPORT_INTERVAL_MS)
    // A MIDI cable pulled or plugged: the map's check on the other devices should see it soon (#747).
    const stopWatching = watchMidiPorts(() => void report())
    // An output gone or back (headphones pulled): the same, for the sources it silences.
    const silencedKey = () => silencedSources(useOutputPlanStore.getState().plan).join(',')
    let lastSilenced = silencedKey()
    const stopPlan = useOutputPlanStore.subscribe(() => {
      const key = silencedKey()
      if (key === lastSilenced) return
      lastSilenced = key
      void report()
    })
    // Minimised or back (#815): say so at once - hidden, the next interval may never come.
    const onVisibility = () => void report()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(interval)
      stopWatching()
      stopPlan()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [workspaceId])
}

import { useEffect, useRef } from 'react'
import { AUDIO_OUTPUT, NATIVE_AUDIO_OUTPUT } from 'shared-types'
import { alignmentBeatsDue } from './alignByEar'
import { sharedAudioClock } from './audioClock'
import { playClickAt } from './clickEngine'
import { getServerTime } from './clockSync'
import { getDeviceId } from './deviceId'
import { useAudioOutputLatencyMs } from './latencyCompensation'
import { useNativeOutputStore } from './nativeOutput'
import { getSharedAudioContext, holdAudioOutputAwake } from './sharedAudioContext'
import { useAlignmentStore } from '../store/useAlignmentStore'
import { useAudioRouteStore } from '../store/useAudioRouteStore'

const TICK_MS = 50
/** Same window as the click (clickEngine.ts), widened by the output latency. */
const LOOKAHEAD_MS = 150

/**
 * "Abgleich nach Gehör" (docs/21 §4) on this device: while a session names it as reference or
 * target, it clicks on the session's beats of the band clock - placed like the show's click, with
 * this device's latency value, so a changed value moves its click from the next beats on. The target
 * also reports which profile its scheduler reads (native output or WebView, and the route), so the
 * dialog on any device changes the right value. Mounted with the playback drivers.
 */
export function useAlignmentDriver(): void {
  const session = useAlignmentStore((state) => state.session)
  const report = useAlignmentStore((state) => state.report)
  const outputLatencyMs = useAudioOutputLatencyMs()
  const native = useNativeOutputStore((state) => state.state === 'on')
  const route = useAudioRouteStore((state) => state.route)
  const deviceId = getDeviceId()
  const role = !session ? null : session.targetDeviceId === deviceId ? 'target' : session.referenceDeviceId === deviceId ? 'reference' : null

  const output = native ? NATIVE_AUDIO_OUTPUT : AUDIO_OUTPUT
  useEffect(() => {
    if (role !== 'target' || !session) return
    if (session.targetOutput !== output || session.targetRoute !== route) void report(output, route).catch(() => {})
  }, [role, session, output, route, report])

  const latency = useRef(outputLatencyMs)
  latency.current = outputLatencyMs
  const startedAt = session?.startedAt
  const periodMs = session?.periodMs
  const endsAt = session?.endsAt
  useEffect(() => {
    if (!role || startedAt === undefined || periodMs === undefined || endsAt === undefined) return
    const ctx = getSharedAudioContext()
    void ctx.resume().catch(() => {})
    holdAudioOutputAwake('alignment', true)
    // Scheduled up to here (band time) - a beat is never queued twice, also when the latency moves.
    let scheduledTo = getServerTime()
    const tick = () => {
      const serverNow = getServerTime()
      if (serverNow > endsAt) return
      const latencyMs = latency.current
      const audioNow = sharedAudioClock.now(ctx)
      const horizon = serverNow + LOOKAHEAD_MS + latencyMs
      for (const beat of alignmentBeatsDue(startedAt, periodMs, scheduledTo, horizon)) {
        const when = audioNow + (beat - serverNow - latencyMs) / 1000
        if (when >= ctx.currentTime) playClickAt(ctx, when, false)
      }
      scheduledTo = Math.max(scheduledTo, horizon)
    }
    tick()
    const timer = setInterval(tick, TICK_MS)
    return () => {
      clearInterval(timer)
      holdAudioOutputAwake('alignment', false)
    }
  }, [role, startedAt, periodMs, endsAt])
}

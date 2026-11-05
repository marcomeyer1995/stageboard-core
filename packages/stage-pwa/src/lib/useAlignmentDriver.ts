import { useEffect, useRef } from 'react'
import { AUDIO_OUTPUT, NATIVE_AUDIO_OUTPUT } from 'shared-types'
import { ALIGN_SOUND, alignmentBeatsDue, isAlignAccent } from './alignByEar'
import { sourceOutput } from './audioMix'
import { sharedAudioClock } from './audioClock'
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
const CLICK_S = 0.03

/** A 2-ms rise instead of a hard start: a hard start sounds in every band, and the microphone heard
 * the reference's click in the target's band too (2026-11-05). */
const RISE_S = 0.002

/** One alignment click: the role's own pitch, the bar's first beat louder. */
function playAlignClick(ctx: AudioContext, when: number, hz: number, accent: boolean): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.frequency.value = hz
  gain.gain.setValueAtTime(0, when)
  gain.gain.linearRampToValueAtTime(accent ? 0.8 : 0.3, when + RISE_S)
  gain.gain.exponentialRampToValueAtTime(0.001, when + CLICK_S)
  osc.connect(gain)
  gain.connect(sourceOutput('click', ctx))
  osc.start(when)
  osc.stop(when + CLICK_S)
}

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
        if (when >= ctx.currentTime) playAlignClick(ctx, when, ALIGN_SOUND[role].hz, isAlignAccent(startedAt, periodMs, beat))
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

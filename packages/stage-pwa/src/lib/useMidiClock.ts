import { useEffect, useMemo, useRef } from 'react'
import { adjustedBpm } from './metronome'
import { clickTimeline, type ClickTimeline } from './beatGrid'
import { getServerTime } from './clockSync'
import type { CueTransport } from './cueSchedule'
import { findLatencyProfile } from './latencyProfiles'
import { MidiClockEngine, type ClockOutput, type MidiClockInput } from './midiClockEngine'
import { myClockDevices, resolveClockOutput } from './midiClockOutputs'
import { useShowModeSong } from './showMode'
import { getDeviceId } from './deviceId'
import { useDeviceTransportConfigStore } from '../store/useDeviceTransportConfigStore'
import { useLatencyProfilesStore } from '../store/useLatencyProfilesStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { useShowStateStore } from '../store/useShowStateStore'

/** Top-up interval - far below the engine's 200 ms look-ahead, like the cue scheduler (#477). */
const CLOCK_TICK_MS = 25
const NOT_PLAYING: CueTransport = {
  status: 'stopped',
  startedAt: null,
  accumulatedMs: 0,
}

/**
 * MIDI beat clock (#478) to every MIDI-Clock device this device drives - local, no relay
 * (docs/00 §6): every device derives its ticks from the same server-synced song time. Runs always
 * (Marco: the gear already has the next song's tempo before Play). Ticks are handed to WebMIDI
 * with timestamps 200 ms ahead, so main-thread stalls don't shift them; a hidden page's timers are
 * throttled to ~1 s, though, and the clock then has gaps. Start/Stop/Continue follow the Gig
 * transport; in Practice mode it free-runs at the song's tempo.
 */
export function useMidiClock(): void {
  const { mode, queue } = useShowModeSong()
  const logicalDevices = useLogicalDevicesStore((state) => state.devices)
  const configs = useDeviceTransportConfigStore((state) => state.configs)
  const profiles = useLatencyProfilesStore((state) => state.profiles)
  const status = useShowStateStore((state) => state.state.playbackStatus)
  const startedAt = useShowStateStore((state) => state.state.playbackStartedAt)
  const accumulatedMs = useShowStateStore((state) => state.state.playbackAccumulatedMs)
  const takeKey = useShowStateStore((state) => state.state.activeEntryStartedAt)
  const liveTempoAdjustPercent = useShowStateStore((state) => state.state.liveTempoAdjustPercent)

  const song = queue.currentArrangement
  const beatGrid = queue.currentVariant?.beatGrid
  const countInBars = queue.currentVariant?.countInEnabled ? (queue.currentVariant.countInBars ?? 0) : 0
  const bpm = song ? adjustedBpm(song.bpm, mode === 'gig' ? liveTempoAdjustPercent : 0) : null
  const timeSignature = song?.timeSignature ?? '4/4'
  const timeline: ClickTimeline | null = useMemo(() => (bpm ? clickTimeline({ beatGrid, bpm, timeSignature, countInBars }) : null), [beatGrid, bpm, timeSignature, countInBars])

  const clockDevices = useMemo(() => myClockDevices(logicalDevices), [logicalDevices])
  const outputsRef = useRef<ClockOutput[]>([])
  useEffect(() => {
    let cancelled = false
    void Promise.all(
      clockDevices.map(async (device) => {
        const output = await resolveClockOutput(device.id, configs)
        if (!output) return null
        const latencyMs = Math.max(0, findLatencyProfile(profiles, getDeviceId(), device.id, null)?.latencyMs ?? 0)
        return {
          send: (data: number[], timestamp: number) => output.send(data, timestamp),
          latencyMs,
        }
      }),
    ).then((resolved) => {
      if (!cancelled) outputsRef.current = resolved.filter((o): o is ClockOutput => o !== null)
    })
    return () => {
      cancelled = true
    }
  }, [clockDevices, configs, profiles])

  // A queued section jump (#479): the clock ticks on across it and tells the gear the new position.
  const jump = useShowStateStore((state) => state.state.playbackJump ?? null)
  const inputRef = useRef<MidiClockInput>({
    timeline,
    transport: NOT_PLAYING,
    takeKey: null,
  })
  inputRef.current = {
    timeline,
    transport: mode === 'gig' ? { status, startedAt, accumulatedMs } : NOT_PLAYING,
    takeKey: mode === 'gig' ? takeKey : null,
    jump: mode === 'gig' && jump ? { at: jump.at, toMs: jump.toMs } : null,
  }

  const active = clockDevices.length > 0
  useEffect(() => {
    if (!active) return
    const engine = new MidiClockEngine(getServerTime)
    const timer = setInterval(() => engine.tick(inputRef.current, outputsRef.current), CLOCK_TICK_MS)
    return () => {
      clearInterval(timer)
      engine.stop(outputsRef.current)
    }
  }, [active])
}

import { useEffect, useMemo, useRef } from 'react'
import { CAPABILITIES } from 'shared-types'
import { create } from 'zustand'
import { announcementsDue, sectionAnnouncements, type Announcement } from './announcements'
import { createAudioClock } from './audioClock'
import { clickTimeline } from './beatGrid'
import { pluginProviding } from './capabilities'
import { useAudioOutputLatencyMs } from './latencyCompensation'
import { getLoopPlaybackState } from './loopTrainerEngine'
import { adjustedBpm } from './metronome'
import { getSharedAudioContext } from './sharedAudioContext'
import { useShowModeSong } from './showMode'
import { loadSpeechClip, speechClip } from './speechClips'
import { bandAnnouncementSettings, bandSpeechVoice } from './speechVoices'
import { useCapabilityRouting } from './useCapabilityRouting'
import { usePluginsStore } from '../store/usePluginsStore'
import { useShowStateStore } from '../store/useShowStateStore'

const SWITCH_KEY = 'sb:audio:announcements'

/** Per device: spoken announcements on (default) or off - the drummer may not want them. */
export const useAnnouncementsSwitchStore = create<{ on: boolean; set: (on: boolean) => void }>((set) => ({
  on: (() => {
    try {
      return localStorage.getItem(SWITCH_KEY) !== '0'
    } catch {
      return true
    }
  })(),
  set: (on) => {
    try {
      localStorage.setItem(SWITCH_KEY, on ? '1' : '0')
    } catch {
      // Blocked storage: applies until the app is reloaded.
    }
    set({ on })
  },
}))

const TICK_MS = 50
/** Same window as the click (clickEngine.ts), widened by the output latency. */
const LOOKAHEAD_MS = 150

/**
 * Spoken section announcements (#63): "Chorus", "Bridge" a bar before the part, on the device
 * that plays the click - into the same output, so whoever hears the click hears them (until the
 * audio-output routing of docs/21 §9 lets them go to a channel of their own). Needs the
 * section-announcements plugin, and the Stage-Server's piper-speech plugin for the voice; without
 * a clip an announcement is simply skipped. Scheduled on the shared AudioContext like the click,
 * the same latency earlier, so the word starts on the downbeat.
 */
export function useAnnouncementDriver(): void {
  const { mode, queue, playbackStatus, elapsedNow } = useShowModeSong()
  const installed = usePluginsStore((state) => state.installed)
  const enabledHere = useAnnouncementsSwitchStore((state) => state.on)
  const { engine } = useCapabilityRouting(CAPABILITIES.clickTrack, mode)
  const liveTempoAdjustPercent = useShowStateStore((state) => state.state.liveTempoAdjustPercent)
  const takeKey = useShowStateStore((state) => state.state.activeEntryStartedAt)
  const outputLatencyMs = useAudioOutputLatencyMs()

  const voice = useMemo(() => bandSpeechVoice(installed), [installed])
  const settings = useMemo(() => bandAnnouncementSettings(installed), [installed])
  const active = pluginProviding(installed, CAPABILITIES.sectionAnnouncements) !== null && enabledHere && engine === 'local-mine'

  const variant = queue.currentVariant
  const nextVariant = queue.nextVariant
  const bpm = variant ? adjustedBpm(variant.bpm, mode === 'gig' ? liveTempoAdjustPercent : 0) : null
  const items: Announcement[] = useMemo(() => {
    if (!variant || bpm === null) return []
    const countInBars = variant.countInEnabled ? (variant.countInBars ?? 0) : 0
    return sectionAnnouncements(variant.chordProContent, clickTimeline({ beatGrid: variant.beatGrid, bpm, timeSignature: variant.timeSignature, countInBars }), settings)
  }, [variant, bpm, settings])

  // Clips ahead of time: this song's, and the next one's.
  useEffect(() => {
    if (!active) return
    const wanted = new Set(items.map((item) => item.text))
    if (nextVariant) {
      const nextTimeline = clickTimeline({ bpm: nextVariant.bpm, timeSignature: nextVariant.timeSignature, beatGrid: nextVariant.beatGrid })
      for (const part of sectionAnnouncements(nextVariant.chordProContent, nextTimeline, settings)) wanted.add(part.text)
    }
    for (const text of wanted) void loadSpeechClip(text, voice)
  }, [active, items, nextVariant, voice, settings])

  const latest = useRef({ items, elapsedNow, outputLatencyMs, voice })
  latest.current = { items, elapsedNow, outputLatencyMs, voice }

  const playing = active && playbackStatus === 'playing'
  useEffect(() => {
    if (!playing) return
    const ctx = getSharedAudioContext()
    const audioClock = createAudioClock()
    let done = new Set<number>()
    let lastElapsed: number | null = null
    let pending: { node: AudioBufferSourceNode; when: number }[] = []
    let last: { node: AudioBufferSourceNode; gain: GainNode; when: number } | null = null
    const cancelPending = () => {
      for (const { node, when } of pending) if (when > ctx.currentTime) node.stop()
      pending = []
    }
    const tick = () => {
      const { items: current, elapsedNow: now, outputLatencyMs: latencyMs, voice: currentVoice } = latest.current
      const elapsed = now()
      if (elapsed === null || document.visibilityState === 'hidden') return
      // A seek, a loop wrap or a stall: start over from here, drop words queued for the old position.
      if (lastElapsed !== null && (elapsed < lastElapsed - 50 || elapsed > lastElapsed + 1000)) {
        cancelPending()
        done = new Set()
      }
      lastElapsed = elapsed
      const rate = getLoopPlaybackState()?.rate ?? 1
      const audioNow = audioClock.now(ctx)
      for (const { index, inMs } of announcementsDue(current, elapsed, (LOOKAHEAD_MS + latencyMs) * rate, done)) {
        const buffer = speechClip(current[index]!.text, currentVoice)
        if (!buffer) continue
        const when = Math.max(ctx.currentTime, audioNow + inMs / 1000 / rate - latencyMs / 1000)
        const node = ctx.createBufferSource()
        node.buffer = buffer
        const gain = ctx.createGain()
        node.connect(gain).connect(ctx.destination)
        node.start(when)
        // A word longer than its beat (a fast song) gives way to the next one with a short fade,
        // so countdown numbers never pile up.
        if (last && last.when < when) {
          last.gain.gain.setTargetAtTime(0, when, 0.005)
          last.node.stop(when + 0.03)
        }
        last = { node, gain, when }
        pending = [...pending.filter((p) => p.when > ctx.currentTime), { node, when }]
      }
    }
    tick()
    const timer = setInterval(tick, TICK_MS)
    return () => {
      clearInterval(timer)
      cancelPending()
    }
  }, [playing, takeKey, items])
}

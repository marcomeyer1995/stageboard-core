import { useEffect, useMemo, useRef, useState } from 'react'
import { CAPABILITIES, mapPlays, SERVER_EXECUTION_TARGET } from 'shared-types'
import { create } from 'zustand'
import { announcementsDue, fitAnnouncements, sectionAnnouncements, type Announcement } from './announcements'
import { sharedAudioClock } from './audioClock'
import { clickTimeline } from './beatGrid'
import { pluginProviding } from './capabilities'
import { useAudioOutputLatencyMs } from './latencyCompensation'
import { adjustedBpm } from './metronome'
import { getSharedAudioContext } from './sharedAudioContext'
import { useShowModeSong } from './showMode'
import { loadSpeechClip, speechClip, type ClipVoice } from './speechClips'
import { useNativeAnnouncements, wantsNativeVoice } from './engine/nativeEngineVoice'
import { alignsOnVowel, MAX_ONSET_MS, vowelOnsetMs } from './engine/announcementClip'
import { bandAnnouncementSettings, bandSpeechVoice } from './speechVoices'
import { useCapabilityRouting } from './useCapabilityRouting'
import { resolveBuiltInBinding } from './hardwareRouting'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useStageMapStore } from '../store/useStageMapStore'
import { sourceOutput } from './audioMix'
import { playbackLookup } from './playbackCues'
import { usePracticeStateStore } from '../store/usePracticeStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

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
  // The loop trainer's speed (#683) - Solo only, 1 in the Gig.
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const practiceRate = usePracticeStateStore((state) => state.byWorkspace[workspaceId]?.playbackRate ?? 1)
  const playbackRate = mode === 'practice' ? practiceRate : 1
  const installed = usePluginsStore((state) => state.installed)
  const enabledHere = useAnnouncementsSwitchStore((state) => state.on)
  const { engine: clickEngine } = useCapabilityRouting(CAPABILITIES.clickTrack, mode)
  // Bühnentechnik → Ansagen (Marco, 2026-10-16): a chosen tablet speaks them in Gig; without one
  // they come with the click, as before.
  const deviceId = useShowStateStore((state) => state.deviceId)
  // Several tablets may speak them (one role each) - the role naming this one counts here.
  const logicalDevices = useLogicalDevicesStore((state) => state.devices)
  const announcementRole = resolveBuiltInBinding(logicalDevices, CAPABILITIES.sectionAnnouncements, deviceId)
  const ownTarget = mode === 'gig' && announcementRole?.executionTarget && announcementRole.executionTarget !== SERVER_EXECUTION_TARGET ? announcementRole.executionTarget : null
  // The stage map decides in the Gig (docs/31 §6 step 2): Ansagen where the device's matrix routes them.
  const mapSays = useStageMapStore((state) => (state.loaded ? mapPlays(state, deviceId, CAPABILITIES.sectionAnnouncements, state.front) : null))
  const engine = mode === 'gig' && mapSays !== null ? (mapSays ? 'local-mine' : 'local-other') : ownTarget ? (ownTarget === deviceId ? 'local-mine' : 'local-other') : clickEngine
  const liveTempoAdjustPercent = useShowStateStore((state) => state.state.liveTempoAdjustPercent)
  const takeKey = useShowStateStore((state) => state.state.activeEntryStartedAt)
  const outputLatencyMs = useAudioOutputLatencyMs()

  const voice = useMemo(() => bandSpeechVoice(installed), [installed])
  const settings = useMemo(() => bandAnnouncementSettings(installed), [installed])
  const [loaded, setLoaded] = useState(0)
  const active = pluginProviding(installed, CAPABILITIES.sectionAnnouncements) !== null && enabledHere && engine === 'local-mine'

  const variant = queue.currentVariant
  const nextVariant = queue.nextVariant
  const bpm = variant ? adjustedBpm(variant.bpm, mode === 'gig' ? liveTempoAdjustPercent : 0) : null
  const items: Announcement[] = useMemo(() => {
    if (!variant || bpm === null) return []
    const countInBars = variant.countInEnabled ? (variant.countInBars ?? 0) : 0
    // "Ansagen aus" cues (#485) silence the words in their stretch.
    const at = playbackLookup(variant.cues ?? [])
    return sectionAnnouncements(variant.chordProContent, clickTimeline({ beatGrid: variant.beatGrid, bpm, timeSignature: variant.timeSignature, countInBars }), settings).filter((item) => at(item.atMs).voice)
  }, [variant, bpm, settings])

  // Clips ahead of time: this song's, and the next one's.
  useEffect(() => {
    if (!active) return
    const wanted = new Set(items.map((item) => item.text))
    if (nextVariant) {
      const nextTimeline = clickTimeline({ bpm: nextVariant.bpm, timeSignature: nextVariant.timeSignature, beatGrid: nextVariant.beatGrid })
      for (const part of sectionAnnouncements(nextVariant.chordProContent, nextTimeline, settings)) wanted.add(part.text)
    }
    // Each loaded clip's length lets the words be fitted between the beats.
    let live = true
    for (const text of wanted) void loadSpeechClip(text, voice).then(() => live && setLoaded((n) => n + 1))
    return () => {
      live = false
    }
  }, [active, items, nextVariant, voice, settings])

  // Words too long for their beat spoken faster, or a name over the next number (#842).
  const fitted = useMemo(
    () =>
      fitAnnouncements(
        items,
        (text) => {
          const clip = speechClip(text, voice)
          return clip ? clip.duration * 1000 : null
        },
        voice.speed ?? 1,
        (text) => {
          const clip = alignsOnVowel() ? speechClip(text, voice) : null
          return clip ? vowelOnsetMs(clip) : 0
        },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `loaded` counts the clips that came in
    [items, voice, loaded],
  )
  useEffect(() => {
    if (!active) return
    for (const item of fitted) if (item.speed) void loadSpeechClip(item.text, { ...voice, speed: item.speed })
  }, [active, fitted, voice])

  // From the engine while the native output plays (#835) - then the WebView stays quiet.
  const inEngine = useNativeAnnouncements(active && wantsNativeVoice() ? fitted : null, voice)
  usePlayAnnouncements(fitted, voice, active && !inEngine && playbackStatus === 'playing', elapsedNow, outputLatencyMs, takeKey, playbackRate)
}

/**
 * Plays `items` against a song clock while `playing` (#63): each word scheduled on the shared
 * AudioContext `outputLatencyMs` early, so it is heard on its beat. Shared by the show driver
 * above and the Timeline editor's preview. `resetKey` changes for a new take.
 */
export function usePlayAnnouncements(
  items: Announcement[],
  voice: ClipVoice,
  playing: boolean,
  elapsedNow: () => number | null,
  outputLatencyMs: number,
  resetKey: unknown = null,
  /** Song ms per wall ms when slowed down (the loop trainer, #683); unset: 1. */
  playbackRate?: number,
): void {
  const latest = useRef({ items, elapsedNow, outputLatencyMs, voice, playbackRate })
  latest.current = { items, elapsedNow, outputLatencyMs, voice, playbackRate }
  useEffect(() => {
    // Nothing to say: no AudioContext needed (the Timeline plays its track on an <audio> element).
    if (!playing || items.length === 0) return
    const ctx = getSharedAudioContext()
    const audioClock = sharedAudioClock
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
      const rate = latest.current.playbackRate ?? 1
      const audioNow = audioClock.now(ctx)
      for (const { index, inMs } of announcementsDue(current, elapsed, (LOOKAHEAD_MS + latencyMs + MAX_ONSET_MS) * rate, done)) {
        const item = current[index]!
        const buffer = speechClip(item.text, item.speed ? { ...currentVoice, speed: item.speed } : currentVoice)
        if (!buffer) continue
        // The vowel on the beat, not the clip's first sample (#842).
        const onset = alignsOnVowel() ? vowelOnsetMs(buffer) / 1000 : 0
        const when = Math.max(ctx.currentTime, audioNow + inMs / 1000 / rate - latencyMs / 1000 - onset)
        const node = ctx.createBufferSource()
        node.buffer = buffer
        const gain = ctx.createGain()
        node.connect(gain).connect(sourceOutput('voice', ctx))
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
  }, [playing, resetKey, items])
}

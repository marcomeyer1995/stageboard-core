import { useEffect, useMemo, useRef, useState } from 'react'
import type { Announcement } from '../announcements'
import { alignsOnVowel, announcementClip } from './announcementClip'
import { mixGain, useOutputPlanStore } from '../audioMix'
import { getServerTime } from '../clockSync'
import { useAudioOutputLatencyMs } from '../latencyCompensation'
import { nativeEngine, useNativeOutputStore } from '../nativeOutput'
import { useShowModeCore } from '../showMode'
import { loadSpeechClip, type ClipVoice } from '../speechClips'
import { acquireNativeEngine, feedsOf, releaseNativeEngine, sendNativeOffset, sendNativeTransport } from './nativeEngineSession'
import { ENGINE_BUS } from './wasmEngine'

/**
 * The spoken announcements from the engine core in the native output's callback (#835): a song's
 * words go to the engine once, as one clip placed on the song (engine SparseClip) - on the
 * announcement bus, so through the engine's limiter (200 % clipped hard through the pipe), and on
 * the same clock as click and track; they go on while the page is frozen on a locked screen. On
 * while the native output plays (`sb:debug:native-voice` = 0 switches it off); meanwhile the
 * WebView doesn't speak them.
 */

/** The clip id the announcements use (the track has 0). */
export const ANNOUNCE_CLIP = 1
const UPDATE_MS = 1000
const POLL_MS = 50

export function wantsNativeVoice(): boolean {
  try {
    return localStorage.getItem('sb:debug:native-voice') !== '0'
  } catch {
    return true
  }
}

/**
 * Plays `items` from the engine while `items` is given and the native output runs. True once the
 * engine has them - the WebView then stays quiet. A new song or voice sends them again.
 */
export function useNativeAnnouncements(items: Announcement[] | null, voice: ClipVoice): boolean {
  const { mode, transport } = useShowModeCore()
  const nativeOn = useNativeOutputStore((s) => s.state === 'on')
  const [readyFor, setReadyFor] = useState<string | null>(null)
  const outputLatencyMs = useAudioOutputLatencyMs()
  const stateRef = useRef({ transport, mode, outputLatencyMs })
  stateRef.current = { transport, mode, outputLatencyMs }
  const wanted = items !== null && items.length > 0 && nativeOn
  // By what is said when, not by the list's identity: it is rebuilt on unrelated changes (Play
  // rebuilt it - sent again, the count-in's first word got lost while the clip was replaced).
  const key = useMemo(() => (items ? JSON.stringify([voice.voice ?? '', voice.speed ?? 1, items.map((item) => [item.text, item.atMs, item.speed ?? 1])]) : null), [items, voice])
  const latest = useRef({ items, voice })
  latest.current = { items, voice }

  useEffect(() => {
    if (!wanted || key === null) return
    let cancelled = false
    void (async () => {
      const { items: current, voice: currentVoice } = latest.current
      if (!current) return
      const voiceOf = (item: Announcement): ClipVoice => (item.speed ? { ...currentVoice, speed: item.speed } : currentVoice)
      const buffers = new Map<string, AudioBuffer | null>()
      const keyOf = (item: Announcement) => `${item.speed ?? ''}|${item.text}`
      for (const item of current) if (!buffers.has(keyOf(item))) buffers.set(keyOf(item), await loadSpeechClip(item.text, voiceOf(item)))
      if (cancelled) return
      const clip = announcementClip(current, (item) => buffers.get(keyOf(item)) ?? null, alignsOnVowel())
      if (!clip) return
      const { error } = await nativeEngine.announceCommit(ANNOUNCE_CLIP, clip, ENGINE_BUS.announce, 1).catch((e: unknown) => ({ error: String(e) }))
      if (cancelled) return
      if (error) console.warn(`[native-voice] announcements not in the engine: ${error}`)
      else setReadyFor(key)
    })()
    return () => {
      cancelled = true
      setReadyFor(null)
      nativeEngine.clipRemove(ANNOUNCE_CLIP)
    }
  }, [wanted, key])

  const active = wanted && readyFor === key
  useEffect(() => {
    if (!active) return
    acquireNativeEngine('voice')
    const transportNow = () => (stateRef.current.mode === 'practice' ? Date.now() : getServerTime())
    const update = () => {
      sendNativeOffset(transportNow, stateRef.current.outputLatencyMs)
      nativeEngine.gain(ENGINE_BUS.announce, mixGain('voice'))
      const [left, right] = feedsOf(useOutputPlanStore.getState().plan.voice)
      nativeEngine.feeds(ENGINE_BUS.announce, left, right)
    }
    update()
    sendNativeTransport(stateRef.current.transport)
    const poll = setInterval(() => sendNativeTransport(stateRef.current.transport), POLL_MS)
    const slow = setInterval(update, UPDATE_MS)
    return () => {
      clearInterval(poll)
      clearInterval(slow)
      releaseNativeEngine('voice')
    }
  }, [active])
  return active
}

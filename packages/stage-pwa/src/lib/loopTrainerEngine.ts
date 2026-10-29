import { passRates, passStartSec, positionAt, type LoopPosition, type LoopSpeedConfig } from './loopSchedule'
import type { LocalAudioResult } from './localAudioEngine'
import { sourceOutput } from './audioMix'

/** A loop shorter than this is not worth (and not safe) looping gaplessly. */
const MIN_LOOP_MS = 500
/** Head start before the first sample, so the rate automation below is fully in place. */
const START_DELAY_S = 0.1

interface LoopRun {
  source: AudioBufferSourceNode
  node: AudioNode
  /** `AudioContext.currentTime` at which the loop's first sample plays. */
  startedAtSec: number
  rates: number[]
  lengthMs: number
  startMs: number
  endMs: number
}

/**
 * The Rehearsal Looper's playback engine (#61): loops one section of a decoded backing track
 * gaplessly with Web Audio and time-stretches it (SoundTouch, pitch preserved) for the Speed
 * Trainer. Separate from localAudioEngine.ts's `<audio>` element on purpose - an element can
 * only seek, which leaves an audible gap at the loop point, and its playbackRate cannot be
 * changed sample-accurately per pass.
 *
 * Only the section is kept in memory (the full track is decoded once, sliced, and dropped), so
 * a 15 s solo costs a few MB however long the song is.
 *
 * The SoundTouch worklet is imported lazily: it is only ever needed once someone starts a
 * loop, and `AudioWorkletNode` does not even exist at module-load time in tests.
 */
let audioContext: AudioContext | null = null
let processorRegistered = false
let run: LoopRun | null = null
/** Bumped by every start and stop: a start still loading when another start or a stop comes in
 * must not begin playing afterwards - it would sound on with nothing left to stop it (Fire,
 * 2026-10-21: a second tap during the seconds-long decode left the first loop unstoppable). */
let generation = 0

/** A start that a newer start or a stop overtook while it was loading. */
export interface LoopCancelled {
  status: 'cancelled'
}

function getAudioContext(): AudioContext {
  if (!audioContext) audioContext = new AudioContext()
  return audioContext
}

export interface LoopStartOptions {
  blob: Blob
  startMs: number
  endMs: number
  speed: LoopSpeedConfig
}

/** Starts (or restarts) the loop. Must be called from a user gesture - the AudioContext may
 * otherwise stay suspended under the browser's autoplay policy. */
export async function startLoopEngine(options: LoopStartOptions): Promise<LocalAudioResult | LoopCancelled> {
  stopLoopEngine()
  const mine = generation
  const lengthMs = options.endMs - options.startMs
  if (lengthMs < MIN_LOOP_MS) return { status: 'error', message: 'Der Loop ist zu kurz' }

  try {
    const ctx = getAudioContext()
    await ctx.resume()
    const [{ SoundTouchNode }, { default: processorUrl }] = await Promise.all([
      import('@soundtouchjs/audio-worklet'),
      import('@soundtouchjs/audio-worklet/processor?url'),
    ])
    if (!processorRegistered) {
      await SoundTouchNode.register(ctx, processorUrl)
      processorRegistered = true
    }

    const decoded = await ctx.decodeAudioData(await options.blob.arrayBuffer())
    if (mine !== generation) return { status: 'cancelled' }
    const firstFrame = Math.floor((options.startMs / 1000) * decoded.sampleRate)
    const lastFrame = Math.min(decoded.length, Math.ceil((options.endMs / 1000) * decoded.sampleRate))
    if (lastFrame - firstFrame < 1) return { status: 'error', message: 'Der Loop liegt außerhalb des Tracks' }
    const section = ctx.createBuffer(decoded.numberOfChannels, lastFrame - firstFrame, decoded.sampleRate)
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      section.copyToChannel(decoded.getChannelData(channel).subarray(firstFrame, lastFrame), channel)
    }

    const rates = passRates(options.speed)
    const sectionMs = section.duration * 1000
    const source = ctx.createBufferSource()
    source.buffer = section
    source.loop = true
    source.loopStart = 0
    source.loopEnd = section.duration
    const stretch = new SoundTouchNode({ context: ctx })
    source.connect(stretch)
    stretch.connect(sourceOutput('track', ctx))

    // The source resamples by `rate` (tempo AND pitch change), the worklet gets the same value and
    // undoes the pitch part - net effect: slower/faster with the original pitch. Every pass
    // boundary's rate change is scheduled up front at its exact sample time.
    const startedAtSec = ctx.currentTime + START_DELAY_S
    rates.forEach((rate, pass) => {
      const at = startedAtSec + passStartSec(rates, sectionMs, pass)
      source.playbackRate.setValueAtTime(rate, at)
      stretch.playbackRate.setValueAtTime(rate, at)
    })
    source.playbackRate.setValueAtTime(rates[0], 0)
    stretch.playbackRate.setValueAtTime(rates[0], 0)
    source.start(startedAtSec)

    run = { source, node: stretch, startedAtSec, rates, lengthMs: sectionMs, startMs: options.startMs, endMs: options.endMs }
    return { status: 'ok' }
  } catch (error) {
    if (mine !== generation) return { status: 'cancelled' }
    stopLoopEngine()
    return { status: 'error', message: error instanceof Error ? error.message : 'Loop konnte nicht gestartet werden' }
  }
}

export function stopLoopEngine(): void {
  generation++
  if (!run) return
  try {
    run.source.stop()
  } catch {
    // Never started or already stopped - nothing to undo.
  }
  run.source.disconnect()
  run.node.disconnect()
  run = null
}

export interface LoopPlaybackState extends LoopPosition {
  /** Position in the song (loop start + offset), the value every clock consumer reads. */
  positionMs: number
  startMs: number
  endMs: number
}

/** Where the running loop is right now, or null when none is running. Derived from the same
 * schedule the rate changes were queued from, so it stays exact across passes. */
export function getLoopPlaybackState(): LoopPlaybackState | null {
  if (!run) return null
  const wallSec = getAudioContext().currentTime - run.startedAtSec
  const position = positionAt(run.rates, run.lengthMs, wallSec)
  return { ...position, positionMs: run.startMs + position.offsetMs, startMs: run.startMs, endMs: run.endMs }
}

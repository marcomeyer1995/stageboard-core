import { createAudioClock } from './audioClock'
import { sourceOutput } from './audioMix'
import { getSharedAudioContext } from './sharedAudioContext'
import { getTrack } from './songVariantsDb'
import { openTrackStream, type TrackStream } from './trackStream'

/**
 * Stems played together, live mixed on this device (docs/22 §3, Solo practice). Every stem is
 * streamed and decoded piece by piece (trackStream.ts, as the Gig's Web Audio track engine does),
 * and all of them are scheduled against one shared start on the click's AudioContext - so they
 * stay sample-exactly together, which separate `<audio>` elements (each with its own 0-620 ms
 * start stall, docs/19) could not. Each stem has its own gain node (level, Stumm, Solo); their sum
 * goes through "Mein Mix"'s track slider (audioMix.ts).
 *
 * A stem that can't be streamed on this device is decoded whole (`decodeAudioData`) - several
 * minutes of float audio per stem, so only as a fallback.
 */

/** How far ahead a start is scheduled - every stem's first piece must be decoded by then. */
const LEAD_S = 0.4
/** Decoded audio is scheduled this far ahead of what plays. */
const AHEAD_S = 4
/** Decoded pieces are joined to about this length before scheduling. */
const CHUNK_S = 0.5
/** A position error above this (seek, pause/resume, a stalled tab) restarts the stems at the
 * right position - confirmed by two readings in a row, as in webAudioTrackEngine.ts. */
const RESCHEDULE_ERROR_S = 0.08
const RESCHEDULE_CONFIRMATIONS = 2
/** Short fades so a start mid-file, a stop or a gain change never cracks. */
const FADE_S = 0.02
const MIN_SYNC_INTERVAL_MS = 40
/** The first seconds of every stem, decoded while loading - so Play from the start doesn't wait
 * for 4-7 decoders to open and seek: on the Fire the first 60-120 ms of the song were cut off
 * without it (2026-10-15). Same as the Gig engine's head (webAudioTrackEngine.ts). */
const HEAD_S = 1.5

interface Piece {
  buffer: AudioBuffer
  timestamp: number
}

type Source = { kind: 'stream'; stream: TrackStream; head: Piece | null } | { kind: 'buffer'; buffer: AudioBuffer }

interface Loaded {
  /** variantId + the stems' ids - what `loadStems` was called with. */
  key: string
  stems: Map<string, Source>
  durationS: number
  gains: Map<string, GainNode>
  bus: GainNode
}

interface Layer {
  nodes: Set<AudioBufferSourceNode>
  scheduledUntil: number
  feeder: { cancelled: boolean }
}

/** One start of all stems: song position `anchorPos` plays at audio time `anchorTime`. Each stem
 * plays through its own fade (sources → fade → the stem's gain → bus), so a restart crossfades
 * while the stem gains stay put. */
interface Run {
  key: string
  anchorTime: number
  anchorPos: number
  fades: GainNode[]
  layers: Layer[]
}

let loaded: Loaded | null = null
let loading: { key: string; cancelled: boolean } | null = null
let run: Run | null = null
let gainsWanted = new Map<string, number>()
let lastSyncAt = -Infinity
let suspect = 0
const clock = createAudioClock()

/** What the engine did, for measuring over USB (window.__sbStems). */
const stats = {
  loadMs: null as number | null,
  kinds: [] as string[],
  starts: 0,
  late: 0,
  reschedules: 0,
  lastErrorMs: 0,
}
if (typeof window !== 'undefined') (window as unknown as { __sbStems: typeof stats }).__sbStems = stats

function stemKey(variantId: string, trackIds: readonly string[]): string {
  return `${variantId}:${[...trackIds].sort().join(',')}`
}

function dispose(l: Loaded): void {
  for (const source of l.stems.values()) if (source.kind === 'stream') source.stream.dispose()
  l.bus.disconnect()
}

/**
 * Makes these stems the ones to play; resolves `true` once all of them are ready. Loading the same
 * set again is free. Fetches each stem from the Stage-Server on first use (then cached locally).
 */
export async function loadStems(variantId: string, trackIds: readonly string[]): Promise<boolean> {
  const key = stemKey(variantId, trackIds)
  if (loaded?.key === key) return true
  if (loading?.key === key) {
    while (loading?.key === key) await new Promise((resolve) => setTimeout(resolve, 50))
    return loaded?.key === key
  }
  if (loading) loading.cancelled = true
  const job = { key, cancelled: false }
  loading = job
  const started = performance.now()
  const ctx = getSharedAudioContext()
  const stems = new Map<string, Source>()
  const disposeAll = () => {
    for (const source of stems.values()) if (source.kind === 'stream') source.stream.dispose()
  }
  try {
    // One after the other - in parallel, decoders slowed each other down (webAudioTrackEngine.ts).
    for (const trackId of trackIds) {
      const blob = await getTrack(variantId, trackId)
      if (job.cancelled) break
      if (!blob) throw new Error(`Spur ${trackId} nicht gefunden`)
      const stream = await openTrackStream(blob)
      if (stream) stems.set(trackId, { kind: 'stream', stream, head: await decodeHead(ctx, stream, job) })
      else
        stems.set(trackId, {
          kind: 'buffer',
          buffer: await ctx.decodeAudioData(await blob.arrayBuffer()),
        })
      if (job.cancelled) break
    }
    if (job.cancelled) {
      disposeAll()
      return false
    }
  } catch {
    disposeAll()
    if (loading === job) loading = null
    return false
  }
  stopRun()
  if (loaded) dispose(loaded)
  const bus = ctx.createGain()
  bus.connect(sourceOutput('track', ctx))
  const gains = new Map<string, GainNode>()
  for (const trackId of trackIds) {
    const gain = ctx.createGain()
    gain.gain.value = gainsWanted.get(trackId) ?? 1
    gain.connect(bus)
    gains.set(trackId, gain)
  }
  const durations = [...stems.values()].map((s) => (s.kind === 'stream' ? s.stream.durationS : s.buffer.duration))
  loaded = { key, stems, durationS: Math.max(0, ...durations), gains, bus }
  stats.loadMs = Math.round(performance.now() - started)
  stats.kinds = [...stems.values()].map((s) => s.kind)
  if (loading === job) loading = null
  return true
}

export function unloadStems(): void {
  if (loading) loading.cancelled = true
  loading = null
  stopRun()
  if (loaded) dispose(loaded)
  loaded = null
}

/** Each stem's gain (level, 0 when muted or another stem is soloed) - applied at once, also mid-song. */
export function setStemGains(gains: ReadonlyMap<string, number>): void {
  gainsWanted = new Map(gains)
  if (!loaded) return
  const ctx = getSharedAudioContext()
  for (const [trackId, gain] of loaded.gains) gain.gain.setTargetAtTime(gainsWanted.get(trackId) ?? 1, ctx.currentTime, FADE_S)
}

function stopRun(at?: number): void {
  if (!run) return
  const ctx = getSharedAudioContext()
  const t = Math.max(at ?? 0, ctx.currentTime)
  for (const fade of run.fades) fade.gain.setTargetAtTime(0, t, FADE_S / 3)
  for (const layer of run.layers) {
    layer.feeder.cancelled = true
    for (const node of layer.nodes) node.stop(t + FADE_S)
  }
  const fades = run.fades
  setTimeout(() => fades.forEach((fade) => fade.disconnect()), (t - ctx.currentTime + FADE_S * 4) * 1000 + 50)
  run = null
}

function join(ctx: AudioContext, pieces: Piece[]): Piece {
  if (pieces.length === 1) return pieces[0]
  const first = pieces[0].buffer
  const length = pieces.reduce((sum, piece) => sum + piece.buffer.length, 0)
  const joined = ctx.createBuffer(first.numberOfChannels, length, first.sampleRate)
  for (let channel = 0; channel < first.numberOfChannels; channel++) {
    let offset = 0
    for (const { buffer } of pieces) {
      joined.copyToChannel(buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1)), channel, offset)
      offset += buffer.length
    }
  }
  return { buffer: joined, timestamp: pieces[0].timestamp }
}

function schedule(ctx: AudioContext, r: Run, layer: Layer, out: AudioNode, piece: Piece): void {
  const { buffer, timestamp } = piece
  let offset = Math.max(0, layer.scheduledUntil - timestamp)
  if (offset >= buffer.duration) return
  let when = r.anchorTime + (timestamp + offset - r.anchorPos)
  const earliest = ctx.currentTime + 0.01
  if (when < earliest) {
    stats.late++
    offset += earliest - when
    when = earliest
    if (offset >= buffer.duration) {
      layer.scheduledUntil = timestamp + buffer.duration
      return
    }
  }
  const node = ctx.createBufferSource()
  node.buffer = buffer
  node.connect(out)
  node.onended = () => layer.nodes.delete(node)
  node.start(when, offset)
  layer.nodes.add(node)
  layer.scheduledUntil = timestamp + buffer.duration
}

/** Decodes the first HEAD_S of a stem. */
async function decodeHead(ctx: AudioContext, stream: TrackStream, job: { cancelled: boolean }): Promise<Piece | null> {
  const pieces: Piece[] = []
  let length = 0
  const iterator = stream.buffers(0)
  try {
    for await (const piece of iterator) {
      if (job.cancelled) return null
      pieces.push(piece)
      length += piece.buffer.duration
      if (length >= HEAD_S) break
    }
  } finally {
    await iterator.return(undefined)
  }
  return pieces.length ? join(ctx, pieces) : null
}

async function feed(ctx: AudioContext, r: Run, layer: Layer, out: AudioNode, stream: TrackStream): Promise<void> {
  const iterator = stream.buffers(layer.scheduledUntil)
  let pending: Piece[] = []
  let pendingLength = 0
  const flush = () => {
    if (!pending.length) return
    schedule(ctx, r, layer, out, join(ctx, pending))
    pending = []
    pendingLength = 0
  }
  try {
    for await (const piece of iterator) {
      if (layer.feeder.cancelled) return
      const last = pending[pending.length - 1]
      if (last && Math.abs(last.timestamp + last.buffer.duration - piece.timestamp) > 1 / piece.buffer.sampleRate) flush()
      pending.push(piece)
      pendingLength += piece.buffer.duration
      if (pendingLength < CHUNK_S) continue
      flush()
      const playing = () => r.anchorPos + (ctx.currentTime - r.anchorTime)
      while (!layer.feeder.cancelled && layer.scheduledUntil - playing() > AHEAD_S) await new Promise((resolve) => setTimeout(resolve, 200))
      if (layer.feeder.cancelled) return
    }
    flush()
  } finally {
    await iterator.return(undefined)
  }
}

/** Starts every stem so that song position `pos` plays at audio time `when`. */
function startRun(ctx: AudioContext, l: Loaded, when: number, pos: number): void {
  const anchorPos = Math.max(0, pos)
  const anchorTime = when + Math.max(0, -pos)
  if (anchorPos >= l.durationS) return
  const r: Run = { key: l.key, anchorTime, anchorPos, fades: [], layers: [] }
  run = r
  stats.starts++
  for (const [trackId, source] of l.stems) {
    const fade = ctx.createGain()
    // Fade in only when entering mid-song - a start at 0 begins with the song's own lead-in.
    fade.gain.setValueAtTime(anchorPos > 0 ? 0 : 1, anchorTime)
    if (anchorPos > 0) fade.gain.setTargetAtTime(1, anchorTime, FADE_S / 3)
    fade.connect(l.gains.get(trackId)!)
    r.fades.push(fade)
    const layer: Layer = {
      nodes: new Set(),
      scheduledUntil: anchorPos,
      feeder: { cancelled: false },
    }
    r.layers.push(layer)
    if (source.kind === 'buffer') schedule(ctx, r, layer, fade, { buffer: source.buffer, timestamp: 0 })
    else {
      // From the decoded head where it reaches, then streamed on from its end.
      const head = source.head
      if (head && anchorPos < head.timestamp + head.buffer.duration - LEAD_S) schedule(ctx, r, layer, fade, head)
      void feed(ctx, r, layer, fade, source.stream).catch(() => {})
    }
  }
}

/**
 * Called every frame while stems should play. `elapsedNow` reads the song time (null = stopped).
 * Returns whether the browser still blocks audio (needs a tap).
 */
export function syncStems(elapsedNow: () => number | null, shouldPlay: boolean): { blocked: boolean } {
  const ctx = getSharedAudioContext()
  if (!shouldPlay || !loaded) {
    stopRun()
    clock.reset()
    lastSyncAt = -Infinity
    suspect = 0
    return { blocked: false }
  }
  if (ctx.state !== 'running') {
    void ctx.resume()
    return { blocked: ctx.state === 'suspended' }
  }
  const wall = performance.now()
  if (run && wall - lastSyncAt < MIN_SYNC_INTERVAL_MS) return { blocked: false }
  lastSyncAt = wall
  const elapsedMs = elapsedNow()
  const now = clock.now(ctx)
  if (elapsedMs === null) {
    stopRun()
    return { blocked: false }
  }
  const songNow = elapsedMs / 1000
  if (run && run.key !== loaded.key) stopRun()
  if (!run) {
    if (songNow < -LEAD_S * 4) return { blocked: false }
    if (songNow < 0) startRun(ctx, loaded, now, songNow)
    else startRun(ctx, loaded, now + LEAD_S, songNow + LEAD_S)
    return { blocked: false }
  }
  const errorS = now < run.anchorTime ? run.anchorPos - (songNow + (run.anchorTime - now)) : run.anchorPos + (now - run.anchorTime) - songNow
  stats.lastErrorMs = Math.round(errorS * 1000)
  suspect = Math.abs(errorS) > RESCHEDULE_ERROR_S ? suspect + 1 : 0
  if (suspect >= RESCHEDULE_CONFIRMATIONS) {
    suspect = 0
    stats.reschedules++
    const at = now + LEAD_S
    stopRun(at)
    startRun(ctx, loaded, at, songNow + LEAD_S)
  }
  return { blocked: false }
}

/** Test-only. */
export function __stemStatsForTests(): typeof stats {
  return stats
}

/** Test-only: forget all state. */
export function __resetStemsForTests(): void {
  unloadStems()
  gainsWanted = new Map()
  lastSyncAt = -Infinity
  suspect = 0
  clock.reset()
  stats.starts = 0
  stats.reschedules = 0
  stats.late = 0
}

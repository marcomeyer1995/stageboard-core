import { createAudioClock } from './audioClock'
import type { LocalAudioResult } from './localAudioEngine'
import { getSharedAudioContext } from './sharedAudioContext'
import { getTrack } from './songVariantsDb'
import { openTrackStream, type TrackStream } from './trackStream'

/**
 * Backing track on the click's own audio clock (#468, prototype behind a per-device switch).
 *
 * The `<audio>` element (localAudioEngine.ts) can only be nudged from outside: after every start
 * or seek its position stood still for a variable 0-620 ms (Bluetooth on the S26+, the Xiaomi
 * ~490 ms), and every speed change reset part of its pipeline (2026-10-09). Here the track plays
 * on the same AudioContext as the click: every piece is scheduled for an exact audio-clock time,
 * so a start lands sample-exactly, and click and track share one clock and one output path.
 *
 * Streaming (2026-10-10): decoding a whole song first took 1.3-5.6 s on the Xiaomi, could not be
 * cancelled, and a fast skip waited for songs already skipped (7 s). Now the track is decoded in
 * pieces (trackStream.ts, any container mediabunny reads, any codec WebCodecs decodes) a few
 * seconds ahead of playback, the first seconds of the current and the next song are decoded in
 * advance, and a skipped song stops decoding at once. A track that can't be streamed on this
 * device falls back to decoding the whole file (`decodeAudioData`).
 */

/** How far ahead a (re)start inside a song is scheduled - the first piece must be decoded by then. */
const LEAD_S = 0.15
/** Same, when the position isn't decoded in advance (a jump, a start mid-song): open, seek, decode. */
const STREAM_LEAD_S = 0.4
/** During the count-in the track is scheduled this long before song time 0. */
const PREPARE_BEFORE_S = 1.5
/** Decoded audio is scheduled this far ahead of what plays. */
const AHEAD_S = 4
/** Decoded pieces (often 20 ms each) are joined to about this length before scheduling. */
const CHUNK_S = 0.5
/** The first seconds of the current and the next song, decoded before Play. */
const HEAD_S = 1.5
/** A position error above this is not drift but a jump (seek, clock-sync update, a stalled tab) -
 * the track restarts at the right position instead of slowly catching up. */
const RESCHEDULE_ERROR_S = 0.08
/** ... and only when two measurements in a row say so: a single reading can be off when the main
 * thread stalled between computing the song time and reading the audio clock (2026-10-09: 130-160 ms
 * stalls while the next song decoded, each one a false restart and a ~150 ms gap). */
const RESCHEDULE_CONFIRMATIONS = 2
/** Drift (tablet crystal vs server clock, a few ms per minute) is worked off over this long, at
 * most MAX_RATE_DEVIATION off normal speed - 0.1 % is 1.7 cents, inaudible. Unlike the `<audio>`
 * element's playbackRate, a source node's rate is a plain audio parameter: no pipeline reset. */
const RATE_TIME_CONSTANT_S = 8
const MAX_RATE_DEVIATION = 0.001
/** Rate changes smaller than this are not applied - keeps the rate still while in sync. */
const RATE_STEP = 0.00002
/** Short fades so a start mid-file or a stop never cracks. */
const FADE_S = 0.02
/** The engine is driven from a per-frame effect; it works at most this often (the click's tick rate). */
const MIN_SYNC_INTERVAL_MS = 40
/** Prepared tracks kept: previous, current and next song. */
const MAX_PREPARED = 3

const SWITCH_KEY = 'sb:audio:webaudio-track'

/** Whether this device plays the Gig backing track through Web Audio (the prototype switch). */
export function webAudioTrackEnabled(): boolean {
  try {
    return localStorage.getItem(SWITCH_KEY) === '1'
  } catch {
    return false
  }
}

export function setWebAudioTrackEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(SWITCH_KEY, '1')
    else localStorage.removeItem(SWITCH_KEY)
  } catch {
    // Private mode etc. - the switch then simply stays off.
  }
}

interface TrackRef {
  key: string
  variantId: string
  trackId: string
}

/** A track ready to play: streamed (with its first seconds decoded) or, as fallback, fully decoded. */
type Prepared =
  | { kind: 'stream'; key: string; stream: TrackStream; head: Piece | null; durationS: number }
  | { kind: 'buffer'; key: string; buffer: AudioBuffer; durationS: number }

interface Piece {
  buffer: AudioBuffer
  timestamp: number
}

/** song position → audio time, valid from `anchorPos` on. */
interface Segment {
  anchorTime: number
  anchorPos: number
  rate: number
}

interface Voice {
  key: string
  kind: Prepared['kind']
  gain: GainNode
  nodes: Set<AudioBufferSourceNode>
  /** The mapping for audio scheduled from `seg.anchorPos` on, and the one before it. */
  seg: Segment
  prev: Segment | null
  /** Song position up to which audio is scheduled. */
  scheduledUntil: number
  feeder: { cancelled: boolean } | null
}

/** Prepared tracks by key (variant:track) - audio is only ever played under its own key, never
 * under another song's (2026-10-09: skipping two songs fast and pressing Play played the previous
 * song's audio while the new one was still decoding). Insertion order = last use. */
const ready = new Map<string, Prepared>()
const failed = new Set<string>()
let wanted: TrackRef | null = null
let next: TrackRef | null = null
/** The one preparation running right now - wanted first, then next; one at a time, because in
 * parallel they slowed each other down (2026-10-09). */
let preparing: { key: string; cancelled: boolean } | null = null
const waiters = new Map<string, (() => void)[]>()
let voice: Voice | null = null
let lastSyncAt = -Infinity
let suspect = 0
const clock = createAudioClock()

/** What the prototype did, for measuring over USB (window.__sbWebAudioTrack). `trace` holds the
 * raw clock values of the first 4 s after each start. */
const stats = {
  prepares: [] as { key: string; kind: string; ms: number }[],
  starts: 0,
  lastStartMs: null as number | null,
  /** Per start: the song time when the engine decided, and the position it started from (0 = exact song start). */
  startLog: [] as { songMs: number; fromMs: number }[],
  late: 0,
  reschedules: [] as { at: number; errorMs: number }[],
  lastErrorMs: 0,
  rate: 1,
  trace: [] as { wall: number; raw: number; now: number; elapsedMs: number; errorMs: number | null }[],
  traceUntil: 0,
}
if (typeof window !== 'undefined') (window as unknown as { __sbWebAudioTrack: typeof stats }).__sbWebAudioTrack = stats

function ref(variantId: string, trackId: string): TrackRef {
  return { key: `${variantId}:${trackId}`, variantId, trackId }
}

function notify(key: string): void {
  for (const resolve of waiters.get(key) ?? []) resolve()
  waiters.delete(key)
}

function release(prepared: Prepared): void {
  if (prepared.kind === 'stream') prepared.stream.dispose()
}

function evict(): void {
  for (const [key, prepared] of ready) {
    if (ready.size <= MAX_PREPARED) break
    if (key === wanted?.key || key === next?.key || key === voice?.key) continue
    ready.delete(key)
    release(prepared)
  }
}

/** Joins contiguous decoded pieces into one buffer. */
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

/** Decodes up to `seconds` of audio from `fromS` - the head of a song, decoded before Play. */
async function decodeHead(ctx: AudioContext, stream: TrackStream, fromS: number, seconds: number, job: { cancelled: boolean }): Promise<Piece | null> {
  const pieces: Piece[] = []
  let length = 0
  const iterator = stream.buffers(fromS)
  try {
    for await (const piece of iterator) {
      if (job.cancelled) return null
      pieces.push(piece)
      length += piece.buffer.duration
      if (length >= seconds) break
    }
  } finally {
    await iterator.return(undefined)
  }
  return pieces.length ? join(ctx, pieces) : null
}

async function prepare(track: TrackRef, job: { cancelled: boolean }): Promise<Prepared | null> {
  const blob = await getTrack(track.variantId, track.trackId)
  if (!blob || job.cancelled) return null
  const ctx = getSharedAudioContext()
  const stream = await openTrackStream(blob)
  if (stream) {
    if (job.cancelled) {
      stream.dispose()
      return null
    }
    const head = await decodeHead(ctx, stream, 0, HEAD_S, job)
    if (job.cancelled) {
      stream.dispose()
      return null
    }
    return { kind: 'stream', key: track.key, stream, head, durationS: stream.durationS }
  }
  // Fallback: the whole file at once - slower to get ready, but plays anything the browser can.
  const buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
  return { kind: 'buffer', key: track.key, buffer, durationS: buffer.duration }
}

/** Starts the next preparation if none is running: the wanted track first, then the next song.
 * A preparation that is no longer wanted is cancelled. */
function pump(): void {
  if (preparing && preparing.key !== wanted?.key && preparing.key !== next?.key) preparing.cancelled = true
  if (preparing && !preparing.cancelled) return
  const track = [wanted, next].find((t): t is TrackRef => t !== null && !ready.has(t.key) && !failed.has(t.key) && t.key !== preparing?.key)
  if (!track) return
  const job = { key: track.key, cancelled: false }
  preparing = job
  const started = performance.now()
  void prepare(track, job)
    .then((prepared) => {
      if (prepared && !job.cancelled) {
        stats.prepares.push({ key: track.key, kind: prepared.kind, ms: Math.round(performance.now() - started) })
        ready.set(track.key, prepared)
        evict()
      } else if (!prepared && !job.cancelled) failed.add(track.key)
    })
    .catch(() => {
      if (!job.cancelled) failed.add(track.key)
    })
    .finally(() => {
      if (preparing === job) preparing = null
      notify(track.key)
      pump()
    })
}

function wantedPrepared(): Prepared | null {
  return wanted ? (ready.get(wanted.key) ?? null) : null
}

/** Makes this the current track; resolves once it is ready (or no longer wanted). Playback itself
 * is driven by `syncWebAudioTrack`, which starts the track at the right position as soon as it is
 * ready - also mid-song, if it gets ready after Play. */
export async function loadWebAudioTrack(variantId: string, trackId: string): Promise<LocalAudioResult> {
  const track = ref(variantId, trackId)
  if (wanted && wanted.key !== track.key && !ready.has(wanted.key)) notify(wanted.key)
  wanted = track
  failed.delete(track.key)
  const prepared = ready.get(track.key)
  if (prepared) {
    ready.delete(track.key)
    ready.set(track.key, prepared)
    pump()
    return { status: 'ok' }
  }
  const done = new Promise<void>((resolve) => waiters.set(track.key, [...(waiters.get(track.key) ?? []), resolve]))
  pump()
  await done
  if (wanted?.key !== track.key) return { status: 'ok' }
  return ready.has(track.key) ? { status: 'ok' } : { status: 'error', message: 'Kein Track gefunden' }
}

/** Prepares the next song (its first seconds decoded), so Play on it starts at once. */
export function preloadWebAudioTrack(variantId: string, trackId: string): void {
  next = ref(variantId, trackId)
  pump()
}

export function unloadWebAudioTrack(): void {
  wanted = null
  stopVoice()
  pump()
}

export function getWebAudioTrackDurationMs(): number | null {
  const prepared = wantedPrepared()
  return prepared ? prepared.durationS * 1000 : null
}

/** Audio time at which song position `pos` plays. */
function timeOf(v: Voice, pos: number): number {
  const seg = pos >= v.seg.anchorPos || !v.prev ? v.seg : v.prev
  return seg.anchorTime + (pos - seg.anchorPos) / seg.rate
}

/** Song position playing at audio time `t`. */
function posAt(v: Voice, t: number): number {
  const seg = t >= v.seg.anchorTime || !v.prev ? v.seg : v.prev
  return seg.anchorPos + (t - seg.anchorTime) * seg.rate
}

/** Fades the voice out from `at` (audio time, default now), stops its feeding and forgets it. */
function stopVoice(at?: number): void {
  if (!voice) return
  const ctx = getSharedAudioContext()
  const t = Math.max(at ?? 0, ctx.currentTime)
  if (voice.feeder) voice.feeder.cancelled = true
  voice.gain.gain.setTargetAtTime(0, t, FADE_S / 3)
  for (const node of voice.nodes) node.stop(t + FADE_S)
  voice = null
}

/** Schedules one piece on the voice, gaplessly after what is already scheduled. */
function schedule(ctx: AudioContext, v: Voice, piece: Piece): void {
  const { buffer, timestamp } = piece
  let offset = Math.max(0, v.scheduledUntil - timestamp)
  if (offset >= buffer.duration) return
  let when = timeOf(v, timestamp + offset)
  const earliest = ctx.currentTime + 0.01
  if (when < earliest) {
    // Decoded too late (it shouldn't, AHEAD_S is generous): skip the part that is already past.
    stats.late++
    offset += (earliest - when) * v.seg.rate
    when = earliest
    if (offset >= buffer.duration) {
      v.scheduledUntil = timestamp + buffer.duration
      return
    }
  }
  const node = ctx.createBufferSource()
  node.buffer = buffer
  node.playbackRate.value = timestamp + offset >= v.seg.anchorPos ? v.seg.rate : (v.prev?.rate ?? 1)
  node.connect(v.gain)
  node.onended = () => v.nodes.delete(node)
  node.start(when, offset)
  v.nodes.add(node)
  v.scheduledUntil = timestamp + buffer.duration
}

/** Feeds a streamed voice: decodes from `fromS` and keeps AHEAD_S scheduled ahead of playback. */
async function feed(ctx: AudioContext, v: Voice, stream: TrackStream, fromS: number): Promise<void> {
  const feeder = { cancelled: false }
  v.feeder = feeder
  const iterator = stream.buffers(fromS)
  let pending: Piece[] = []
  let pendingLength = 0
  const flush = () => {
    if (!pending.length) return
    schedule(ctx, v, join(ctx, pending))
    pending = []
    pendingLength = 0
  }
  try {
    for await (const piece of iterator) {
      if (feeder.cancelled) return
      const last = pending[pending.length - 1]
      // A gap in the decoded timestamps: schedule what we have, the next piece starts on its own.
      if (last && Math.abs(last.timestamp + last.buffer.duration - piece.timestamp) > 1 / piece.buffer.sampleRate) flush()
      pending.push(piece)
      pendingLength += piece.buffer.duration
      if (pendingLength < CHUNK_S) continue
      flush()
      while (!feeder.cancelled && v.scheduledUntil - posAt(v, ctx.currentTime) > AHEAD_S) await new Promise((resolve) => setTimeout(resolve, 200))
      if (feeder.cancelled) return
    }
    flush()
  } finally {
    await iterator.return(undefined)
  }
}

/** Starts `prepared` so that song position `startPos` plays at audio time `when`. */
function startVoice(ctx: AudioContext, prepared: Prepared, when: number, startPos: number): void {
  const pos = Math.max(0, startPos)
  const anchorTime = when + Math.max(0, -startPos)
  if (pos >= prepared.durationS) return
  const gain = ctx.createGain()
  // Fade in only when entering mid-song - a start at 0 begins with the track's own lead-in.
  gain.gain.setValueAtTime(pos > 0 ? 0 : 1, anchorTime)
  if (pos > 0) gain.gain.setTargetAtTime(1, anchorTime, FADE_S / 3)
  gain.connect(ctx.destination)
  const v: Voice = { key: prepared.key, kind: prepared.kind, gain, nodes: new Set(), seg: { anchorTime, anchorPos: pos, rate: 1 }, prev: null, scheduledUntil: pos, feeder: null }
  voice = v
  stats.starts++
  stats.lastStartMs = Math.round(pos * 1000)
  const logged = stats.startLog[stats.startLog.length - 1]
  if (logged && logged.fromMs === -1) logged.fromMs = stats.lastStartMs
  stats.traceUntil = performance.now() + 4000
  if (prepared.kind === 'buffer') {
    schedule(ctx, v, { buffer: prepared.buffer, timestamp: 0 })
    return
  }
  let from = pos
  if (prepared.head && pos < prepared.head.timestamp + prepared.head.buffer.duration - LEAD_S) {
    schedule(ctx, v, prepared.head)
    from = v.scheduledUntil
  }
  void feed(ctx, v, prepared.stream, from).catch(() => {})
}

/**
 * Called on every frame while this device is the Gig audio output. `elapsedNow` reads the synced
 * song time (null = stopped). Returns whether audio is blocked by the browser (the context couldn't
 * be resumed without a tap).
 */
export function syncWebAudioTrack(elapsedNow: () => number | null, shouldPlay: boolean): { blocked: boolean } {
  const ctx = getSharedAudioContext()
  const prepared = wantedPrepared()
  if (!shouldPlay || !prepared || !wanted) {
    stopVoice()
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
  if (voice && wall - lastSyncAt < MIN_SYNC_INTERVAL_MS) return { blocked: false }
  lastSyncAt = wall

  // Song time and audio clock read back to back - a song time computed earlier (at render) was
  // stale by the length of any main-thread stall in between.
  const elapsedMs = elapsedNow()
  const now = clock.now(ctx)
  if (elapsedMs === null) {
    stopVoice()
    return { blocked: false }
  }
  const songNow = elapsedMs / 1000
  if (voice && voice.key !== wanted.key) stopVoice()

  if (!voice) {
    if (songNow < -PREPARE_BEFORE_S) return { blocked: false }
    stats.startLog.push({ songMs: Math.round(songNow * 1000), fromMs: -1 }) // fromMs set by startVoice
    if (stats.startLog.length > 30) stats.startLog.shift()
    if (songNow < 0) startVoice(ctx, prepared, now, songNow) // count-in: lands exactly on song time 0
    else {
      const fromHead = prepared.kind === 'buffer' || (prepared.head && songNow + LEAD_S < prepared.head.timestamp + prepared.head.buffer.duration - LEAD_S)
      const lead = fromHead ? LEAD_S : STREAM_LEAD_S
      startVoice(ctx, prepared, now + lead, songNow + lead)
    }
    return { blocked: false }
  }

  const v = voice
  const firstTime = v.prev?.anchorTime ?? v.seg.anchorTime
  const firstPos = v.prev?.anchorPos ?? v.seg.anchorPos
  // Before the scheduled start: compare where it will start with where the song will be then.
  const errorS = now < firstTime ? firstPos - (songNow + (firstTime - now)) : posAt(v, now) - songNow
  stats.lastErrorMs = Math.round(errorS * 1000)
  if (wall < stats.traceUntil) {
    stats.trace.push({ wall: Date.now(), raw: ctx.currentTime, now, elapsedMs, errorMs: Math.round(errorS * 1000) })
    if (stats.trace.length > 600) stats.trace.splice(0, stats.trace.length - 600)
  }
  suspect = Math.abs(errorS) > RESCHEDULE_ERROR_S ? suspect + 1 : 0
  if (suspect >= RESCHEDULE_CONFIRMATIONS) {
    suspect = 0
    stats.reschedules.push({ at: Math.round(songNow * 1000), errorMs: Math.round(errorS * 1000) })
    // No gap: the old voice plays on until the new one comes in at the right position, crossfaded.
    const at = now + STREAM_LEAD_S
    stopVoice(at)
    startVoice(ctx, prepared, at, songNow + STREAM_LEAD_S)
    return { blocked: false }
  }
  if (suspect > 0 || now < firstTime) return { blocked: false }
  const rate = 1 - Math.max(-MAX_RATE_DEVIATION, Math.min(MAX_RATE_DEVIATION, errorS / RATE_TIME_CONSTANT_S))
  if (Math.abs(rate - v.seg.rate) < RATE_STEP) return { blocked: false }
  if (v.kind === 'buffer') {
    // One node plays the whole song: change its rate from now on.
    v.prev = null
    v.seg = { anchorTime: now, anchorPos: posAt(v, now), rate }
    for (const node of v.nodes) node.playbackRate.setValueAtTime(rate, Math.max(now, ctx.currentTime))
  } else if (now >= v.seg.anchorTime) {
    // Streamed: what is scheduled keeps its rate; the new rate applies from the end of it on.
    v.prev = v.seg
    v.seg = { anchorTime: timeOf(v, v.scheduledUntil), anchorPos: v.scheduledUntil, rate }
  }
  stats.rate = rate
  return { blocked: false }
}

/** A real tap: lets the browser start the audio context (autoplay policy). */
export async function resumeWebAudio(): Promise<boolean> {
  const ctx = getSharedAudioContext()
  await ctx.resume().catch(() => {})
  return ctx.state === 'running'
}

/** Test-only: what the engine measured. */
export function __webAudioTrackStatsForTests(): typeof stats {
  return stats
}

/** Test-only: forget all state. */
export function __resetWebAudioTrackForTests(): void {
  if (voice?.feeder) voice.feeder.cancelled = true
  if (preparing) preparing.cancelled = true
  ready.clear()
  failed.clear()
  waiters.clear()
  wanted = null
  next = null
  preparing = null
  voice = null
  lastSyncAt = -Infinity
  suspect = 0
  clock.reset()
  stats.prepares.length = 0
  stats.reschedules.length = 0
  stats.starts = 0
  stats.late = 0
}

import { BEEP_PITCHES_HZ, synthesizeBeeps, type ReferenceSong } from './referenceSong.ts' // with .ts: plain Node runs this file too (scripts/)

/**
 * Evaluates a recording of the reference song (#464): where did each track beep and each click
 * really sound, and how far apart were they? Pure and self-contained, so the CLI
 * (`scripts/analyze-sync-recording.mts`) and - later - the app itself (measuring with the
 * microphone) can use it.
 *
 * - Track beeps (300-840 Hz) and clicks (1000/1500 Hz) are separated by frequency: a narrow
 *   envelope per known tone, all through the same zero-phase low pass, so their timing compares
 *   one to one (toneEnvelope).
 * - The beep's pitch names its bar (one pitch per bar, repeating every 10 bars), so the recording
 *   may start anywhere and a beat can't be taken for its neighbour. The high downbeat click does
 *   the same for the clicks.
 * - Two passes: the beep onsets vote where song time 0 sits in the recording; then each beat's beep
 *   and click are looked for in their own tone near where they are expected (a leak of the other
 *   source at another tone is several times quieter there).
 * - An onset is where the tone's envelope first reaches half of its peak (docs/13 §6); the slightly
 *   different shapes of beep and click are calibrated out (shapeBiasMs). Precision: about ±1 ms.
 */

export interface SyncBeat {
  bar: number
  beat: number
  section: string
  /** Song time of the beat (ground truth). */
  songMs: number
  /** Track beep against where a steadily running track would put it (0 = on time; jumps = corrections). */
  trackMs: number | null
  /** Click minus track beep of the same beat - what the musician hears. */
  clickMinusTrackMs: number | null
}

export interface SyncSectionSummary {
  section: string
  beats: number
  /** Beats where both the click and the beep were found. */
  pairs: number
  meanMs: number | null
  medianMs: number | null
  sdMs: number | null
  minMs: number | null
  maxMs: number | null
  /** Change of click minus track over the section, in ms per minute (linear fit). */
  driftMsPerMin: number | null
  /** Track jumps of more than 40 ms from one beat to the next (position corrections). */
  trackJumps: number
}

export interface SyncReport {
  /** Recording time of song time 0, from the track (ms). */
  trackStartMs: number
  beats: SyncBeat[]
  sections: SyncSectionSummary[]
  overall: SyncSectionSummary
  /** Events near no beat's beep or click (noise, other sources; the count-in clicks before bar 1). */
  strayTrackOnsets: number
  strayClicks: number
}

// --- signal processing -----------------------------------------------------------------------

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number }

/** RBJ cookbook low/high pass, Q = 1/√2 (Butterworth stage). */
function biquad(kind: 'low' | 'high', freq: number, rate: number): Biquad {
  const w = (2 * Math.PI * freq) / rate
  const cos = Math.cos(w)
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2)
  const a0 = 1 + alpha
  const b = kind === 'low' ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2] : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
  return { b0: b[0]! / a0, b1: b[1]! / a0, b2: b[2]! / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 }
}

function run(f: Biquad, x: Float32Array, reverse: boolean): Float32Array {
  const y = new Float32Array(x.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let k = 0; k < x.length; k++) {
    const i = reverse ? x.length - 1 - k : k
    const v = f.b0 * x[i]! + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2
    x2 = x1; x1 = x[i]!; y2 = y1; y1 = v
    y[i] = v
  }
  return y
}

/** Low pass by cascaded 2nd-order stages, each run forwards and backwards: no phase delay. */
function lowPass(x: Float32Array, rate: number, hz: number, stages = 4): Float32Array {
  const f = biquad('low', hz, rate)
  let y = x
  for (let i = 0; i < stages; i++) y = run(f, run(f, y, false), true)
  return y
}

/**
 * How loud `freq` is at every moment: the signal shifted down by `freq` (I/Q) and low-passed.
 * Every frequency goes through the *same* low pass, so their timing compares one to one - the
 * filter's own smearing is the same for the beep and the click and drops out of their difference.
 * 160 Hz between the highest beep (840) and the click (1000) are far outside the 60 Hz pass band.
 */
export function toneEnvelope(x: Float32Array, rate: number, freq: number, bandwidthHz = 60): Float32Array {
  const re = new Float32Array(x.length)
  const im = new Float32Array(x.length)
  const w = (2 * Math.PI * freq) / rate
  for (let i = 0; i < x.length; i++) {
    re[i] = x[i]! * Math.cos(w * i)
    im[i] = -x[i]! * Math.sin(w * i)
  }
  const r = lowPass(re, rate, bandwidthHz)
  const q = lowPass(im, rate, bandwidthHz)
  const out = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = 2 * Math.sqrt(r[i]! * r[i]! + q[i]! * q[i]!)
  return out
}

/** Onsets (ms) in an envelope: events above `threshold`·(loud level), at least `minGapMs` apart;
 * the onset is the first sample before the event's peak at half the peak height. */
export function onsets(env: Float32Array, rate: number, minGapMs = 50, threshold = 0.15): { ms: number; peakIndex: number; peak: number }[] {
  const sorted = Float32Array.from(env).sort()
  const loud = sorted[Math.floor(sorted.length * 0.999)] || 1e-9
  const gate = threshold * loud
  const gap = Math.round((minGapMs / 1000) * rate)
  const out: { ms: number; peakIndex: number; peak: number }[] = []
  let i = 0
  while (i < env.length) {
    if (env[i]! < gate) {
      i++
      continue
    }
    let peak = i
    const end = Math.min(env.length, i + Math.round(0.04 * rate))
    for (let k = i; k < end; k++) if (env[k]! > env[peak]!) peak = k
    // Half height, between two samples (linear) - finer than one sample.
    let start = peak
    while (start > 0 && env[start - 1]! >= env[peak]! / 2) start--
    const before = start > 0 ? env[start - 1]! : 0
    const frac = env[start]! > before ? (env[peak]! / 2 - before) / (env[start]! - before) : 0
    out.push({ ms: ((start - 1 + frac) / rate) * 1000, peakIndex: peak, peak: env[peak]! })
    i = peak + gap
  }
  return out
}

/** A level that counts as loud in this envelope (its 99.9th percentile). */
function loudLevel(env: Float32Array): number {
  const step = Math.max(1, Math.floor(env.length / 200000)) // a sample of it is plenty
  const v: number[] = []
  for (let i = 0; i < env.length; i += step) v.push(env[i]!)
  v.sort((a, b) => a - b)
  return v[Math.floor(v.length * 0.999)] || 1e-9
}

/** The onset (ms) of the event nearest to `expectedMs` within ±`windowMs` whose peak exceeds `gate`
 * - half the peak height, before the peak - or null. */
function nearestEvent(env: Float32Array, rate: number, expectedMs: number, windowMs: number, gate: number): number | null {
  const from = Math.max(1, Math.round(((expectedMs - windowMs) / 1000) * rate))
  const to = Math.min(env.length - 1, Math.round(((expectedMs + windowMs) / 1000) * rate))
  let best: number | null = null
  for (let i = from; i < to; i++) {
    // A peak: a local maximum above the gate (largest within ±10 ms).
    if (env[i]! < gate || env[i]! < env[i - 1]! || env[i]! < env[i + 1]!) continue
    const span = Math.round(0.01 * rate)
    let isPeak = true
    for (let k = Math.max(0, i - span); k < Math.min(env.length, i + span); k++) if (env[k]! > env[i]!) { isPeak = false; break }
    if (!isPeak) continue
    let start = i
    while (start > 0 && env[start - 1]! >= env[i]! / 2) start--
    const before = env[start - 1]!
    const frac = env[start]! > before ? (env[i]! / 2 - before) / (env[start]! - before) : 0
    const ms = ((start - 1 + frac) / rate) * 1000
    if (best === null || Math.abs(ms - expectedMs) < Math.abs(best - expectedMs)) best = ms
  }
  return best
}

/** Element-wise sum of envelopes, and which one is loudest at a sample. */
function sum(envs: Float32Array[]): Float32Array {
  const out = new Float32Array(envs[0]!.length)
  for (const e of envs) for (let i = 0; i < e.length; i++) out[i] += e[i]!
  return out
}
const loudestAt = (envs: Float32Array[], i: number) => envs.reduce((best, e, k) => (e[i]! > envs[best]![i]! ? k : best), 0)

/**
 * Drops events that are the other source leaking in: a click is so short (it fades within a few
 * ms) that some of it lands at the beep pitches, and the other way round. Such an event is much
 * quieter than the typical event of its own kind *and* the other kind is louder at that moment.
 * A beep and a click at the same moment (in sync - the case that matters) both stay.
 */
function withoutLeaks<T extends { peakIndex: number; peak: number }>(events: T[], own: Float32Array, other: Float32Array): T[] {
  const typical = median(events.map((e) => e.peak)) ?? 0
  return events.filter((e) => !(e.peak < 0.5 * typical && other[e.peakIndex]! > own[e.peakIndex]!))
}

/** The app's click (clickEngine.ts): 1000/1500 Hz, from full level down to 0.001 in 30 ms. */
export function synthesizeAppClick(out: Float32Array, atMs: number, rate: number, downbeat: boolean): void {
  const at = Math.round((atMs / 1000) * rate)
  const tau = 0.03 / Math.log((downbeat ? 0.5 : 0.35) / 0.001)
  for (let k = 0; k < 0.03 * rate && at + k < out.length; k++) {
    const s = k / rate
    out[at + k] += (downbeat ? 0.5 : 0.35) * Math.exp(-s / tau) * Math.sin(2 * Math.PI * (downbeat ? 1500 : 1000) * s)
  }
}

/**
 * The method's own offset between a beep and a click that start at the same moment: the two have
 * different shapes (the beep rises over 1 ms, the click starts at full level and fades within a
 * few ms), so "half the peak" falls a fraction of a ms differently. Measured on synthetic sounds
 * at this sample rate and taken off every result.
 */
const calibration = new Map<number, number>()
function shapeBiasMs(rate: number): number {
  const cached = calibration.get(rate)
  if (cached !== undefined) return cached
  const values: number[] = []
  for (const [pitchHz, downbeat] of [[480, false], [720, true], [840, false]] as const) {
    const at = 300
    const beep = synthesizeBeeps({ durationMs: 800, beats: [{ bar: 1, beat: 0, timeMs: at, bpm: 120, section: '', silent: false, pitchHz }] } as unknown as ReferenceSong, rate)
    const click = new Float32Array(beep.length)
    synthesizeAppClick(click, at, rate, downbeat)
    // Exactly as the analysis times them: each in its own tone (nearestEvent, step 3/4).
    const be = toneEnvelope(beep, rate, pitchHz)
    const ce = toneEnvelope(click, rate, downbeat ? 1500 : 1000)
    const b = nearestEvent(be, rate, at, 100, 0.3 * loudLevel(be))
    const c = nearestEvent(ce, rate, at, 100, 0.3 * loudLevel(ce))
    if (b !== null && c !== null) values.push(c - b)
  }
  const bias = values.length ? values.reduce((a, v) => a + v, 0) / values.length : 0
  calibration.set(rate, bias)
  return bias
}

// --- statistics ------------------------------------------------------------------------------

const median = (v: number[]) => {
  if (v.length === 0) return null
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10)

function summarize(section: string, beats: SyncBeat[]): SyncSectionSummary {
  const pairs = beats.filter((b) => b.clickMinusTrackMs !== null)
  const v = pairs.map((b) => b.clickMinusTrackMs!)
  const mean = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  const sd = mean !== null && v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : null
  let drift: number | null = null
  if (pairs.length >= 3) {
    const xs = pairs.map((b) => b.songMs / 60000)
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length
    const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0)
    if (den > 0) drift = xs.reduce((a, x, i) => a + (x - mx) * (v[i]! - mean!), 0) / den
  }
  const track = beats.map((b) => b.trackMs)
  let jumps = 0
  for (let i = 1; i < track.length; i++) if (track[i] !== null && track[i - 1] !== null && Math.abs(track[i]! - track[i - 1]!) > 40) jumps++
  return {
    section,
    beats: beats.length,
    pairs: pairs.length,
    meanMs: round1(mean),
    medianMs: round1(median(v)),
    sdMs: round1(sd),
    minMs: round1(v.length ? Math.min(...v) : null),
    maxMs: round1(v.length ? Math.max(...v) : null),
    driftMsPerMin: round1(drift),
    trackJumps: jumps,
  }
}

// --- the analysis ----------------------------------------------------------------------------

/**
 * `trackSignal` and `clickSignal` are usually the same recording (one device playing both); with
 * two devices on the two channels of an interface, the track from one and the click from the other.
 */
export function analyzeSyncRecording(song: ReferenceSong, trackSignal: Float32Array, clickSignal: Float32Array, rate: number): SyncReport {
  const beats = song.beats.filter((b) => !b.silent)

  // 1. Track beeps and their bar (the loudest beep pitch at the peak).
  const beepEnvs = BEEP_PITCHES_HZ.map((f) => toneEnvelope(trackSignal, rate, f))
  const beepSum = sum(beepEnvs)
  const clickEnvs = [1000, 1500].map((f) => toneEnvelope(clickSignal, rate, f))
  const clickSum = sum(clickEnvs)
  // The other source as heard in this signal, to recognise its leaks.
  const clickInTrack = trackSignal === clickSignal ? clickSum : sum([1000, 1500].map((f) => toneEnvelope(trackSignal, rate, f)))
  const beepInClick = trackSignal === clickSignal ? beepSum : sum(BEEP_PITCHES_HZ.map((f) => toneEnvelope(clickSignal, rate, f)))
  const trackOnsets = withoutLeaks(onsets(beepSum, rate), beepSum, clickInTrack).map((o) => ({ ms: o.ms, pitch: loudestAt(beepEnvs, o.peakIndex) }))

  // 2. Where song time 0 sits in the recording: the most common (onset - beat) among beats of
  //    the matching pitch, in 5 ms bins.
  const votes = new Map<number, number>()
  for (const o of trackOnsets) {
    for (const b of beats) {
      if (BEEP_PITCHES_HZ.indexOf(b.pitchHz) !== o.pitch) continue
      const bin = Math.round((o.ms - b.timeMs) / 5)
      votes.set(bin, (votes.get(bin) ?? 0) + 1)
    }
  }
  const [bestBin] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0] ?? [0]
  const trackStartMs = bestBin * 5

  // 3. Each beat's beep, looked for in that beat's own pitch only, near where it is expected -
  //    following the track's local offset, so a track that saws back and forth is still followed.
  //    A click leaking in at another pitch is several times quieter there and loses.
  const trackAt = new Map<number, number>()
  const loudBeep = beepEnvs.map(loudLevel)
  let local = 0
  beats.forEach((b, i) => {
    const k = BEEP_PITCHES_HZ.indexOf(b.pitchHz)
    const hit = nearestEvent(beepEnvs[k]!, rate, b.timeMs + trackStartMs + local, 250, 0.3 * loudBeep[k]!)
    if (hit === null) return
    const r = hit - trackStartMs - b.timeMs
    trackAt.set(i, r)
    local = r
  })
  // A steady position over the whole recording: the median, so `trackMs` shows deviations from it.
  const steady = median([...trackAt.values()]) ?? 0

  // 4. Clicks: the coarse offset from the downbeats (bar starts are far apart - no mix-up), then
  //    each beat's click in its own tone (1500 Hz on the downbeat, else 1000 Hz) near that.
  const clicks = withoutLeaks(onsets(clickSum, rate), clickSum, beepInClick).map((o) => ({ ms: o.ms, downbeat: loudestAt(clickEnvs, o.peakIndex) === 1 }))
  const barStarts = beats.filter((b) => b.beat === 0)
  const coarse =
    median(
      clicks
        .filter((c) => c.downbeat)
        .map((c) => {
          const rel = c.ms - trackStartMs
          return rel - barStarts.reduce((n, b) => (Math.abs(b.timeMs - rel) < Math.abs(n.timeMs - rel) ? b : n), barStarts[0]!).timeMs
        }),
    ) ?? 0
  const clickAt = new Map<number, number>()
  const loudClick = clickEnvs.map(loudLevel)
  let localClick = coarse
  beats.forEach((b, i) => {
    const k = b.beat === 0 ? 1 : 0
    const hit = nearestEvent(clickEnvs[k]!, rate, b.timeMs + trackStartMs + localClick, 150, 0.3 * loudClick[k]!)
    if (hit === null) return
    const value = hit - trackStartMs - b.timeMs
    clickAt.set(i, value)
    localClick = value
  })
  // Events near no beat's beep or click at all - noise or another source (count-in clicks too).
  const assigned = [...trackAt.entries(), ...clickAt.entries()].map(([i, r]) => beats[i]!.timeMs + trackStartMs + r)
  const near = (ms: number) => assigned.some((a) => Math.abs(a - ms) < 40)
  const strayTrackOnsets = trackOnsets.filter((o) => !near(o.ms)).length
  const strayClicks = clicks.filter((c) => !near(c.ms)).length

  const bias = shapeBiasMs(rate)
  const out: SyncBeat[] = beats.map((b, i) => {
    const t = trackAt.get(i)
    const raw = clickAt.get(i)
    const c = raw === undefined ? undefined : raw - bias
    return {
      bar: b.bar,
      beat: b.beat,
      section: b.section,
      songMs: b.timeMs,
      trackMs: t === undefined ? null : round1(t - steady),
      clickMinusTrackMs: t === undefined || c === undefined ? null : round1(c - t),
    }
  })
  const names = [...new Set(out.map((b) => b.section))]
  return {
    trackStartMs: round1(trackStartMs + steady)!,
    beats: out,
    sections: names.map((n) => summarize(n, out.filter((b) => b.section === n))),
    overall: summarize('gesamt', out),
    strayTrackOnsets,
    strayClicks,
  }
}

/** Reads a 16-bit PCM WAV (mono or stereo) into channels. */
export function decodeWav(bytes: Uint8Array): { rate: number; channels: Float32Array[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 12
  let rate = 44100
  let channelCount = 1
  let bits = 16
  while (pos + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(pos, pos + 4))
    const size = view.getUint32(pos + 4, true)
    if (id === 'fmt ') {
      channelCount = view.getUint16(pos + 10, true)
      rate = view.getUint32(pos + 12, true)
      bits = view.getUint16(pos + 22, true)
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`Only 16-bit WAV is supported (got ${bits}-bit)`)
      const frames = Math.floor(size / 2 / channelCount)
      const channels = Array.from({ length: channelCount }, () => new Float32Array(frames))
      for (let f = 0; f < frames; f++) for (let c = 0; c < channelCount; c++) channels[c]![f] = view.getInt16(pos + 8 + (f * channelCount + c) * 2, true) / 32768
      return { rate, channels }
    }
    pos += 8 + size + (size % 2)
  }
  throw new Error('No audio data in the WAV file')
}

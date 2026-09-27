import { beatsPerBar, type BeatAnchorLike, type TempoMarkerLike } from './metronome'

/**
 * Fitted beat grid for playback (2026-09-27, docs/13): tapped or detected beat anchors are
 * *observations*, not commands. Played as-is, one anchor per beat carried every tap's or
 * detector's ±20-30 ms scatter straight into the click (measured against the drum hits of the
 * band's tracks: the scatter was noise - a smoothed grid sat just as close to the hits - and it
 * made the click stumble), double anchors produced 170 ms "beats", and a nominal bpm 7 % off the
 * real tempo miscounted beats between sparse anchors.
 *
 * This turns the observations into an even beat list - one beat per beat slot, following the
 * band's slow tempo drift (1-3 % within a song on the measured tracks) but not the per-beat
 * noise - which the existing grid code (metronome.ts) then plays in place of the raw anchors.
 * The stored anchors stay untouched.
 */

export interface TempoMapQuality {
  /** Anchors as stored. */
  observations: number
  /** Anchors closer than half a beat to a neighbour (double taps / double detections), dropped. */
  duplicates: number
  /** Anchors far off the fitted grid (a stray tap), ignored by the fit. */
  outliers: number
  /** Gaps that don't divide into a whole number of beats (±0.35) - the grid's phase is unsure there. */
  ambiguousGaps: number
  /** The longest stretch without an observation, in beats. */
  longestGapBeats: number
  /** Scatter of the observations around the fitted grid (robust SD), ms - tap/detector noise. */
  noiseMs: number
  /** Median fitted tempo and its 5-95 % range, BPM. */
  bpm: number
  bpmLow: number
  bpmHigh: number
  /** How far the variant's entered bpm is from the fitted tempo, % (signed). */
  nominalOffPercent: number
  /** Anchors whose stored beat-in-bar disagrees with the voted downbeat. */
  beatInBarConflicts: number
  /** Tempo sections whose bpm is far slower than their own anchors (their spacing was used). */
  tempoMismatches: number
  verdict: 'good' | 'check' | 'poor'
}

export interface TempoMap {
  /** One entry per beat, in time order, each with its beat-in-bar. */
  beats: BeatAnchorLike[]
  quality: TempoMapQuality | null
}

/** A fit needs a few observations; with fewer the raw anchors are played as before. */
const MIN_OBSERVATIONS = 4
/** Half-width of the local fit, in beats (±1.5 bars of 4/4). */
const FIT_HALF_WIDTH = 6
/** At least this many observations in a fit window - sparse anchors widen it. */
const MIN_WINDOW_OBSERVATIONS = 4
const MAX_HALF_WIDTH = 64
/** A gap this far from a whole number of beats makes the beat count between them unsure. */
const AMBIGUOUS_FRACTION = 0.35
/** Lower bound of the robustness scale, ms: with near-perfect anchors the median residual is ~0,
 * and a scale of 6 x that would reject every anchor next to a stray tap along with it. */
const MIN_ROBUST_SCALE_MS = 40

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo)
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

/** Below this fraction of the nominal beat, the anchors' own median spacing overrules the nominal
 * bpm: anchors that dense can't be sparse observations of that tempo, the bpm is wrong. Not
 * higher: a stretch with every beat observed twice (double taps, 263 ms pairs at 440 ms per beat
 * on What's Up) has a median gap of about half a beat, and must still count as one tempo. */
const MISMATCH_FRACTION = 0.4

/** Beat period from the observations: the median gap, divided by how many nominal beats it spans
 * (sparse anchors), so a wrong nominal bpm only has to be within ~half a beat per gap. A nominal
 * bpm far *slower* than the anchors (a tempo section saved with 23.8 BPM over anchors at ~135 -
 * 2026-09-27, "Whats up") would otherwise count 5 of every 6 anchors as duplicates and play the
 * song at a fraction of its speed; then the anchors' own spacing is used and `mismatch` is set. */
function estimatePeriod(times: number[], nominalMs: number): { periodMs: number; mismatch: boolean } {
  const gaps = times.slice(1).map((t, i) => t - times[i]!).filter((g) => g > 0)
  const own = median(gaps)
  const mismatch = own < MISMATCH_FRACTION * nominalMs
  const reference = mismatch ? own : nominalMs
  const typical = median(gaps.filter((g) => g >= 0.5 * reference))
  const span = Math.max(1, Math.round(typical / reference))
  return { periodMs: typical / span, mismatch }
}

interface Observation {
  timeMs: number
  beatInBar?: number
  pinned?: boolean
}

/** How much more a fixed (pinned) anchor weighs than an ordinary observation - in the local fit
 * (the grid runs through it; the output is also set to it exactly) and in the downbeat vote. */
const PIN_WEIGHT = 1000

/** Closer than this fraction of a beat, two observations are one beat observed twice - a real
 * beat gap is ~1.0; 0.5-0.65 were double taps/detections on the measured tracks (What's Up:
 * pairs 263 ms apart at 440 ms per beat). */
const DUPLICATE_FRACTION = 0.65

/** Drops observations closer than DUPLICATE_FRACTION of a beat to the previous kept one, keeping whichever of the
 * two sits closer to where the grid of the kept ones says a beat should be. */
function dropDuplicates(observations: Observation[], periodMs: number): { kept: Observation[]; duplicates: number } {
  const kept: Observation[] = []
  let duplicates = 0
  for (const obs of observations) {
    const prev = kept[kept.length - 1]
    if (!prev || obs.timeMs - prev.timeMs >= DUPLICATE_FRACTION * periodMs) {
      kept.push(obs)
      continue
    }
    duplicates++
    // A fixed anchor always wins against an ordinary observation of the same beat.
    if (obs.pinned !== prev.pinned) {
      if (obs.pinned) kept[kept.length - 1] = obs
      continue
    }
    const before = kept[kept.length - 2]
    if (!before) continue // no grid yet - keep the earlier one
    const expected = before.timeMs + periodMs * Math.max(1, Math.round((prev.timeMs - before.timeMs) / periodMs))
    if (Math.abs(obs.timeMs - expected) < Math.abs(prev.timeMs - expected)) kept[kept.length - 1] = obs
  }
  return { kept, duplicates }
}

/** Beat index per observation, counting each gap in beats of the running local period. */
function assignIndices(kept: Observation[], periodMs: number): { indices: number[]; ambiguous: number; longestGap: number } {
  const indices = [0]
  let local = periodMs
  let ambiguous = 0
  let longestGap = 0
  for (let i = 1; i < kept.length; i++) {
    const gap = kept[i]!.timeMs - kept[i - 1]!.timeMs
    const beats = gap / local
    const n = Math.max(1, Math.round(beats))
    if (Math.abs(beats - n) > AMBIGUOUS_FRACTION) ambiguous++
    longestGap = Math.max(longestGap, n)
    indices.push(indices[i - 1]! + n)
    // Follow slow drift, but let a single gap move the estimate only a little.
    local = 0.85 * local + 0.15 * (gap / n)
  }
  return { indices, ambiguous, longestGap }
}

/** Weighted least-squares line t = a + b * x. */
function weightedLine(xs: number[], ts: number[], ws: number[]): { a: number; b: number } | null {
  let sw = 0, sx = 0, st = 0, sxx = 0, sxt = 0
  for (let i = 0; i < xs.length; i++) {
    const w = ws[i]!
    if (w <= 0) continue
    sw += w; sx += w * xs[i]!; st += w * ts[i]!; sxx += w * xs[i]! * xs[i]!; sxt += w * xs[i]! * ts[i]!
  }
  const det = sw * sxx - sx * sx
  if (sw <= 0 || Math.abs(det) < 1e-9) return null
  const b = (sw * sxt - sx * st) / det
  return { a: (st - b * sx) / sw, b }
}

const tricube = (d: number) => (d >= 1 ? 0 : (1 - d * d * d) ** 3)
const bisquare = (u: number) => (Math.abs(u) >= 1 ? 0 : (1 - u * u) ** 2)

/** Robust local linear fit (LOESS with bisquare reweighting) of observation time over beat index,
 * evaluated at every integer index - one smooth beat per slot. */
function fitBeats(
  indices: number[],
  times: number[],
  pinned: boolean[],
): { beatTimes: number[]; residualsMs: number[]; robustWeights: number[] } {
  const first = indices[0]!
  const last = indices[indices.length - 1]!
  let robust = indices.map(() => 1)
  let residuals: number[] = []

  // Observations are sorted by index, so each window is a contiguous slice - found by binary
  // search, not a scan of every observation (a full scan made a 790-anchor song take ~90 ms).
  const lowerBound = (value: number) => {
    let lo = 0, hi = indices.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (indices[mid]! < value) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const evaluate = (at: number): number => {
    // Window: at least FIT_HALF_WIDTH beats, widened to the MIN_WINDOW_OBSERVATIONS-th nearest
    // observation. Continuous in `at` - doubling it in steps made sparse stretches (one anchor per
    // 8 beats) jump between window sizes from one beat to the next, a kink in the grid (a 339/461 ms
    // pair in "All the small things", measured 2026-09-27).
    const pos = lowerBound(at)
    let left = pos - 1
    let right = pos
    let kth = 0
    for (let n = 0; n < MIN_WINDOW_OBSERVATIONS && (left >= 0 || right < indices.length); n++) {
      const dl = left >= 0 ? at - indices[left]! : Infinity
      const dr = right < indices.length ? indices[right]! - at : Infinity
      if (dl <= dr) {
        kth = dl
        left--
      } else {
        kth = dr
        right++
      }
    }
    const half = Math.min(MAX_HALF_WIDTH, Math.max(FIT_HALF_WIDTH, kth))
    const from = lowerBound(at - half)
    const to = lowerBound(at + half + 1)
    const xs = indices.slice(from, to)
    const ts = times.slice(from, to)
    const ws = xs.map((x, i) => tricube(Math.abs(x - at) / (half + 1)) * robust[from + i]! * (pinned[from + i] ? PIN_WEIGHT : 1))
    const line = weightedLine(xs, ts, ws)
    if (line) return line.a + line.b * at
    // Degenerate window (weight on a single index): the nearest observation that wasn't rejected.
    let nearest = -1
    indices.forEach((x, i) => {
      if (robust[i]! < 0.1) return
      if (nearest < 0 || Math.abs(x - at) < Math.abs(indices[nearest]! - at)) nearest = i
    })
    return times[Math.max(0, nearest)]!
  }

  // Two robustness passes: fit, measure residuals, down-weight the far-off observations, refit.
  for (let pass = 0; pass < 3; pass++) {
    residuals = indices.map((x, i) => times[i]! - evaluate(x))
    if (pass === 2) break
    const scale = Math.max(6 * median(residuals.map((r) => Math.abs(r))), MIN_ROBUST_SCALE_MS)
    robust = residuals.map((r, i) => (pinned[i] ? 1 : bisquare(r / scale)))
  }

  const beatTimes: number[] = []
  const pinnedAt = new Map<number, number>()
  indices.forEach((x, i) => {
    if (pinned[i]) pinnedAt.set(x, times[i]!)
  })
  for (let x = first; x <= last; x++) beatTimes.push(pinnedAt.get(x) ?? evaluate(x))
  return { beatTimes, residualsMs: residuals, robustWeights: robust }
}

function fitSection(observations: Observation[], bpm: number, timeSignature: string): { beats: BeatAnchorLike[]; stats: SectionStats } | null {
  if (observations.length < MIN_OBSERVATIONS) return null
  const perBar = beatsPerBar(timeSignature)
  const sorted = [...observations].sort((a, b) => a.timeMs - b.timeMs)
  const { periodMs: period, mismatch } = estimatePeriod(sorted.map((o) => o.timeMs), 60000 / bpm)
  const { kept, duplicates } = dropDuplicates(sorted, period)
  if (kept.length < MIN_OBSERVATIONS) return null
  const { indices, ambiguous, longestGap } = assignIndices(kept, period)
  const times = kept.map((o) => o.timeMs)
  const { beatTimes, residualsMs, robustWeights } = fitBeats(indices, times, kept.map((o) => o.pinned === true))

  // Downbeat phase by majority vote over the stored beat-in-bar values (each stored value says
  // "beat index i is beat k of the bar"); with none stored, the first observation is beat 1.
  const votes = new Map<number, number>()
  kept.forEach((o, i) => {
    if (o.beatInBar === undefined) return
    const phase = mod(o.beatInBar - indices[i]!, perBar)
    votes.set(phase, (votes.get(phase) ?? 0) + (o.pinned ? PIN_WEIGHT : 1))
  })
  let phase = 0
  let best = -1
  for (const [candidate, count] of votes) if (count > best) [phase, best] = [candidate, count]
  const conflicts = kept.filter((o, i) => !o.pinned && o.beatInBar !== undefined && mod(o.beatInBar - indices[i]!, perBar) !== phase).length

  const first = indices[0]!
  // Safety net: a beat grid must only move forward, at least half a beat per beat - a messy edge
  // of the song must never make playback run backwards.
  let last = -Infinity
  const beats: BeatAnchorLike[] = []
  beatTimes.forEach((t, k) => {
    if (t - last < 0.5 * period) return
    last = t
    beats.push({ timeMs: Math.round(t), beatInBar: mod(phase + first + k, perBar) })
  })
  const periods = beatTimes.slice(1).map((t, k) => t - beatTimes[k]!)
  return {
    beats,
    stats: {
      observations: observations.length,
      duplicates,
      outliers: robustWeights.filter((w) => w < 0.1).length,
      ambiguous,
      longestGap,
      residualsMs: residualsMs.filter((_, i) => robustWeights[i]! >= 0.1),
      bpms: periods.filter((p) => p > 0).map((p) => 60000 / p),
      conflicts,
      tempoMismatch: mismatch,
    },
  }
}

interface SectionStats {
  observations: number
  duplicates: number
  outliers: number
  ambiguous: number
  longestGap: number
  residualsMs: number[]
  bpms: number[]
  conflicts: number
  tempoMismatch: boolean
}

/**
 * The fitted beat grid for a variant's anchors. Sections are split at tempo markers (#141, each
 * fitted on its own with its own bpm/meter). With too few anchors to fit, the raw anchors come
 * back unchanged (and `quality` is null) - e.g. a song with one lead-in anchor plays exactly as
 * before.
 */
export function fitTempoMap(
  anchors: readonly BeatAnchorLike[],
  bpm: number,
  timeSignature: string,
  tempoMarkers: readonly TempoMarkerLike[] = [],
): TempoMap {
  if (anchors.length < MIN_OBSERVATIONS || !(bpm > 0)) return { beats: [...anchors], quality: null }
  const markers = [...tempoMarkers].sort((a, b) => a.timeMs - b.timeMs)
  const bounds = [
    { startMs: -Infinity, bpm, timeSignature },
    ...markers.map((m) => ({ startMs: m.timeMs, bpm: m.bpm, timeSignature: m.timeSignature ?? timeSignature })),
  ]
  const beats: BeatAnchorLike[] = []
  const stats: SectionStats[] = []
  bounds.forEach((section, i) => {
    const end = bounds[i + 1]?.startMs ?? Infinity
    const inSection = anchors.filter((a) => a.timeMs >= section.startMs && a.timeMs < end)
    const fitted = fitSection(inSection, section.bpm, section.timeSignature)
    if (fitted) {
      beats.push(...fitted.beats)
      stats.push(fitted.stats)
    } else {
      beats.push(...inSection)
    }
  })
  if (stats.length === 0) return { beats: [...anchors], quality: null }
  return { beats, quality: summarize(stats, bpm) }
}

function summarize(stats: SectionStats[], nominalBpm: number): TempoMapQuality {
  const residuals = stats.flatMap((s) => s.residualsMs)
  const bpms = stats.flatMap((s) => s.bpms)
  const center = residuals.length ? median(residuals) : 0
  const noiseMs = residuals.length ? 1.4826 * median(residuals.map((r) => Math.abs(r - center))) : 0
  const fitted = bpms.length ? median(bpms) : nominalBpm
  const quality = {
    observations: stats.reduce((n, s) => n + s.observations, 0),
    duplicates: stats.reduce((n, s) => n + s.duplicates, 0),
    outliers: stats.reduce((n, s) => n + s.outliers, 0),
    ambiguousGaps: stats.reduce((n, s) => n + s.ambiguous, 0),
    longestGapBeats: Math.max(...stats.map((s) => s.longestGap)),
    noiseMs: Math.round(noiseMs),
    bpm: Math.round(fitted * 10) / 10,
    bpmLow: bpms.length ? Math.round(percentile(bpms, 0.05) * 10) / 10 : fitted,
    bpmHigh: bpms.length ? Math.round(percentile(bpms, 0.95) * 10) / 10 : fitted,
    nominalOffPercent: Math.round(((nominalBpm - fitted) / fitted) * 1000) / 10,
    beatInBarConflicts: stats.reduce((n, s) => n + s.conflicts, 0),
    tempoMismatches: stats.filter((s) => s.tempoMismatch).length,
  }
  const serious = quality.tempoMismatches > 0 || quality.ambiguousGaps > 2 || Math.abs(quality.nominalOffPercent) > 5 || quality.longestGapBeats > 16
  const minor = quality.duplicates > 0 || quality.outliers > quality.observations * 0.05 || quality.beatInBarConflicts > 0 || quality.noiseMs > 35
  return { ...quality, verdict: serious ? 'poor' : minor ? 'check' : 'good' }
}

const cache = new WeakMap<readonly BeatAnchorLike[], Map<string, TempoMap>>()

/** `fitTempoMap`, cached per anchors array (a variant's anchors only change on save) - playback
 * reads this every tick. */
export function tempoMapFor(variant: {
  beatAnchors?: readonly BeatAnchorLike[]
  bpm: number
  timeSignature: string
  tempoMarkers?: readonly TempoMarkerLike[]
}): TempoMap {
  const anchors = variant.beatAnchors ?? []
  const key = `${variant.bpm}|${variant.timeSignature}|${JSON.stringify(variant.tempoMarkers ?? [])}`
  let byKey = cache.get(anchors)
  if (!byKey) {
    byKey = new Map()
    cache.set(anchors, byKey)
  }
  let map = byKey.get(key)
  if (!map) {
    map = fitTempoMap(anchors, variant.bpm, variant.timeSignature, variant.tempoMarkers ?? [])
    byKey.set(key, map)
  }
  return map
}

/** The beat grid playback uses: the fitted beats, or the raw anchors when there's nothing to fit. */
export function playbackAnchors(
  variant: Parameters<typeof tempoMapFor>[0] | null | undefined,
): readonly BeatAnchorLike[] {
  if (!variant) return []
  return tempoMapFor(variant).beats
}

/**
 * A tapping session's anchors *replace* the existing ones in the stretch they cover (plus half a
 * beat either side) instead of being added to them - adding them gave every re-tapped stretch
 * its anchors twice, one source of the double anchors measured on 2026-09-27. Anchors outside
 * that stretch stay.
 */
export function mergeTappedAnchors<A extends BeatAnchorLike>(existing: readonly A[], tapped: readonly A[], bpm: number): A[] {
  if (tapped.length === 0) return [...existing]
  const margin = bpm > 0 ? 30000 / bpm : 250
  const from = Math.min(...tapped.map((a) => a.timeMs)) - margin
  const to = Math.max(...tapped.map((a) => a.timeMs)) + margin
  return [...existing.filter((a) => a.timeMs < from || a.timeMs > to), ...tapped].sort((a, b) => a.timeMs - b.timeMs)
}

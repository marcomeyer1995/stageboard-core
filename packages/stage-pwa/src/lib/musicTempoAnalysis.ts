import { beatsPerBar } from './metronome'
import type { TrackAnalysisResult } from './analyzeTrack'

/** `music-tempo` hard-codes an assumed 44100Hz input internally (its own `samplingRate` param is
 * dead code - grep its source, it's set but never read) - every internal time constant (hop
 * size, tempo-hypothesis windows) is computed against that fixed assumption regardless of what
 * sample rate the audio actually is. Feeding it audio decoded at any other rate (48kHz is common)
 * would silently misreport both the detected BPM and every beat's timestamp by the sample-rate
 * ratio. Plain linear interpolation, not a proper windowed-sinc resampler - this only feeds a
 * beat-tracking analysis step, never played back, so the mild aliasing it introduces doesn't
 * matter the way it would for real audio production. */
const MUSIC_TEMPO_SAMPLE_RATE = 44100

function resampleTo44100(mono: Float32Array, sampleRate: number): Float32Array {
  if (sampleRate === MUSIC_TEMPO_SAMPLE_RATE) return mono
  const ratio = sampleRate / MUSIC_TEMPO_SAMPLE_RATE
  const outLength = Math.round(mono.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio
    const srcIndex = Math.floor(srcPos)
    const frac = srcPos - srcIndex
    const a = mono[srcIndex] ?? 0
    const b = mono[srcIndex + 1] ?? a
    out[i] = a + (b - a) * frac
  }
  return out
}

/**
 * Automatic BPM + beat-anchor detection via the `music-tempo` npm package (MIT-licensed,
 * implements the published "Beatroot" algorithm) - the optional `music-tempo-beat-detection`
 * plugin's actual analysis. Always called from musicTempoWorker.ts, never directly from
 * analyzeTrack.ts on the main thread - this is a synchronous, CPU-heavy computation (an
 * agent-based search over the whole track), and running it on the main thread froze the entire
 * app for 80+ seconds on a real, full-length song (confirmed live, 2026-09-12 - not just the
 * button, background sync/presence too). Bundled into the worker's own chunk (not the main one)
 * either way, so its ~14.5KB is only ever fetched once a workspace has the plugin installed and
 * actually runs "Track analysieren".
 *
 * Validated directly against real songs with manually-tapped ground truth (see this session's
 * scratch comparison campaign): consistently far more accurate than the hand-rolled
 * spectral-flux detector (audioAnalysis.ts) - e.g. 17-45ms mean error once real rhythmic content
 * is playing, vs. 90-160ms for the hand-rolled detector on the same tracks. Weakest on sparse,
 * drum-less intros (170-240ms there), a genuinely hard case for any beat tracker, not specific
 * to this library.
 *
 * Unlike audioAnalysis.ts's `detectBeatAnchors` (which only commits sparse *correction* anchors
 * where the nominal-bpm grid actually drifts), this returns a dense, one-per-beat anchor list
 * directly - safe now that every anchor carries its own `beatInBar` (#25 follow-up phase fix),
 * so a dense list still cycles 1-2-3-4 through the bar instead of re-announcing "beat 1" at
 * every anchor, and is strictly more accurate than the sparse-correction compromise.
 *
 * No way to detect which beat is actually the downbeat from audio alone (see BeatAnchorSchema's
 * own doc comment) - like the hand-rolled detector, this assumes the very first detected beat is
 * beat 1 and stamps every subsequent one by counting forward; the user corrects it via
 * BeatAnchorListEditor's "Beat" selector if that assumption is wrong.
 */
export async function analyzeWithMusicTempo(
  mono: Float32Array,
  sampleRate: number,
  timeSignature: string,
): Promise<TrackAnalysisResult> {
  const { default: MusicTempo } = await import('music-tempo')
  const result = new MusicTempo(resampleTo44100(mono, sampleRate))
  const bpm = Math.round(Number(result.tempo) * 10) / 10 // 1 decimal - matches VisualMetronomeWidget's display precision
  const beatCount = beatsPerBar(timeSignature)
  const beatAnchors = result.beats.map((seconds, i) => ({
    timeMs: Math.round(seconds * 1000),
    beatInBar: i % beatCount,
  }))
  // music-tempo reports no confidence score of its own (unlike audioAnalysis.ts's autocorrelation
  // ratio) - 1 whenever it found any beats at all, matching how a confident result is treated
  // elsewhere (SheetEditor.tsx doesn't currently surface tempoConfidence to the user either way).
  return { bpm: Number.isFinite(bpm) ? bpm : null, beatAnchors, tempoConfidence: beatAnchors.length > 0 ? 1 : 0 }
}

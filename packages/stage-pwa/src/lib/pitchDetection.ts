/**
 * Autocorrelation-based pitch detection: trims near-silent lead-in/lead-out so the
 * correlation isn't dominated by them, autocorrelates the trimmed buffer, finds the
 * first strong peak past the initial decline from lag 0 (the trivial self-match), then
 * refines it with parabolic interpolation for sub-sample precision. Standard technique,
 * same family as the commonly used "ACF2+" web tuner algorithm. Returns null for
 * silence/noise with no clear periodicity.
 *
 * `minRms` is the "is anything playing at all" gate - lower catches a note further into
 * its decay, at the cost of also picking up more background noise as a false positive.
 */
export function detectPitch(buffer: Float32Array, sampleRate: number, minRms = 0.01): number | null {
  const size = buffer.length

  let rms = 0
  let peak = 0
  for (let i = 0; i < size; i++) {
    rms += buffer[i] * buffer[i]
    const abs = Math.abs(buffer[i])
    if (abs > peak) peak = abs
  }
  rms = Math.sqrt(rms / size)
  if (rms < minRms) return null

  // Relative to this buffer's own peak, not a fixed absolute level - a fixed threshold
  // (e.g. 0.2) silently finds nothing to trim to for a quiet-but-real, decaying note
  // whose peak never reaches it, which used to kill detection long before the note was
  // actually inaudible, well before the RMS gate above ever got a say.
  const threshold = peak * 0.2
  let start = 0
  for (; start < size / 2; start++) if (Math.abs(buffer[start]) >= threshold) break
  let end = size - 1
  for (; end > size / 2; end--) if (Math.abs(buffer[end]) >= threshold) break
  const trimmed = buffer.subarray(start, end)
  const n = trimmed.length
  if (n < 2) return null

  const correlation = new Float32Array(n)
  for (let lag = 0; lag < n; lag++) {
    let sum = 0
    for (let i = 0; i < n - lag; i++) sum += trimmed[i] * trimmed[i + lag]
    correlation[lag] = sum
  }

  let lag = 0
  while (lag < n - 1 && correlation[lag] > correlation[lag + 1]) lag++

  let bestLag = -1
  let bestValue = -Infinity
  for (let i = lag; i < n; i++) {
    if (correlation[i] > bestValue) {
      bestValue = correlation[i]
      bestLag = i
    }
  }
  if (bestLag <= 0 || bestLag >= n - 1) return null

  let refinedLag = bestLag
  const prev = correlation[bestLag - 1]
  const curr = correlation[bestLag]
  const next = correlation[bestLag + 1]
  const denominator = prev + next - 2 * curr
  if (denominator !== 0) refinedLag = bestLag - (next - prev) / (2 * denominator)

  const frequency = sampleRate / refinedLag
  return Number.isFinite(frequency) && frequency > 0 ? frequency : null
}

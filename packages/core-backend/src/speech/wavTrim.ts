/**
 * Prepares a generated speech clip for exact timing (#63): Piper puts 60-210 ms of silence before
 * the word, different for every word - trimmed, so the voice starts at the moment the clip is
 * scheduled. The tail is cut to a short pad, and the level is set to a fixed peak (Piper's clips
 * hit full scale), so every announcement sits at the same loudness under the click.
 */

/** Silence kept before the first sample above the threshold - the attack of a consonant starts
 * below it. */
const LEAD_PAD_MS = 5
const TAIL_PAD_MS = 40
/** Fraction of the peak that counts as "the voice has started". */
const THRESHOLD = 0.05
/** Output peak: -3 dBFS. */
const TARGET_PEAK = 0.708

export interface PcmClip {
  sampleRate: number
  samples: Float32Array
}

/** Reads a 16-bit PCM mono WAV (what Piper writes). */
export function readWav16Mono(buffer: Buffer): PcmClip {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file')
  let offset = 12
  let sampleRate = 0
  let channels = 0
  let bits = 0
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      channels = buffer.readUInt16LE(body + 2)
      sampleRate = buffer.readUInt32LE(body + 4)
      bits = buffer.readUInt16LE(body + 14)
    } else if (id === 'data') {
      if (channels !== 1 || bits !== 16) throw new Error(`unsupported WAV: ${channels} channels, ${bits} bit`)
      const count = Math.floor(Math.min(size, buffer.length - body) / 2)
      const samples = new Float32Array(count)
      for (let i = 0; i < count; i++) samples[i] = buffer.readInt16LE(body + i * 2) / 32768
      return { sampleRate, samples }
    }
    offset = body + size + (size % 2)
  }
  throw new Error('WAV without data chunk')
}

export function writeWav16Mono(clip: PcmClip): Buffer {
  const data = Buffer.alloc(clip.samples.length * 2)
  clip.samples.forEach((s, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), i * 2))
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(clip.sampleRate, 24)
  header.writeUInt32LE(clip.sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

/** Trims lead/tail silence and normalises the peak. An all-silent clip comes back unchanged. */
export function trimSpeech(clip: PcmClip): PcmClip {
  const { samples, sampleRate } = clip
  let peak = 0
  for (const s of samples) peak = Math.max(peak, Math.abs(s))
  if (peak === 0) return clip
  const threshold = peak * THRESHOLD
  let first = 0
  while (first < samples.length && Math.abs(samples[first]!) <= threshold) first++
  let last = samples.length - 1
  while (last > first && Math.abs(samples[last]!) <= threshold) last--
  const start = Math.max(0, first - Math.round((LEAD_PAD_MS / 1000) * sampleRate))
  const end = Math.min(samples.length, last + 1 + Math.round((TAIL_PAD_MS / 1000) * sampleRate))
  const gain = TARGET_PEAK / peak
  const out = new Float32Array(end - start)
  for (let i = 0; i < out.length; i++) out[i] = samples[start + i]! * gain
  return { sampleRate, samples: out }
}

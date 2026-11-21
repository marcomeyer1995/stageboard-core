import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PiperSpeech, runPiperProgram, type SpeechConfig } from './piperSpeech.js'
import { writeWav16Mono } from './wavTrim.js'

/** A stand-in "piper": writes a WAV with 100 ms silence, then a tone, to --output_file. */
function fakePiper(dir: string): string {
  const samples = new Float32Array(4410)
  for (let i = 2205; i < samples.length; i++) samples[i] = Math.sin(i / 3)
  writeFileSync(join(dir, 'clip.wav'), writeWav16Mono({ sampleRate: 22050, samples }))
  const bin = join(dir, 'piper')
  writeFileSync(bin, `#!/bin/sh\ncat > /dev/null\nwhile [ "$1" != "--output_file" ]; do shift; done\ncp "${join(dir, 'clip.wav')}" "$2"\necho call >> "${join(dir, 'calls')}"\n`)
  chmodSync(bin, 0o755)
  writeFileSync(join(dir, 'voice.onnx'), '')
  writeFileSync(join(dir, 'voice.onnx.json'), '{}')
  writeFileSync(join(dir, 'other.onnx'), '')
  writeFileSync(join(dir, 'other.onnx.json'), '{}')
  return bin
}

/** How the engine's text becomes a WAV in these tests: the stand-in program itself, as the speech add-on's helper runs it (the add-on's own path is addons/speechAddon.test.ts). */
const viaProgram = (config: SpeechConfig) => async (text: string, model: string, pace: number): Promise<Uint8Array> => {
  const out = join(mkdtempSync(join(tmpdir(), 'speech-out-')), 'clip.wav')
  await runPiperProgram(model, pace, text, out, config.piperBin)
  return readFileSync(out)
}
const engine = (config: SpeechConfig) => new PiperSpeech(config, viaProgram(config))

describe('Piper speech (#63)', () => {
  it('generates once, trims, then serves from the cache', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'speech-'))
    const speech = engine({ piperBin: fakePiper(dir), voice: join(dir, 'voice.onnx'), voicesDir: dir, cacheDir: join(dir, 'cache') })
    const first = await speech.speak('Chorus')
    const second = await speech.speak('  Chorus ')
    expect(first.ok && first.generated).toBe(true)
    expect(second.ok && !second.generated).toBe(true)
    // 4410 samples with 2205 silent ones -> 5 ms lead pad remains
    if (first.ok) expect(first.wav.length).toBeLessThan(44 + 4410 * 2 - 2000 * 2)
  })

  it('keeps clips of different voices apart, and refuses a voice that is not installed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'speech-'))
    const speech = engine({ piperBin: fakePiper(dir), voice: join(dir, 'voice.onnx'), voicesDir: dir, cacheDir: join(dir, 'cache') })
    expect(await speech.speak('Chorus')).toMatchObject({ ok: true, generated: true })
    expect(await speech.speak('Chorus', 'other')).toMatchObject({ ok: true, generated: true })
    expect(await speech.speak('Chorus', 'missing')).toMatchObject({ ok: false, reason: 'unavailable' })
    // Another pace is another clip; the voice's own pace (1) keeps the old cache key.
    expect(await speech.speak('Chorus', 'other', 1.3)).toMatchObject({ ok: true, generated: true })
    expect(await speech.speak('Chorus', 'other', 1)).toMatchObject({ ok: true, generated: false })
  })

  it('reports unavailable without Piper', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'speech-'))
    const speech = engine({ piperBin: join(dir, 'nope'), voice: join(dir, 'nope.onnx'), voicesDir: dir, cacheDir: join(dir, 'cache') })
    expect(speech.available()).toBe(false)
    expect(await speech.speak('Bridge')).toMatchObject({ ok: false, reason: 'unavailable' })
  })
})

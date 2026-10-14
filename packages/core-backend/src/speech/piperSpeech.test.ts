import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PiperSpeech } from './piperSpeech.js'
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
  return bin
}

describe('Piper speech (#63)', () => {
  it('generates once, trims, then serves from the cache', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'speech-'))
    const speech = new PiperSpeech({ piperBin: fakePiper(dir), voice: join(dir, 'voice.onnx'), cacheDir: join(dir, 'cache') })
    const first = await speech.speak('Chorus')
    const second = await speech.speak('  Chorus ')
    expect(first.ok && first.generated).toBe(true)
    expect(second.ok && !second.generated).toBe(true)
    // 4410 samples with 2205 silent ones -> 5 ms lead pad remains
    if (first.ok) expect(first.wav.length).toBeLessThan(44 + 4410 * 2 - 2000 * 2)
  })

  it('reports unavailable without Piper', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'speech-'))
    const speech = new PiperSpeech({ piperBin: join(dir, 'nope'), voice: join(dir, 'nope.onnx'), cacheDir: join(dir, 'cache') })
    expect(speech.available()).toBe(false)
    expect(await speech.speak('Bridge')).toMatchObject({ ok: false, reason: 'unavailable' })
  })
})

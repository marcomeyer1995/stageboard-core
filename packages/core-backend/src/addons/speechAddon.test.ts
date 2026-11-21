import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PiperSpeech, runPiperProgram, type SpeechConfig } from '../speech/piperSpeech.js'
import { writeWav16Mono } from '../speech/wavTrim.js'
import { createSpeechAddonSynthesize } from './speechAddon.js'

let dir: string
let config: SpeechConfig
const previous = { PIPER_BIN: process.env.PIPER_BIN, STAGEBOARD_STATE_DIR: process.env.STAGEBOARD_STATE_DIR }

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sb-speech-addon-'))
  const voices = join(dir, 'speech', 'piper', 'voices')
  mkdirSync(voices, { recursive: true })
  for (const key of ['de_DE-thorsten-medium', 'en_US-amy-medium']) {
    writeFileSync(join(voices, `${key}.onnx`), 'model')
    writeFileSync(join(voices, `${key}.onnx.json`), '{}')
  }
  // A stand-in for the piper program: it records what it was asked (model, length scale, the text on stdin) in the WAV it writes - 400 samples of
  // silence around 800 samples of "speech", so the trimming that follows has something to cut.
  const fake = join(dir, 'fake-piper.sh')
  writeFileSync(fake, `#!/bin/bash
while [ $# -gt 0 ]; do case "$1" in --model) MODEL="$2"; shift 2;; --length_scale) LS="$2"; shift 2;; --output_file) OUT="$2"; shift 2;; *) shift;; esac; done
TEXT=$(cat)
echo "$MODEL|$LS|$TEXT" >> "${dir}/calls.log"
cp "${dir}/clip.wav" "$OUT"
`)
  chmodSync(fake, 0o755)
  const samples = new Float32Array(1600)
  for (let i = 400; i < 1200; i++) samples[i] = i % 2 === 0 ? 0.25 : -0.25
  writeFileSync(join(dir, 'clip.wav'), writeWav16Mono({ sampleRate: 22050, samples }))
  process.env.PIPER_BIN = fake
  process.env.STAGEBOARD_STATE_DIR = dir
  config = { piperBin: fake, voice: join(voices, 'de_DE-thorsten-medium.onnx'), voicesDir: voices, cacheDir: join(dir, 'cache') }
})
afterAll(() => {
  for (const [k, v] of Object.entries(previous)) v === undefined ? delete process.env[k] : (process.env[k] = v)
  rmSync(dir, { recursive: true, force: true })
})

describe('the speech add-on in the sandbox (#964)', () => {
  it('gives the same clip as the program itself: the add-on only asks Piper, the trimming and cache around it are StageBoard\'s', async () => {
    const direct = async (text: string, model: string, pace: number): Promise<Uint8Array> => {
      const out = join(mkdtempSync(join(tmpdir(), 'speech-direct-')), 'clip.wav')
      await runPiperProgram(model, pace, text, out, config.piperBin)
      return readFileSync(out)
    }
    const viaProgram = await new PiperSpeech({ ...config, cacheDir: join(dir, 'cache-a') }, direct).speak('Chorus', undefined, 1)
    const viaAddon = await new PiperSpeech({ ...config, cacheDir: join(dir, 'cache-b') }, createSpeechAddonSynthesize((model) => (model === config.voice ? '' : model.split('/').pop()!.replace(/\.onnx$/, '')))).speak('Chorus', undefined, 1)
    expect(viaProgram.ok && viaAddon.ok).toBe(true)
    if (viaProgram.ok && viaAddon.ok) {
      expect(Buffer.from(viaAddon.wav).equals(Buffer.from(viaProgram.wav))).toBe(true)
      expect(viaAddon.generated).toBe(true)
    }
  })

  it('passes the text, the voice and the pace to Piper through the add-on and its helper - the add-on is told a key, never a path', async () => {
    const { readFileSync } = await import('node:fs')
    const speech = new PiperSpeech({ ...config, cacheDir: join(dir, 'cache-c') }, createSpeechAddonSynthesize((model) => (model === config.voice ? '' : model.split('/').pop()!.replace(/\.onnx$/, ''))))
    await speech.speak('Bridge', 'en_US-amy-medium', 1.25)
    const lines = readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n')
    expect(lines.at(-1)).toBe(`${join(config.voicesDir, 'en_US-amy-medium.onnx')}|0.8|Bridge`)
  })

  it('the second request for the same clip is served from the cache - Piper is not asked again', async () => {
    const { readFileSync } = await import('node:fs')
    const speech = new PiperSpeech({ ...config, cacheDir: join(dir, 'cache-d') }, createSpeechAddonSynthesize(() => ''))
    const before = readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n').length
    await speech.speak('Verse', undefined, 1)
    const second = await speech.speak('Verse', undefined, 1)
    expect(readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n').length).toBe(before + 1)
    expect(second).toMatchObject({ ok: true, generated: false })
  })

  it('Piper missing is a failed clip with the words, not a hang - the add-on reports what the helper said', async () => {
    const speech = new PiperSpeech({ ...config, cacheDir: join(dir, 'cache-e') }, createSpeechAddonSynthesize(() => 'no-such-voice'))
    const result = await speech.speak('Outro', undefined, 1)
    expect(result).toMatchObject({ ok: false, reason: 'failed' })
    expect(!result.ok && result.message).toMatch(/not installed/)
  })
})

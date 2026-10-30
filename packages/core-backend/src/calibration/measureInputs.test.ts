import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CalibrationRuns } from './calibrationRuns.js'
import { listAudioInputs, MeasureInputStore, measureLevel, parseCaptureList, parseMaxChannels } from './measureInputs.js'

describe('measuring inputs (#662)', () => {
  it('reads the inputs from `arecord -l` and the channels from the hardware parameters', async () => {
    const list = `**** List of CAPTURE Hardware Devices ****
card 1: Generic_1 [HD-Audio Generic], device 0: ALC287 Analog [ALC287 Analog]
  Subdevices: 1/1
card 2: U192k [UMC204HD 192k], device 0: USB Audio [USB Audio]
  Subdevices: 1/1`
    expect(parseCaptureList(list)).toEqual([
      { card: 'Generic_1', cardName: 'HD-Audio Generic', device: 0, deviceName: 'ALC287 Analog' },
      { card: 'U192k', cardName: 'UMC204HD 192k', device: 0, deviceName: 'USB Audio' },
    ])
    expect(parseMaxChannels('FORMAT:  S16_LE\nCHANNELS: 2\nRATE: [44100 192000]')).toBe(2)
    expect(parseMaxChannels('CHANNELS: [1 4]')).toBe(4)
    expect(parseMaxChannels('arecord: audio open error: Device or resource busy')).toBeNull()

    const inputs = await listAudioInputs(async (_cmd, args) =>
      args[0] === '-l' ? { stdout: list, stderr: '' } : args[1]!.includes('U192k') ? { stdout: '', stderr: 'CHANNELS: [2 4]' } : { stdout: '', stderr: 'busy' },
    )
    expect(inputs).toEqual([
      { device: 'plughw:CARD=Generic_1,DEV=0', name: 'HD-Audio Generic – ALC287 Analog', channels: null },
      { device: 'plughw:CARD=U192k,DEV=0', name: 'UMC204HD 192k – USB Audio', channels: 4 },
    ])
  })

  it('keeps the choice in a file; an unset cable falls back to the microphone, an unset microphone to the default', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'measure-')), 'measure-inputs.json')
    const store = new MeasureInputStore(file)
    expect(store.resolve('cable')).toEqual({ device: process.env.CALIBRATION_AUDIO_DEVICE ?? 'default', channel: 0 })
    store.save({ mic: { device: 'plughw:CARD=U192k,DEV=0', channel: 1 }, cable: null })
    expect(new MeasureInputStore(file).resolve('cable')).toEqual({ device: 'plughw:CARD=U192k,DEV=0', channel: 1 })
  })

  it('a run records on the input it was asked for', () => {
    const asked: string[] = []
    const runs = new CalibrationRuns(
      (input) => {
        asked.push(input)
        return { stop: () => {}, onsetsMs: () => [], error: () => null, peak: () => 0 }
      },
      () => 0,
      () => {},
    )
    runs.start(12, 'cable')
    expect(asked).toEqual(['cable'])
    expect(runs.busy()).toBe(true)
  })

  it('the level meter gives the peak in dBFS and the clicks it heard', async () => {
    const level = await measureLevel({ device: 'x', channel: 0 }, 1, () => ({ stop: () => {}, onsetsMs: () => [1, Date.now() + 700, Date.now() + 800], error: () => null, peak: () => 0.5 }))
    expect(level).toEqual({ peakDb: -6, clicks: 2, error: null })
  })
})

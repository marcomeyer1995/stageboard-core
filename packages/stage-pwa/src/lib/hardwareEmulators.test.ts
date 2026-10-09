/**
 * The client translators against the real device emulators (~/Device Emulators): each one opens a
 * real virtual ALSA MIDI port, and here WebMIDI is backed by real ALSA ports (@julusian/midi), so
 * the bytes go the same way as on a tablet and replies (MG-30 identity, Kemper) come back for real.
 * Opt-in - only on a box with the emulators running:
 *
 *   kemper-emulator run --port-name "Kemper A" &  kemper-emulator run --port-name "Kemper B" --channel 2 &
 *   rc500-emulator run &  mg30-emulator run &  cq18t-emulator run &
 *   STAGEBOARD_HW_EMULATORS=1 npx vitest run src/lib/hardwareEmulators.test.ts
 *
 * What the devices did is read from what they answer (Kemper rig name over SysEx, MG-30 identity)
 * or, for the devices without any query (RC-500), from the bytes captured on a monitor port.
 */
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DeviceTransportConfig, LogicalDevice } from 'shared-types'

const enabled = process.env.STAGEBOARD_HW_EMULATORS === '1'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

interface AlsaOut {
  getPortCount(): number
  getPortName(i: number): string
  openPort(i: number): void
  closePort(): void
  sendMessage(bytes: number[]): void
}
interface AlsaIn extends Omit<AlsaOut, 'sendMessage'> {
  ignoreTypes(sysex: boolean, timing: boolean, sensing: boolean): void
  on(event: 'message', cb: (dt: number, bytes: number[]) => void): void
}

const opened: Array<{ closePort(): void }> = []

/** navigator.requestMIDIAccess over real ALSA ports - one output/input object per port name. */
function installAlsaWebMidi() {
  const midi = createRequire(import.meta.url)('@julusian/midi') as { Output: new () => AlsaOut; Input: new () => AlsaIn }
  const probe = new midi.Output()
  const outputs = new Map<string, MIDIOutput>()
  for (let i = 0; i < probe.getPortCount(); i++) {
    const name = probe.getPortName(i).replace(/^RtMidi(In|Out) Client:/, '').replace(/ \d+:\d+$/, '')
    const port = new midi.Output()
    port.openPort(i)
    opened.push(port)
    outputs.set(`out-${i}`, { id: `out-${i}`, name, manufacturer: '', send: (bytes: number[]) => port.sendMessage(Array.from(bytes)) } as unknown as MIDIOutput)
  }
  const inProbe = new midi.Input()
  const inputs = new Map<string, MIDIInput>()
  for (let i = 0; i < inProbe.getPortCount(); i++) {
    const name = inProbe.getPortName(i).replace(/^RtMidi(In|Out) Client:/, '').replace(/ \d+:\d+$/, '')
    const port = new midi.Input()
    port.ignoreTypes(false, true, true)
    port.openPort(i)
    opened.push(port)
    const listeners = new Set<(e: MIDIMessageEvent) => void>()
    port.on('message', (_dt, bytes) => listeners.forEach((l) => l({ data: Uint8Array.from(bytes) } as MIDIMessageEvent)))
    inputs.set(`in-${i}`, {
      id: `in-${i}`,
      name,
      manufacturer: '',
      addEventListener: (_t: string, l: (e: MIDIMessageEvent) => void) => listeners.add(l),
      removeEventListener: (_t: string, l: (e: MIDIMessageEvent) => void) => listeners.delete(l),
    } as unknown as MIDIInput)
  }
  const access = { outputs, inputs, sysexEnabled: true } as unknown as MIDIAccess
  Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => access })
  return { outputs, inputs }
}

/** Sends a raw message to the port named `name` and collects what comes back for `ms`. */
async function ask(ports: ReturnType<typeof installAlsaWebMidi>, name: string, bytes: number[], ms = 400): Promise<number[][]> {
  const out = [...ports.outputs.values()].find((o) => o.name === name)!
  const input = [...ports.inputs.values()].find((i) => i.name === name)!
  const got: number[][] = []
  const l = (e: MIDIMessageEvent) => got.push(Array.from(e.data!))
  input.addEventListener('midimessage', l as unknown as EventListener)
  out.send(bytes)
  await new Promise((r) => setTimeout(r, ms))
  input.removeEventListener('midimessage', l as unknown as EventListener)
  return got
}

const ascii = (bytes: number[]) => String.fromCharCode(...bytes.filter((b) => b >= 0x20 && b < 0x7f))

describe.skipIf(!enabled)('client translators against the device emulators', () => {
  let ports: ReturnType<typeof installAlsaWebMidi>
  let translators: typeof import('./kemperTranslator') & typeof import('./rc500Translator') & typeof import('./mg30Translator') & typeof import('./cq18tTranslator')

  beforeAll(async () => {
    ports = installAlsaWebMidi()
    const { getDeviceId } = await import('./deviceId')
    const { useLogicalDevicesStore } = await import('../store/useLogicalDevicesStore')
    const { useDeviceTransportConfigStore } = await import('../store/useDeviceTransportConfigStore')
    const outId = (name: string) => [...ports.outputs.values()].find((o) => o.name === name)?.id
    for (const name of ['Kemper A', 'Kemper B', 'BOSS RC-500 Emulator', 'NUX MG-30 Emulator', 'Allen & Heath CQ-18T Emulator']) {
      if (!outId(name)) throw new Error(`Emulator port "${name}" missing - start the emulators first (see top of this file)`)
    }
    const device = (id: string, capability: string): LogicalDevice => ({ id, name: id, capability, pluginId: null, executionTarget: getDeviceId() })
    useLogicalDevicesStore.setState({
      devices: [device('kemper-a', 'kemper-control'), device('kemper-b', 'kemper-control'), device('rc500', 'rc500-control'), device('mg30', 'mg30-control'), device('cq18t', 'cq18t-control')],
    })
    const config = (logicalDeviceId: string, port: string, channel = '1'): DeviceTransportConfig => ({
      id: `cfg-${logicalDeviceId}`,
      deviceId: getDeviceId(),
      logicalDeviceId,
      transportId: 'webmidi',
      values: { midiOutputId: outId(port)!, midiChannel: channel },
    })
    useDeviceTransportConfigStore.setState({
      configs: [config('kemper-a', 'Kemper A'), config('kemper-b', 'Kemper B', '2'), config('rc500', 'BOSS RC-500 Emulator'), config('mg30', 'NUX MG-30 Emulator'), config('cq18t', 'Allen & Heath CQ-18T Emulator')],
    })
    translators = { ...(await import('./kemperTranslator')), ...(await import('./rc500Translator')), ...(await import('./mg30Translator')), ...(await import('./cq18tTranslator')) }
  })

  afterAll(() => opened.forEach((p) => p.closePort()))

  it('two Kempers: a cue for Kemper B lands on B (its own channel), not on A (#149/#442)', async () => {
    const { readFileSync } = await import('node:fs')
    const dir = process.env.STAGEBOARD_HW_LOGS
    const lines = (f: string) => (dir ? readFileSync(`${dir}/${f}`, 'utf8').split('\n') : [])
    const before = { a: lines('kemperA.log').length, b: lines('kemperB.log').length }
    const result = await translators.kemperTranslator({ type: 'kemper.stomp', payload: { stomp: 'A', on: true }, logicalDeviceId: 'kemper-b' })
    expect(result.status).toBe('ok')
    await new Promise((r) => setTimeout(r, 300))
    if (dir) {
      const received = (f: string, from: number) => lines(f).slice(from - 1).filter((l) => l.startsWith('<-'))
      expect(received('kemperB.log', before.b).join('\n')).toMatch(/channel=1 control=17 value=127/)
      expect(received('kemperA.log', before.a)).toEqual([])
    }
  })

  it('Kemper selectRig and stomp answer ok on both units', async () => {
    for (const id of ['kemper-a', 'kemper-b']) {
      expect((await translators.kemperTranslator({ type: 'kemper.selectRig', payload: { performance: 3, slot: 2 }, logicalDeviceId: id })).status).toBe('ok')
      expect((await translators.kemperTranslator({ type: 'test', logicalDeviceId: id })).status).toBe('ok')
    }
  })

  it('RC-500: memory select reaches the device; the honest "no test" stays an error', async () => {
    expect((await translators.rc500Translator({ type: 'rc500.selectMemory', payload: { memory: 12 } })).status).toBe('ok')
    expect((await translators.rc500Translator({ type: 'test' })).status).toBe('error')
  })

  it('MG-30: the identity round trip gets the firmware back; patch select and knob are ok', async () => {
    const t = await translators.mg30Translator({ type: 'test' })
    expect(t).toMatchObject({ status: 'ok', message: expect.stringMatching(/^Firmware \S+/) })
    expect((await translators.mg30Translator({ type: 'mg30.selectPatch', payload: { program: 5 } })).status).toBe('ok')
    expect((await translators.mg30Translator({ type: 'mg30.setKnob', payload: { cc: 20, value: 64 } })).status).toBe('ok')
  })

  it('CQ-18T: level and mute are accepted; the read-only Get gets an answer', async () => {
    expect((await translators.cq18tTranslator({ type: 'cq18t.setLevel', payload: { channel: 3, db: -10 } })).status).toBe('ok')
    expect((await translators.cq18tTranslator({ type: 'cq18t.setMute', payload: { channel: 3, muted: true } })).status).toBe('ok')
    // The Get of Ip3's mute must now say "muted" (data LSB 1) - proves the set really arrived.
    const reply = await ask(ports, 'Allen & Heath CQ-18T Emulator', [0xb0, 99, 0x00, 0xb0, 98, 0x02, 0xb0, 96, 0x7f])
    expect(reply).toContainEqual([0xb0, 38, 0x01])
  })

  it('the Kemper answers its rig name over SysEx after a rig change', async () => {
    const reply = await ask(ports, 'Kemper A', [0xf0, 0x00, 0x20, 0x33, 0x02, 0x7f, 0x43, 0x00, 0x00, 0x01, 0xf7])
    expect(ascii(reply.flat())).toContain("Rig A")
  })
})

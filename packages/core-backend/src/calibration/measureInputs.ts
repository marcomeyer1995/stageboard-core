import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MeasureInputsSchema, type AudioInputInfo, type MeasureInput, type MeasureInputKind, type MeasureInputs, type MeasureLevel } from 'shared-types'
import { fallbackMicDevice, SETTLE_MS, startMicCapture, type MicCapture } from './micCapture.js'

export type Exec = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>

const realExec: Exec = (cmd, args) =>
  new Promise((resolve, reject) =>
    // C locale: `arecord -l` speaks German on this box otherwise ("Karte 1: …, Gerät 0: …").
    execFile(cmd, args, { timeout: 4000, env: { ...process.env, LC_ALL: 'C' } }, (err, stdout, stderr) => {
      // --dump-hw-params exits non-zero after printing (it records nothing) - the output counts.
      if (err && !stdout && !stderr) reject(err)
      else resolve({ stdout: String(stdout), stderr: String(stderr) })
    }),
  )

/** `card 1: Generic_1 [HD-Audio Generic], device 0: ALC287 Analog [ALC287 Analog]` → inputs. */
export function parseCaptureList(text: string): { card: string; cardName: string; device: number; deviceName: string }[] {
  const found: { card: string; cardName: string; device: number; deviceName: string }[] = []
  for (const line of text.split('\n')) {
    const match = /^card \d+: (\S+) \[([^\]]*)\], device (\d+): [^[]*\[([^\]]*)\]/.exec(line.trim())
    if (match) found.push({ card: match[1]!, cardName: match[2]!.trim(), device: Number(match[3]), deviceName: match[4]!.trim() })
  }
  return found
}

/** `CHANNELS: 2` or `CHANNELS: [1 4]` → the most channels the device records. */
export function parseMaxChannels(text: string): number | null {
  const match = /^CHANNELS:\s*(?:\[\s*\d+\s+(\d+)\s*\]|(\d+))/m.exec(text)
  if (!match) return null
  return Number(match[1] ?? match[2])
}

/** Every audio input the Stage-Server sees (docs/24 §7.2): a laptop mic, a USB interface, a mixer
 * with interface function. Channels are probed per device; a busy one stays unknown. */
export async function listAudioInputs(exec: Exec = realExec): Promise<AudioInputInfo[]> {
  const { stdout } = await exec('arecord', ['-l']).catch(() => ({ stdout: '', stderr: '' }))
  const inputs: AudioInputInfo[] = []
  for (const entry of parseCaptureList(stdout)) {
    const hw = `hw:CARD=${entry.card},DEV=${entry.device}`
    const probe = await exec('arecord', ['-D', hw, '--dump-hw-params', '-d', '1', '-f', 'S16_LE', '/dev/null']).catch(() => ({ stdout: '', stderr: '' }))
    inputs.push({
      // plughw: converts the rate and format the device offers into what the capture asks for.
      device: `plughw:CARD=${entry.card},DEV=${entry.device}`,
      name: entry.deviceName && entry.deviceName !== entry.cardName ? `${entry.cardName} – ${entry.deviceName}` : entry.cardName,
      channels: parseMaxChannels(`${probe.stdout}\n${probe.stderr}`),
    })
  }
  return inputs
}

const NONE: MeasureInputs = { mic: null, cable: null }

/**
 * The chosen measuring inputs (#662), kept by the Stage-Server itself - they are its hardware, not
 * the band's - in STAGEBOARD_STATE_DIR/measure-inputs.json.
 */
export class MeasureInputStore {
  private selected: MeasureInputs

  constructor(private readonly file = join(process.env.STAGEBOARD_STATE_DIR ?? './data', 'measure-inputs.json')) {
    this.selected = NONE
    try {
      if (existsSync(file)) this.selected = MeasureInputsSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
    } catch {
      this.selected = NONE
    }
  }

  get(): MeasureInputs {
    return this.selected
  }

  save(selected: MeasureInputs): void {
    this.selected = selected
    writeFileSync(this.file, `${JSON.stringify(selected, null, 2)}\n`)
  }

  /** Where a run listens: the chosen input, or for the microphone the server's default. A cable
   * that is not set up falls back to the microphone - better a measurement than none. */
  resolve(kind: MeasureInputKind): MeasureInput {
    return this.selected[kind] ?? this.selected.mic ?? { device: fallbackMicDevice(), channel: 0 }
  }
}

/** A short recording of one input: how loud it got and how many clicks it heard - the level
 * meter and "Testklick" under System → Rig-Check. */
export async function measureLevel(input: MeasureInput, durationMs: number, capture: (input: MeasureInput) => MicCapture = (i) => startMicCapture(i.device, i.channel)): Promise<MeasureLevel> {
  const startedAt = performance.timeOrigin + performance.now()
  const mic = capture(input)
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + durationMs))
  mic.stop()
  const peak = mic.peak()
  // Clicks while the input settles are the input opening, like the level (micCapture.ts).
  const from = startedAt + SETTLE_MS
  return { peakDb: peak > 0 ? Math.round(20 * Math.log10(peak) * 10) / 10 : null, clicks: mic.onsetsMs().filter((at) => at >= from).length, error: mic.error() }
}

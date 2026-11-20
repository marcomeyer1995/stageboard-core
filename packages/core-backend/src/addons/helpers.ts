import { createSocket, type Socket } from 'node:dgram'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { runStemSeparation } from '../stems/stemSeparation.js'
import { messageFieldsOf } from 'shared-types'
import { runYtDlpExtract, runYtDlpSearch } from '../ytDlp.js'
import { BrowserError, createBrowserReader } from './browserHelper.js'
import { runPiperProgram } from '../speech/piperSpeech.js'

/**
 * The helper programs a Node device has (#964, docs/32 §8): the things an add-on cannot do itself and asks StageBoard to run. A helper is a
 * program with the line protocol (`PROGRESS`, `RESULT`), started **by StageBoard** in a work folder of its own, never by the add-on; an add-on may
 * ask only for a helper its manifest declared. Everything here is the device's - on Android the same names are separate helper apps.
 */
export interface HelperOutput {
  result: unknown
  files: { name: string; bytes: Uint8Array }[]
}

export type HelperRun = (args: string[], onProgress: (fraction: number) => void, files: { name: string; bytes: Uint8Array }[]) => Promise<HelperOutput>

/** A work folder for one run, removed after it - whatever the helper left in it is read before. */
async function inWorkFolder<T>(prefix: string, run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * `yt-dlp download <url>` or `yt-dlp search <query>` (the device's yt-dlp; the add-on picks the subcommand, never a flag - an add-on that could pass its
 * own arguments could make yt-dlp run any program). `download`: yt-dlp's own best audio of one video, the file comes back with its extension. `search`:
 * the hits as `{id, title, channel, durationSec, url}`. A failure the person should be told about (too large, no audio, timed out) comes back as
 * `result.error` with a code and parameters; the add-on that asked says it in words.
 */
const ytDlp: HelperRun = async (args, onProgress) => {
  try {
    if (args[0] === 'search') {
      const query = args[1]
      if (!query || query.length > 200) throw new Error('The yt-dlp helper needs a search text of 1-200 characters')
      return { result: { hits: await runYtDlpSearch(query) }, files: [] }
    }
    const url = args[0] === 'download' ? args[1] : undefined
    if (!url || !/^https?:\/\//.test(url)) throw new Error('The yt-dlp helper downloads one http(s) link: yt-dlp download <url>')
    return await inWorkFolder('stageboard-yt-', async (dir) => {
      const { filePath } = await runYtDlpExtract(url, join(dir, 'track.%(ext)s'), onProgress)
      const ext = extname(filePath).replace(/^\./, '')
      return { result: { ext }, files: [{ name: `track.${ext}`, bytes: new Uint8Array(await readFile(filePath)) }] }
    })
  } catch (err) {
    const { messageCode, messageParams } = messageFieldsOf(err)
    if (messageCode) return { result: { error: { code: messageCode, params: messageParams ?? {} } }, files: [] }
    throw err
  }
}

/** `stems <model> [--split-guitar]` with the audio as the file `input`: Demucs through the stems script; one file per stem. */
const stems: HelperRun = (args, onProgress, files) => {
  const input = files.find((f) => f.name === 'input')
  const model = args[0] === 'extended' ? 'extended' : 'standard'
  if (!input) return Promise.reject(new Error('The stems helper needs the audio as the file "input"'))
  return inWorkFolder('stageboard-stems-', async (dir) => {
    await writeFile(join(dir, 'input'), input.bytes)
    const done = await runStemSeparation(join(dir, 'input'), dir, { model, splitGuitar: args.includes('--split-guitar') }, onProgress)
    const out = await Promise.all(done.map(async (file) => ({ name: `${file.key}${file.path.endsWith('.opus') ? '.opus' : '.webm'}`, bytes: new Uint8Array(await readFile(file.path)) })))
    return { result: { stems: done.map((file) => ({ key: file.key, opus: file.path.endsWith('.opus') })) }, files: out }
  })
}

/**
 * `piper <voice key or ""> <pace>` with the text as the file `input`: Piper's raw WAV for it. The helper finds the voice's model file itself - the
 * add-on never sees a path. Piper not installed, or a voice that is not, is an error with the words the app translates.
 */
const piper: HelperRun = async (args, _onProgress, files) => {
  const text = files.find((f) => f.name === 'input')
  if (!text) throw new Error('The piper helper needs the text as the file "input"')
  const { serverSpeech } = await import('../plugins/piperSpeechPlugin.js')
  const voice = args[0] || undefined
  const model = serverSpeech.voiceModel(voice)
  if (!serverSpeech.piperInstalled() || !model) throw new Error(`Piper or the voice ${serverSpeech.voiceName(voice)} is not installed`)
  const pace = Number(args[1]) || 1
  return inWorkFolder('stageboard-piper-', async (dir) => {
    const out = join(dir, 'clip.wav')
    await runPiperProgram(model, pace, new TextDecoder().decode(text.bytes), out)
    return { result: {}, files: [{ name: 'clip.wav', bytes: new Uint8Array(await readFile(out)) }] }
  })
}

/**
 * `ug-page <url>`: Ultimate Guitar's page in a real Chrome, as `{hasData, title, data}` (addons/browserHelper.ts). One Chrome is
 * kept for the device's lifetime. A failure the musician can act on (no Chrome, timeout, UG unreachable) comes back as `result.error` with a code and parameters;
 * the add-on that asked puts it into words - the device knows no add-on's texts.
 */
let ugReader: ReturnType<typeof createBrowserReader> | null = null
const ugPage: HelperRun = async (args) => {
  const url = args[0]
  if (!url || !/^https:\/\/(www\.)?ultimate-guitar\.com\//.test(url)) throw new Error('The ug-page helper opens only ultimate-guitar.com')
  ugReader ??= createBrowserReader()
  try {
    return { result: await ugReader.read(url), files: [] }
  } catch (err) {
    if (err instanceof BrowserError) return { result: { error: { code: err.code, params: err.params } }, files: [] }
    throw err
  }
}

/** `udp-send <host> <port>` with the datagram as the file `packet`: one UDP packet (the OSC add-on's way to the network). One socket for the device. */
let udpSocket: Socket | null = null
const udpSend: HelperRun = async (args, _onProgress, files) => {
  const packet = files.find((f) => f.name === 'packet')
  const host = args[0]
  const port = Number(args[1])
  if (!packet || !host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The udp-send helper needs a host, a port (1-65535) and the file "packet"')
  if (packet.bytes.length > 8192) throw new Error('The udp-send helper sends at most 8192 bytes')
  udpSocket ??= createSocket('udp4')
  const socket = udpSocket
  await new Promise<void>((resolve, reject) => socket.send(packet.bytes, port, host, (err) => (err ? reject(err) : resolve())))
  return { result: {}, files: [] }
}

export const HELPERS: Record<string, HelperRun> = { 'yt-dlp': ytDlp, stems, piper, 'ug-page': ugPage, 'udp-send': udpSend }

/** The `runHelper` a sandbox gets: only what its manifest declared, and only what this device has. */
export function helperRunnerFor(declared: readonly string[]): (helper: string, args: string[], onProgress: (f: number) => void, files: { name: string; bytes: Uint8Array }[]) => Promise<HelperOutput> {
  return (helper, args, onProgress, files) => {
    const run = declared.includes(helper) ? HELPERS[helper] : undefined
    if (!run) return Promise.reject(new Error(`No helper "${helper}"`))
    return run(args, onProgress, files)
  }
}

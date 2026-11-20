import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startNodeSandbox, type NodeSandbox } from './nodeSandbox.js'
import { runYtDlpExtract } from '../ytDlp.js'

/**
 * The YouTube download as an add-on in a sandbox (#964): the add-on's jobs file (`scripts/addons/youtube-download.js`) runs in a Node sandbox
 * (`nodeSandbox.ts`) and asks for its declared helper, `yt-dlp`. This file is the device's part of that: it starts the sandbox when it is first
 * needed (and again if the add-on died), and answers `helper-run yt-dlp` by running the real program in a temp folder and handing the file back.
 * What the sandboxed add-on can reach is what it is given: its own messages, nothing of the band or the disk.
 */
const ADDON_FILE = fileURLToPath(new URL('../../scripts/addons/youtube-download.js', import.meta.url))
const TEN_MINUTES = 10 * 60_000

export type Log = { info: (msg: string, meta?: Record<string, unknown>) => void; error: (msg: string, meta?: Record<string, unknown>) => void }

/** The `yt-dlp` helper: download `url` as yt-dlp's own best audio into a temp folder and return the file. */
async function runYtDlpHelper(args: string[], onProgress: (fraction: number) => void): Promise<{ result: unknown; files: { name: string; bytes: Uint8Array }[] }> {
  const url = args[0]
  if (!url) throw new Error('No link given to the helper')
  const workDir = await mkdtemp(join(tmpdir(), 'stageboard-yt-'))
  try {
    const { filePath } = await runYtDlpExtract(url, join(workDir, 'track.%(ext)s'), onProgress)
    const ext = extname(filePath).replace(/^\./, '')
    return { result: { ext }, files: [{ name: `track.${ext}`, bytes: new Uint8Array(await readFile(filePath)) }] }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

/** A download function for the YouTube recipe (`YoutubeJobContext.download`) that goes through the sandboxed add-on. */
export function createYoutubeAddonDownload(log?: Log): (url: string, onProgress: (fraction: number) => void) => Promise<{ data: Uint8Array; ext: string }> {
  let sandbox: NodeSandbox | null = null
  let starting: Promise<NodeSandbox> | null = null
  const ensure = async (): Promise<NodeSandbox> => {
    if (sandbox?.alive()) return sandbox
    starting ??= startNodeSandbox({
      addonFile: ADDON_FILE,
      name: 'youtube-download',
      helpers: ['yt-dlp'],
      permissions: ['helper:yt-dlp'],
      runHelper: (helper, args, onProgress) => {
        if (helper !== 'yt-dlp') return Promise.reject(new Error(`No helper "${helper}"`))
        return runYtDlpHelper(args, onProgress)
      },
      ...(log ? { log } : {}),
    }).finally(() => (starting = null))
    sandbox = await starting
    return sandbox
  }
  return async (url, onProgress) => {
    const running = await ensure()
    const outcome = await running.runJob({ id: 'youtube-extract', type: 'youtube-extract', input: { url } }, { onProgress, timeoutMs: TEN_MINUTES })
    if (!outcome.ok) throw new Error(outcome.message)
    const file = outcome.files.find((f) => f.key === 'audio')
    if (!file) throw new Error('The add-on returned no audio')
    return { data: file.bytes, ext: typeof outcome.data?.ext === 'string' ? outcome.data.ext : '' }
  }
}

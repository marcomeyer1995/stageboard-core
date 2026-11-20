import { BUILTIN_ADDONS, createAddonHost, type Log } from './addonHost.js'

/** A download function for the YouTube recipe (`YoutubeJobContext.download`) that goes through the sandboxed add-on (#964). */
export function createYoutubeAddonDownload(log?: Log): (url: string, onProgress: (fraction: number) => void) => Promise<{ data: Uint8Array; ext: string }> {
  const sandbox = createAddonHost(BUILTIN_ADDONS.youtubeDownload, log)
  return async (url, onProgress) => {
    const outcome = await (await sandbox()).runJob({ id: 'youtube-extract', type: 'youtube-extract', input: { url } }, { onProgress, timeoutMs: 10 * 60_000 })
    if (!outcome.ok) throw new Error(outcome.message)
    const file = outcome.files.find((f) => f.key === 'audio')
    if (!file) throw new Error('The add-on returned no audio')
    return { data: file.bytes, ext: typeof outcome.data?.ext === 'string' ? outcome.data.ext : '' }
  }
}

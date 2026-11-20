import type { SeparatedStem } from 'sync-host'
import { BUILTIN_ADDONS, createAddonHost, type Log } from './addonHost.js'

/** The `separate` of the stem-separation recipe (`StemJobContext.separate`) that goes through the sandboxed add-on (#964). */
export function createStemAddonSeparate(log?: Log): (audio: Uint8Array, options: { model: 'standard' | 'extended'; splitGuitar: boolean }, onProgress: (fraction: number) => void) => Promise<{ stems: SeparatedStem[] }> {
  const sandbox = createAddonHost(BUILTIN_ADDONS.stemSeparation, log)
  return async (audio, options, onProgress) => {
    // A song takes about a quarter of its length; this is far beyond any real song (the helper has its own limit too).
    const outcome = await (await sandbox()).runJob({ id: 'stem-separation', type: 'stem-separation', input: { audio, model: options.model, splitGuitar: options.splitGuitar } }, { onProgress, timeoutMs: 25 * 60_000 })
    if (!outcome.ok) throw new Error(outcome.message)
    const opus = (outcome.data?.opus ?? {}) as Record<string, boolean>
    return { stems: outcome.files.map((file) => ({ key: file.key, data: file.bytes, opus: opus[file.key] === true })) }
  }
}

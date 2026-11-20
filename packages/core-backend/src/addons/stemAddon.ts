import type { SeparatedStem } from 'sync-host'
import { sharedAddonMethods, type AddonMethods } from './addonMethods.js'

/** The `separate` of the stem-separation recipe (`StemJobContext.separate`) that goes through the sandboxed add-on (#964). */
export function createStemAddonSeparate(methods: AddonMethods = sharedAddonMethods()): (audio: Uint8Array, options: { model: 'standard' | 'extended'; splitGuitar: boolean }, onProgress: (fraction: number) => void) => Promise<{ stems: SeparatedStem[] }> {
  return async (audio, options, onProgress) => {
    // The method's own time limit (its manifest) is far beyond any real song; the helper has one too.
    const answer = await methods.call('stem-separation', 'separate', { audio, model: options.model, splitGuitar: options.splitGuitar }, { onProgress })
    if (!answer.ok) throw new Error(answer.error.message)
    const stems = (answer.body as { stems: { key: string; opus: boolean; data: Uint8Array }[] }).stems
    return { stems: stems.map((stem) => ({ key: stem.key, data: stem.data, opus: stem.opus === true })) }
  }
}

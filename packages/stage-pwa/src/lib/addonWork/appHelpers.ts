import { YoutubeSearchResultSchema } from 'shared-types'
import { HelperError, runHelper, trustedHelper, type HelperInfo } from '../nativeHelper'

/**
 * The helpers a device without Node has (docs/36 §5, #964): what an add-on's work script asks for as `capability.helper` is answered here, by the
 * device's own programs. On Android that is a separate helper app (docs/32 §8) - the same names as on a laptop, a different program behind them. The
 * add-on does not know the difference: it asks `yt-dlp search <text>` or `yt-dlp download <url>` and gets the same answer shape.
 */
export interface AppHelperOutput {
  result: unknown
  files: { name: string; bytes: Uint8Array }[]
}
export type AppHelper = (args: string[], onProgress: (fraction: number) => void, files: { name: string; bytes: Uint8Array }[]) => Promise<AppHelperOutput>

const YOUTUBE_ADDON_ID = 'youtube-download'
type RunHelper = typeof runHelper

/** Failures a person should be told about travel as codes with parameters, exactly as the Node helper reports them. */
const failure = (code: string, params: Record<string, string | number> = {}): AppHelperOutput => ({ result: { error: { code, params } }, files: [] })

/** The Android YouTube helper as `yt-dlp`: `search <text>` -> `{hits}`, `download <url>` -> `{ext}` and the file. Same subcommands, no flags. */
export function androidYtDlp(helper: HelperInfo, trusted: readonly string[], run: RunHelper = runHelper): AppHelper {
  return async (args, onProgress) => {
    if (args[0] !== 'search' && args[0] !== 'download') throw new Error('The yt-dlp helper takes: search <text> or download <url>')
    if (!args[1]) throw new Error(`The yt-dlp helper takes: ${args[0]} <${args[0] === 'search' ? 'text' : 'url'}>`)
    if (!trustedHelper(helper, trusted)) return failure('helper.untrusted')
    try {
      if (args[0] === 'search') {
        const { result } = await run<{ results: unknown[] }>(YOUTUBE_ADDON_ID, helper, 'search', { query: args[1] }, { onProgress })
        const hits = (result.results ?? []).flatMap((r) => {
          const parsed = YoutubeSearchResultSchema.safeParse(r)
          return parsed.success ? [parsed.data] : []
        })
        return { result: { hits }, files: [] }
      }
      const { result, file } = await run<{ codec: string; container: string | null }>(YOUTUBE_ADDON_ID, helper, 'download', { url: args[1] }, { output: true, onProgress })
      if (!file) return failure('youtube.noAudio')
      const ext = result.container ?? (result.codec === 'opus' ? 'webm' : 'm4a')
      return { result: { ext }, files: [{ name: `track.${ext}`, bytes: new Uint8Array(await file.arrayBuffer()) }] }
    } catch (err) {
      if (err instanceof HelperError) return failure(err.code, err.code === 'youtube.tooLarge' ? { mb: 200 } : {})
      throw err
    }
  }
}

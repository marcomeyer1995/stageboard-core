import { describe, expect, it, vi } from 'vitest'
import { HelperError } from '../nativeHelper'
import { androidYtDlp } from './appHelpers'

const helper = { package: 'de.stageboard.helper.youtube', certSha256: 'c'.repeat(64), apiVersion: 1 }
const trusted = ['c'.repeat(64)]
const run = (impl: Parameters<typeof androidYtDlp>[2]) => androidYtDlp(helper, trusted, impl)

describe('the Android helper as the add-on\'s `yt-dlp` helper (docs/36 §5, #964)', () => {
  it('search: the helper\'s results come back as {hits}, the ones that are no result dropped', async () => {
    const call = vi.fn(async () => ({ result: { results: [{ id: 'dQw4w9WgXcQ', title: 'Never Gonna', channel: 'Rick', durationSec: 212, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, { nonsense: true }] }, file: null }))
    const out = await run(call as never)(['search', 'never gonna'], () => {}, [])
    expect(call).toHaveBeenCalledWith('youtube-download', helper, 'search', { query: 'never gonna' }, expect.anything())
    expect(out.result).toEqual({ hits: [expect.objectContaining({ id: 'dQw4w9WgXcQ', title: 'Never Gonna' })] })
  })

  it('download: the file comes back with the container as its extension and the progress is passed on', async () => {
    const file = new Blob([new Uint8Array([1, 2, 3])])
    const call = vi.fn(async (_a: string, _h: unknown, _op: string, _args: unknown, options: { onProgress?: (v: number) => void }) => {
      options.onProgress?.(0.5)
      return { result: { codec: 'opus', container: 'webm', itag: 251 }, file }
    })
    const progress: number[] = []
    const out = await run(call as never)(['download', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'], (f) => progress.push(f), [])
    expect(call).toHaveBeenCalledWith('youtube-download', helper, 'download', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, expect.objectContaining({ output: true }))
    expect(out.result).toEqual({ ext: 'webm' })
    expect([...out.files[0]!.bytes]).toEqual([1, 2, 3])
    expect(progress).toEqual([0.5])
  })

  it('download: a container the helper did not name is guessed from the codec - opus is webm, anything else m4a', async () => {
    const make = (codec: string) => run((async () => ({ result: { codec, container: null }, file: new Blob([new Uint8Array([9])]) })) as never)(['download', 'https://x'], () => {}, [])
    expect((await make('opus')).result).toEqual({ ext: 'webm' })
    expect((await make('aac')).result).toEqual({ ext: 'm4a' })
  })

  it('a helper failure is reported as a code with parameters, the way the Node helper does - the add-on says it in words', async () => {
    const out = await run((async () => { throw new HelperError('youtube.tooLarge', 'too big') }) as never)(['download', 'https://x'], () => {}, [])
    expect(out.result).toEqual({ error: { code: 'youtube.tooLarge', params: { mb: 200 } } })
    const other = await run((async () => { throw new HelperError('helper.cancelled', 'x') }) as never)(['search', 'x'], () => {}, [])
    expect(other.result).toEqual({ error: { code: 'helper.cancelled', params: {} } })
  })

  it('an untrusted helper is refused before anything is asked of it', async () => {
    const call = vi.fn()
    const out = await androidYtDlp(helper, ['d'.repeat(64)], call as never)(['search', 'x'], () => {}, [])
    expect(call).not.toHaveBeenCalled()
    expect(out.result).toEqual({ error: { code: 'helper.untrusted', params: {} } })
  })

  it('takes no flags and no other subcommand - only search and download, as the Node helper', async () => {
    const call = vi.fn()
    for (const args of [['--exec', 'rm'], ['format'], [], ['search'], ['download']]) await expect(run(call as never)(args, () => {}, [])).rejects.toThrow(/search|download/)
    expect(call).not.toHaveBeenCalled()
  })
})

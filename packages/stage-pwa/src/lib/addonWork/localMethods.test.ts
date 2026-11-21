import { describe, expect, it, vi } from 'vitest'
import { createLocalAddonMethods } from './localMethods'
import type { AppHelper } from './appHelpers'
import type { WorkWorkerFactory } from './workHost'

/** The work script runs in-process behind the Worker's message interface. */
const inProcess: WorkWorkerFactory = (code) => {
  const worker = { onmessage: null as ((e: { data: unknown }) => void) | null, onerror: null, terminate: () => {}, postMessage: (m: unknown) => void queueMicrotask(() => scope.onmessage?.({ data: m })) }
  const scope: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: (m: unknown) => void } = { onmessage: null, postMessage: (m) => void queueMicrotask(() => worker.onmessage?.({ data: m })) }
  new Function('self', code)(scope)
  return worker
}

const hits = [{ id: 'dQw4w9WgXcQ', title: 'Never Gonna', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }]
const helper: AppHelper = async (args) => (args[0] === 'search' ? { result: { hits }, files: [] } : { result: { ext: 'webm' }, files: [{ name: 'track.webm', bytes: new Uint8Array([7, 7]) }] })
const methods = (helpers: Record<string, AppHelper> | null) => createLocalAddonMethods({ helpersFor: async () => helpers, language: () => 'de', createWorker: inProcess })

describe('an add-on\'s methods answered on this device (docs/36 §3, #964)', () => {
  it('runs the declared method through the same boundary as a host: the answer is checked against the schema', async () => {
    expect(await methods({ 'yt-dlp': helper }).call('youtube-download', 'search', { query: 'never gonna' })).toMatchObject({ ok: true, body: { hits: [{ title: 'Never Gonna' }] } })
  })

  it('refuses a body the manifest did not describe - the work script is never started', async () => {
    const asked = vi.fn(helper)
    expect(await methods({ 'yt-dlp': asked }).call('youtube-download', 'search', { query: '' })).toMatchObject({ ok: false, error: { code: 'method.input' } })
    expect(await methods({ 'yt-dlp': asked }).call('youtube-download', 'format-disk', {})).toMatchObject({ ok: false, error: { code: 'method.undeclared' } })
    expect(asked).not.toHaveBeenCalled()
  })

  it('canRun: only when this device has every helper the add-on needs - and an unknown add-on never', async () => {
    expect(await methods({ 'yt-dlp': helper }).canRun('youtube-download')).toBe(true)
    expect(await methods(null).canRun('youtube-download')).toBe(false)
    expect(await methods({}).canRun('youtube-download')).toBe(false)
    expect(await methods({ 'yt-dlp': helper }).canRun('no-such-addon')).toBe(false)
  })

  it('a device without the helper says so in the call, with the add-on named', async () => {
    expect(await methods(null).call('youtube-download', 'search', { query: 'x' })).toMatchObject({ ok: false, error: { code: 'helper.missing' } })
  })
})

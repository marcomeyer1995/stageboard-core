import WORK from '../../../../core-backend/scripts/addons/youtube/work.js?raw'
import { describe, expect, it, vi } from 'vitest'
import type { Envelope } from 'shared-types'
import { startWorkHost, type WorkWorkerFactory } from './workHost'
import type { AppHelper } from './appHelpers'


/** The work script runs in-process behind the Worker's message interface - the real script, the real protocol. */
function inProcess(code: string): { factory: (src?: string) => ReturnType<WorkWorkerFactory>; created: () => number; terminated: () => number } {
  let created = 0
  let terminated = 0
  const factory = (src?: string) => {
    created++
    const worker = { onmessage: null as ((e: { data: unknown }) => void) | null, onerror: null, terminate: () => void terminated++, postMessage: (m: unknown) => void queueMicrotask(() => scope.onmessage?.({ data: m })) }
    const scope: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: (m: unknown) => void } = { onmessage: null, postMessage: (m) => void queueMicrotask(() => worker.onmessage?.({ data: m })) }
    new Function('self', src || code)(scope)
    return worker
  }
  return { factory, created: () => created, terminated: () => terminated }
}

const webm = new Uint8Array([1, 2, 3, 4])
const helpers = (impl: AppHelper): Record<string, AppHelper> => ({ 'yt-dlp': impl })
const hostFor = (impl: AppHelper, over: Partial<Parameters<typeof startWorkHost>[0]> = {}) => {
  const w = inProcess(WORK)
  return { w, host: startWorkHost({ code: WORK, name: 'youtube', permissions: ['helper:yt-dlp'], language: 'de', helpers: helpers(impl), createWorker: w.factory, ...over }) }
}
const response = (e: Envelope) => (e.kind === 'response' ? e : null)

describe('the app\'s host for an add-on\'s work script (docs/36 §2, §5, #964)', () => {
  it('runs the real YouTube work script: a request goes in, the helper is asked for the add-on, the answer comes back', async () => {
    const asked: string[][] = []
    const { host } = hostFor(async (args) => (asked.push(args), { result: { hits: [{ id: 'dQw4w9WgXcQ', title: 'Never Gonna', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }] }, files: [] }))
    const answer = response(await host.request('search', { query: 'never gonna' }))
    expect(asked).toEqual([['search', 'never gonna']])
    expect(answer).toMatchObject({ ok: true, body: { hits: [{ title: 'Never Gonna' }] } })
    host.stop()
  })

  it('fetchAudio: the file the helper left comes back as the add-on\'s answer, with the helper\'s progress passed to the caller', async () => {
    const progress: number[] = []
    const { host } = hostFor(async (_args, onProgress) => (onProgress(0.4), { result: { ext: 'webm' }, files: [{ name: 'track.webm', bytes: webm }] }))
    const answer = response(await host.request('fetchAudio', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, { onProgress: (f) => progress.push(f) }))
    expect(answer).toMatchObject({ ok: true, body: { ext: 'webm' } })
    expect([...((answer as { body: { audio: Uint8Array } }).body.audio)]).toEqual([1, 2, 3, 4])
    expect(progress).toEqual([0.4])
  })

  it('the add-on\'s own refusal of a link is its answer, and the helper was never asked', async () => {
    const helper = vi.fn()
    const { host } = hostFor(helper as never)
    expect(response(await host.request('fetchAudio', { url: 'https://evil.example/--exec=rm' }))).toMatchObject({ ok: false, error: { code: 'youtube.urlOnly' } })
    expect(helper).not.toHaveBeenCalled()
  })

  it('a failure the helper reports as a code is said in the add-on\'s words', async () => {
    const { host } = hostFor(async () => ({ result: { error: { code: 'youtube.tooLarge', params: { mb: 200 } } }, files: [] }))
    expect(response(await host.request('fetchAudio', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }))).toMatchObject({ ok: false, error: { code: 'youtube.tooLarge', message: 'Die Audiospur ist größer als das Limit von 200 MB.' } })
  })

  it('a helper the add-on has no permission for is refused - and so is every capability the app does not mediate yet', async () => {
    const helper = vi.fn()
    const noPermission = hostFor(helper as never, { permissions: [] })
    expect(response(await noPermission.host.request('search', { query: 'x' }))).toMatchObject({ ok: false })
    expect(helper).not.toHaveBeenCalled()
    const probe = inProcess('')
    const code = `self.onmessage = function (e) { var m = e.data; if (m.kind === 'request') { self.postMessage({ kind: 'request', id: 9, method: 'capability.http', body: { url: 'https://i.ytimg.com/x' } }) } else if (m.kind === 'response') { self.postMessage({ kind: 'response', id: 1, ok: true, body: m }) } }`
    const host = startWorkHost({ code, name: 'probe', permissions: ['http:https://i.ytimg.com'], language: 'de', helpers: {}, createWorker: () => probe.factory(code) })
    expect(response(await host.request('go', {}))).toMatchObject({ ok: true, body: { kind: 'response', id: 9, ok: false, error: { code: 'capability.unavailable' } } })
  })

  it('an add-on that never answers is stopped when the time is up, and the next request starts it afresh', async () => {
    const silent = inProcess('')
    const code = 'self.onmessage = function () {}'
    const host = startWorkHost({ code, name: 'silent', permissions: [], language: 'de', helpers: {}, createWorker: () => silent.factory(code) })
    expect(response(await host.request('x', {}, { timeoutMs: 50 }))).toMatchObject({ ok: false, error: { code: 'timeout' } })
    expect(silent.terminated()).toBe(1)
    await host.request('x', {}, { timeoutMs: 50 })
    expect(silent.created()).toBe(2)
  })

  it('a script that throws ends what waits for it with an error instead of hanging', async () => {
    const probe = inProcess('')
    let worker: { onerror: ((e: unknown) => void) | null } | null = null
    const code = 'self.onmessage = function () {}'
    const host = startWorkHost({ code, name: 'throws', permissions: [], language: 'de', helpers: {}, createWorker: () => (worker = probe.factory(code) as never) })
    const pending = host.request('x', {}, { timeoutMs: 5000 })
    await Promise.resolve()
    worker!.onerror?.({ message: 'boom' })
    expect(response(await pending)).toMatchObject({ ok: false, error: { code: 'addon.crashed', message: expect.stringContaining('boom') } })
  })
})

describe('midi-out in the app\'s work host: only to the device of the request the add-on serves (docs/36 §5, #964)', () => {
  const MIDI_ADDON = `
    var waiting = {}; var next = 1
    function ask(method, body) { return new Promise(function (resolve) { var id = next++; waiting[id] = resolve; self.postMessage({ kind: 'request', id: id, method: method, body: body }) }) }
    self.onmessage = function (e) {
      var m = e.data
      if (m.kind === 'response') { var w = waiting[m.id]; delete waiting[m.id]; if (w) w(m) }
      else if (m.kind === 'request') {
        var body = Object.assign({}, m.body, { forRequest: m.body.forRequest === 'none' ? undefined : m.id })
        ask('capability.midi-out', body).then(function (answer) { self.postMessage({ kind: 'response', id: m.id, ok: true, body: answer }) })
      }
    }`
  const midiHost = (permissions: string[]) => {
    const w = inProcess(MIDI_ADDON)
    return startWorkHost({ code: MIDI_ADDON, name: 'midi', permissions, language: 'de', helpers: {}, createWorker: w.factory })
  }
  const device = () => {
    const sent: number[][] = []
    return { sent, midi: { send: (bytes: number[]) => void sent.push(bytes), sendAndWait: async (bytes: number[], prefix: number[]) => (sent.push(bytes), Uint8Array.from([...prefix, 9])) } }
  }

  it('sends the bytes to the device the request is for', async () => {
    const d = device()
    const answer = response(await midiHost(['midi-out:*']).request('go', { bytes: [0xc0, 5] }, { midi: d.midi }))
    expect(answer).toMatchObject({ ok: true, body: { ok: true, body: { sent: true } } })
    expect(d.sent).toEqual([[0xc0, 5]])
  })

  it('answers the device\'s reply when the add-on waits for one', async () => {
    const d = device()
    const answer = response(await midiHost(['midi-out:*']).request('go', { bytes: [0xf0, 0xf7], expectReply: { prefix: [0xf0, 0x43], timeoutMs: 500 } }, { midi: d.midi }))
    expect(answer).toMatchObject({ ok: true, body: { ok: true, body: { sent: true, reply: [0xf0, 0x43, 9] } } })
  })

  it('refuses without a device, without the permission, and bytes that are not MIDI - nothing is sent', async () => {
    const d = device()
    expect(response(await midiHost(['midi-out:*']).request('go', { bytes: [0xc0, 5] }))).toMatchObject({ body: { ok: false, error: { code: 'permission.denied' } } })
    expect(response(await midiHost(['midi-out:*']).request('go', { bytes: [0xc0, 5], forRequest: 'none' }, { midi: d.midi }))).toMatchObject({ body: { ok: false, error: { code: 'permission.denied' } } })
    expect(response(await midiHost([]).request('go', { bytes: [0xc0, 5] }, { midi: d.midi }))).toMatchObject({ body: { ok: false, error: { code: 'permission.denied' } } })
    expect(response(await midiHost(['midi-out:*']).request('go', { bytes: [256] }, { midi: d.midi }))).toMatchObject({ body: { ok: false, error: { code: 'capability.invalid' } } })
    expect(response(await midiHost(['midi-out:*']).request('go', { bytes: [0xf0], expectReply: { prefix: [0xf0], timeoutMs: 60_000 } }, { midi: d.midi }))).toMatchObject({ body: { ok: false, error: { code: 'capability.invalid' } } })
    expect(d.sent).toEqual([])
  })
})

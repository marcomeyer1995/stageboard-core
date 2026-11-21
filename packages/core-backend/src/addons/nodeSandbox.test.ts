import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Envelope } from 'shared-types'
import { startNodeSandbox, type NodeSandbox, type NodeSandboxOptions } from './nodeSandbox.js'

const dir = mkdtempSync(join(tmpdir(), 'sb-addon-'))
const running: NodeSandbox[] = []
afterEach(() => {
  for (const sandbox of running.splice(0)) sandbox.stop()
})

/** Writes a classic script - the same kind of file a tablet runs in a Worker - and starts it in the sandbox. */
async function start(name: string, code: string, over: Partial<NodeSandboxOptions> = {}) {
  const addonFile = join(dir, `${name}.js`)
  writeFileSync(addonFile, code)
  const sandbox = await startNodeSandbox({ addonFile, name, ...over })
  running.push(sandbox)
  return sandbox
}

/** An add-on written against the contract: it receives `request` envelopes and answers with `response` envelopes. */
const answers = (body: string) => `self.onmessage = (e) => { if (e.data.kind !== 'request') return; const id = e.data.id; const method = e.data.method; const body = e.data.body; ${body} }`
const respond = (e: Envelope) => (e.kind === 'response' ? e : null)

describe('an add-on in a Node sandbox: requests and responses (#964, docs/36 §4)', () => {
  it('answers a request with a response envelope', async () => {
    const sandbox = await start('echo', answers(`self.postMessage({ kind: 'response', id, ok: true, body: { method, echoed: body } })`))
    expect(await sandbox.request('lookup.search', { query: 'Oasis' }, { timeoutMs: 5_000 })).toEqual({ kind: 'response', id: expect.any(Number), ok: true, body: { method: 'lookup.search', echoed: { query: 'Oasis' } } })
    expect(sandbox.health()).toEqual({ status: 'online' })
  })

  it('carries bytes in both directions - an add-on returns what a helper made as bytes', async () => {
    const sandbox = await start('bytes', answers(`self.postMessage({ kind: 'response', id, ok: true, body: { wav: new Uint8Array([body.audio[0] + 1, 2, 3]) } })`))
    const answer = respond(await sandbox.request('speak', { audio: new Uint8Array([9]) }, { timeoutMs: 5_000 }))
    expect(answer).toMatchObject({ ok: true })
    expect([...((answer as { body: { wav: Uint8Array } }).body.wav)]).toEqual([10, 2, 3])
  })

  it("hands the add-on its settings, permissions and the contract version in `init` - and nothing of the host's environment", async () => {
    const sandbox = await start('init', `let init; self.onmessage = (e) => { if (e.data.type === 'init') init = e.data; if (e.data.kind === 'request') self.postMessage({ kind: 'response', id: e.data.id, ok: true, body: { settings: init.settings, permissions: init.permissions, contractVersion: init.contractVersion, language: init.language } }) }`, { settings: { voice: 'a' }, permissions: ['helper:yt-dlp'], language: 'de' })
    expect(respond(await sandbox.request('x', {}, { timeoutMs: 5_000 }))).toMatchObject({ ok: true, body: { settings: { voice: 'a' }, permissions: ['helper:yt-dlp'], contractVersion: 3, language: 'de' } })
  })

  it("answers with the add-on's own error unchanged", async () => {
    const sandbox = await start('fails', answers(`self.postMessage({ kind: 'response', id, ok: false, error: { code: 'lookup.none', message: 'Kein Treffer' } })`))
    expect(await sandbox.request('x', {}, { timeoutMs: 5_000 })).toEqual({ kind: 'response', id: expect.any(Number), ok: false, error: { code: 'lookup.none', message: 'Kein Treffer' } })
  })

  it('an add-on that throws while handling a request ends that request at once, with the message', async () => {
    const sandbox = await start('crash', answers(`throw new Error('boom')`))
    const answer = respond(await sandbox.request('x', {}, { timeoutMs: 5_000 }))
    // At once - not after the time is up: a request whose add-on threw must not wait for an answer that cannot come.
    expect(answer).toMatchObject({ ok: false, error: { message: expect.stringContaining('boom') } })
    expect(sandbox.health().status).toBe('error')
  })

  it('a request the add-on never answers is a timeout, the add-on is stopped, and a later request says it is not running', async () => {
    const sandbox = await start('silent', answers(`for (;;) {}`))
    expect(await sandbox.request('x', {}, { timeoutMs: 300 })).toMatchObject({ kind: 'response', ok: false, error: { code: 'timeout', params: { method: 'x' } } })
    await new Promise((r) => setTimeout(r, 300))
    expect(sandbox.alive()).toBe(false)
    expect(await sandbox.request('x', {}, { timeoutMs: 100 })).toMatchObject({ ok: false, error: { code: 'addon.stopped', message: 'The add-on is not running' } })
  })

  it('an add-on with a syntax error says so instead of hanging', async () => {
    const sandbox = await start('syntax', 'this is not javascript {{')
    expect(sandbox.alive()).toBe(false)
    expect(sandbox.health().message).toContain('could not start')
  })

  it('a message that is no envelope is dropped, never guessed at - the next request still works', async () => {
    const sandbox = await start('garbage', `self.postMessage({ type: 'job-result', id: 1 }); self.postMessage({ kind: 'response', id: 'x' }); ${answers(`self.postMessage({ kind: 'response', id, ok: true, body: {} })`)}`)
    expect(respond(await sandbox.request('x', {}, { timeoutMs: 5_000 }))).toMatchObject({ ok: true })
  })
})

describe('capabilities are asked for, never held (#964, docs/36 §5)', () => {
  const asks = answers(`self.onmessage = (m) => { if (m.data.kind === 'response') self.postMessage({ kind: 'response', id, ok: true, body: m.data }) }; self.postMessage({ kind: 'request', id: 7, method: 'capability.http', body: { url: 'https://x.example/' } })`)

  it('a `capability.*` request from the add-on is answered with a response envelope - and refused when the device gives none', async () => {
    const withCaps = await start('caps', asks, { capabilities: async (method) => ({ ok: true as const, body: { method } }) })
    expect(respond(await withCaps.request('go', {}, { timeoutMs: 5_000 }))).toMatchObject({ ok: true, body: { kind: 'response', id: 7, ok: true, body: { method: 'capability.http' } } })
    const without = await start('nocaps', asks)
    expect(respond(await without.request('go', {}, { timeoutMs: 5_000 }))).toMatchObject({ ok: true, body: { ok: false, error: { code: 'permission.denied' } } })
  })

  it("a helper's progress reaches the request the add-on says it serves (`forRequest`)", async () => {
    const sandbox = await start('progress', answers(`self.onmessage = (m) => { if (m.data.kind === 'response') self.postMessage({ kind: 'response', id, ok: true, body: {} }) }; self.postMessage({ kind: 'request', id: 5, method: 'capability.helper', body: { helper: 'h', forRequest: id } })`), {
      capabilities: async (_method, _body, hooks) => {
        hooks?.onProgress?.(1, 0.25)
        hooks?.onProgress?.(1, 7) // clamped to 1
        return { ok: true as const, body: {} }
      },
    })
    const seen: number[] = []
    await sandbox.request('go', {}, { timeoutMs: 5_000, onProgress: (f) => seen.push(f) })
    expect(seen).toEqual([0.25, 1])
  })

  it('never gives an add-on `fetch`, a socket or XMLHttpRequest - not even one that declared http; it asks StageBoard instead', async () => {
    const probe = answers(`self.postMessage({ kind: 'response', id, ok: true, body: { fetch: typeof fetch, XMLHttpRequest: typeof XMLHttpRequest, WebSocket: typeof WebSocket, URL: typeof URL } })`)
    for (const permissions of [[], ['http:https://musicbrainz.org']]) {
      const sandbox = await start(`nofetch${permissions.length}`, probe, { permissions })
      expect(respond(await sandbox.request('p', {}, { timeoutMs: 5_000 }))).toMatchObject({ body: { fetch: 'undefined', XMLHttpRequest: 'undefined', WebSocket: 'undefined', URL: 'function' } })
    }
  })
})

describe('what a hostile add-on cannot do (#964) - tried from inside, after breaking out of the vm context', () => {
  // The vm context is not a security boundary: an object from outside lets the script reach the real `process`. What stops it is the permission
  // model the process was started with. This add-on does exactly that, then tries everything it should not be able to do.
  const hostile = `
    const real = self.postMessage.constructor.constructor('return process')()
    const attempt = (fn) => { try { const r = fn(); return 'ALLOWED:' + String(r).slice(0, 20) } catch (e) { return 'denied:' + (e.code || e.message) } }
    self.onmessage = (e) => {
      if (e.data.kind !== 'request') return
      const result = {
        env: Object.keys(real.env),
        readOther: attempt(() => process_require('fs').readFileSync('/etc/hostname')),
        writeFile: attempt(() => process_require('fs').writeFileSync('${dir}/pwned', 'x')),
        spawn: attempt(() => process_require('child_process').execFileSync('echo', ['hi'])),
        worker: attempt(() => new (process_require('worker_threads').Worker)('1', { eval: true })),
      }
      self.postMessage({ kind: 'response', id: e.data.id, ok: true, body: result })
    }
    function process_require(name) { return real.getBuiltinModule(name) }
  `

  it('has no environment, cannot read another file, write one, start a program or a worker', async () => {
    const sandbox = await start('hostile', hostile)
    const answer = respond(await sandbox.request('x', {}, { timeoutMs: 8_000 }))
    expect(answer).toMatchObject({ ok: true })
    const data = (answer as { body: Record<string, unknown> }).body
    expect(data.env).toEqual([])
    expect(data.readOther).toBe('denied:ERR_ACCESS_DENIED')
    expect(data.writeFile).toBe('denied:ERR_ACCESS_DENIED')
    expect(data.spawn).toBe('denied:ERR_ACCESS_DENIED')
    expect(data.worker).toBe('denied:ERR_ACCESS_DENIED')
    expect(existsSync(join(dir, 'pwned'))).toBe(false)
  })
})

describe('an add-on does not outlive its host (#964)', () => {
  it('exits when the connection to the host is gone - even one that keeps a timer running', async () => {
    const { fork } = await import('node:child_process')
    const { fileURLToPath } = await import('node:url')
    const runner = fileURLToPath(new URL('../../scripts/addon_runner.mjs', import.meta.url))
    const addonFile = join(dir, 'ticker.js')
    writeFileSync(addonFile, 'setInterval(function () {}, 1000)')
    const child = fork(runner, [addonFile], { execArgv: ['--permission', `--allow-fs-read=${runner}`, `--allow-fs-read=${addonFile}`], env: {}, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    await new Promise<void>((resolve) => child.once('message', () => resolve()))
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
    child.disconnect()
    expect(await Promise.race([exited, new Promise((r) => setTimeout(() => r('still running'), 3_000))])).toBe(0)
  })
})

describe('cleanup', () => {
  it('removes its temp files', () => rmSync(dir, { recursive: true, force: true }))
})

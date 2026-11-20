import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startNodeSandbox, type NodeSandbox } from './nodeSandbox.js'

const dir = mkdtempSync(join(tmpdir(), 'sb-addon-'))
const running: NodeSandbox[] = []
afterEach(() => {
  for (const sandbox of running.splice(0)) sandbox.stop()
})

/** Writes a classic Worker script - the same kind of file a tablet runs in a Worker - and starts it in the sandbox. */
async function start(name: string, code: string, over: Record<string, unknown> = {}) {
  const addonFile = join(dir, `${name}.js`)
  writeFileSync(addonFile, code)
  const sandbox = await startNodeSandbox({ addonFile, name, ...over })
  running.push(sandbox)
  return sandbox
}
const job = (type = 'demo', input: Record<string, unknown> = {}) => ({ id: 'job-1', type, input })

/** An add-on that answers a job with a function of the job - written as plain Worker JavaScript. */
const answering = (body: string) => `self.onmessage = (e) => { if (e.data.type !== 'job') return; const id = e.data.id; const job = e.data.job; ${body} }`

describe('an add-on in a Node sandbox: the job protocol (#964)', () => {
  it('runs a job: progress comes back, then the files and data the add-on hands over', async () => {
    const sandbox = await start('echo', answering(`self.postMessage({ type: 'job-progress', id, fraction: 0.5 }); self.postMessage({ type: 'job-result', id, ok: true, files: [{ key: 'out', bytes: new Uint8Array([1, 2, 3]) }], data: { echoed: job.input } })`))
    const progress: number[] = []
    const outcome = await sandbox.runJob(job('demo', { url: 'x' }), { onProgress: (f) => progress.push(f), timeoutMs: 5_000 })
    expect(outcome).toMatchObject({ ok: true, data: { echoed: { url: 'x' } } })
    expect(outcome.ok && [...outcome.files[0]!.bytes]).toEqual([1, 2, 3])
    expect(progress).toEqual([0.5])
    expect(sandbox.health()).toEqual({ status: 'online' })
  })

  it('hands the add-on its settings and permissions in `init` - and nothing of the host\'s environment', async () => {
    const sandbox = await start('init', `let init; self.onmessage = (e) => { if (e.data.type === 'init') init = e.data; if (e.data.type === 'job') self.postMessage({ type: 'job-result', id: e.data.id, ok: true, files: [], data: { settings: init.settings, permissions: init.permissions, protocol: init.protocol, language: init.language } }) }`, { settings: { voice: 'a' }, permissions: ['helper:yt-dlp'], language: 'de' })
    expect(await sandbox.runJob(job(), { timeoutMs: 5_000 })).toMatchObject({ ok: true, data: { settings: { voice: 'a' }, permissions: ['helper:yt-dlp'], protocol: 2, language: 'de' } })
  })

  it('a job the add-on ends with an error is an error with its message and code', async () => {
    const sandbox = await start('fails', answering(`self.postMessage({ type: 'job-result', id, ok: false, message: 'video unavailable', messageCode: 'youtube.failed' })`))
    expect(await sandbox.runJob(job(), { timeoutMs: 5_000 })).toEqual({ ok: false, message: 'video unavailable', messageCode: 'youtube.failed' })
  })

  it('an add-on that throws while handling a job ends that job at once, with the message', async () => {
    const sandbox = await start('crash', answering(`throw new Error('boom')`))
    const outcome = await sandbox.runJob(job(), { timeoutMs: 5_000 })
    // At once - not after the time is up: a job whose add-on threw must not wait for an answer that cannot come.
    expect(outcome).toMatchObject({ ok: false, message: expect.stringContaining('boom') })
    expect(sandbox.health().status).toBe('error')
  })

  it('an add-on that never answers is stopped when the time is up - a stuck add-on cannot hold a job', async () => {
    const sandbox = await start('loop', answering(`for (;;) {}`))
    const outcome = await sandbox.runJob(job(), { timeoutMs: 300 })
    expect(outcome).toMatchObject({ ok: false })
    await new Promise((r) => setTimeout(r, 300))
    expect(sandbox.alive()).toBe(false)
    expect(await sandbox.runJob(job(), { timeoutMs: 100 })).toEqual({ ok: false, message: 'The add-on is not running' })
  })

  it('an add-on with a syntax error says so instead of hanging', async () => {
    const sandbox = await start('syntax', 'this is not javascript {{')
    expect(sandbox.alive()).toBe(false)
    expect(sandbox.health().message).toContain('could not start')
  })
})

describe('helper programs only through StageBoard (#964)', () => {
  const asksHelper = (name: string) => answering(`const request = 1; self.onmessage = (m) => { if (m.data.type === 'helper-result') self.postMessage({ type: 'job-result', id, ok: !m.data.error, ...(m.data.error ? { message: m.data.error } : { files: m.data.files, data: { result: m.data.result } }) }) }; self.postMessage({ type: 'helper-run', id, request, helper: '${name}', args: ['--version'] })`)

  it('runs a helper the manifest declared, with the arguments, and gives the add-on its result and files', async () => {
    const calls: string[][] = []
    const sandbox = await start('helper', asksHelper('yt-dlp'), {
      helpers: ['yt-dlp'],
      runHelper: async (helper: string, args: string[], onProgress: (f: number) => void) => {
        calls.push([helper, ...args])
        onProgress(0.25)
        return { result: { codec: 'opus' }, files: [{ name: 'a.webm', bytes: new Uint8Array([9]) }] }
      },
    })
    const progress: number[] = []
    const outcome = await sandbox.runJob(job(), { timeoutMs: 5_000, onProgress: (f) => progress.push(f) })
    expect(calls).toEqual([['yt-dlp', '--version']])
    expect(outcome).toMatchObject({ ok: true, data: { result: { codec: 'opus' } } })
    expect(progress).toEqual([0.25])
  })

  it('refuses a helper the manifest did not declare - the program is never started', async () => {
    let started = false
    const sandbox = await start('sneaky', asksHelper('rm'), { helpers: ['yt-dlp'], runHelper: async () => { started = true; return { result: null, files: [] } } })
    const outcome = await sandbox.runJob(job(), { timeoutMs: 5_000 })
    expect(outcome).toMatchObject({ ok: false, message: 'The add-on did not declare the helper "rm"' })
    expect(started).toBe(false)
  })

  it('says so when this device does not have the declared helper', async () => {
    const sandbox = await start('nohelper', asksHelper('yt-dlp'), { helpers: ['yt-dlp'] })
    expect(await sandbox.runJob(job(), { timeoutMs: 5_000 })).toMatchObject({ ok: false, message: 'This device has no helper "yt-dlp"' })
  })

  it('a helper that fails is an error the add-on can report', async () => {
    const sandbox = await start('helperfails', asksHelper('yt-dlp'), { helpers: ['yt-dlp'], runHelper: async () => { throw new Error('exit 1: no such video') } })
    expect(await sandbox.runJob(job(), { timeoutMs: 5_000 })).toMatchObject({ ok: false, message: 'exit 1: no such video' })
  })
})

describe('what a hostile add-on cannot do (#964) - tried from inside, after breaking out of the vm context', () => {
  // The vm context is not a security boundary: an object from outside lets the script reach the real `process`. What stops it is the permission
  // model the process was started with. This add-on does exactly that, then tries everything it should not be able to do.
  const hostile = `
    const real = self.postMessage.constructor.constructor('return process')()
    const attempt = (fn) => { try { const r = fn(); return 'ALLOWED:' + String(r).slice(0, 20) } catch (e) { return 'denied:' + (e.code || e.message) } }
    self.onmessage = (e) => {
      if (e.data.type !== 'job') return
      const result = {
        env: Object.keys(real.env),
        readOther: attempt(() => process_require('fs').readFileSync('/etc/hostname')),
        writeFile: attempt(() => process_require('fs').writeFileSync('${dir}/pwned', 'x')),
        spawn: attempt(() => process_require('child_process').execFileSync('echo', ['hi'])),
        worker: attempt(() => new (process_require('worker_threads').Worker)('1', { eval: true })),
      }
      self.postMessage({ type: 'job-result', id: e.data.id, ok: true, files: [], data: result })
    }
    function process_require(name) { return real.getBuiltinModule(name) }
  `

  it('has no environment, cannot read another file, write one, start a program or a worker', async () => {
    const sandbox = await start('hostile', hostile)
    const outcome = await sandbox.runJob(job(), { timeoutMs: 8_000 })
    expect(outcome.ok).toBe(true)
    const data = (outcome as { data: Record<string, unknown> }).data
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

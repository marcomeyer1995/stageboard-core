import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createAddonMethods } from './addonMethods.js'

const root = mkdtempSync(join(tmpdir(), 'sb-addons-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** An add-on directory of a test's own: a manifest with one method and a work script. */
function addon(id: string, script: string) {
  mkdirSync(join(root, id), { recursive: true })
  writeFileSync(join(root, id, 'manifest.json'), JSON.stringify({ id, workFile: 'work.js', permissions: [], contributes: { methods: { ping: { in: { type: 'object' }, out: { type: 'object' }, timeoutMs: 5000 } } } }))
  writeFileSync(join(root, id, 'work.js'), script)
}
const ok = `self.onmessage = (e) => { if (e.data.kind === 'request') self.postMessage({ kind: 'response', id: e.data.id, ok: true, body: { pong: true } }) }`

describe('the add-ons of a device (#964)', () => {
  it('a script that fails at start is started afresh once it is fixed (the add-on is not written off for good)', async () => {
    addon('flaky', 'this is not javascript {{')
    const methods = createAddonMethods({ root, dirs: ['flaky'] })
    // The broken script ends its process at start: the call says so... (A start that THROWS is forgotten too - addonMethods.ts - but cannot be provoked here.)
    expect(await methods.call('flaky', 'ping', {})).toMatchObject({ ok: false })
    // ...and when the file is fixed, the same device runs it.
    addon('flaky', ok)
    expect(await methods.call('flaky', 'ping', {})).toEqual({ ok: true, body: { pong: true } })
  })

  it('a sandbox that died is started again by the next call, and parallel calls share one process', async () => {
    addon('lazy', ok)
    const methods = createAddonMethods({ root, dirs: ['lazy'] })
    const answers = await Promise.all([methods.call('lazy', 'ping', {}), methods.call('lazy', 'ping', {}), methods.call('lazy', 'ping', {})])
    expect(answers.every((a) => a.ok)).toBe(true)
  })

  it('knows only the add-ons of its directories - and an unknown one is answered, not a crash', async () => {
    addon('known', ok)
    const methods = createAddonMethods({ root, dirs: ['known'] })
    expect(methods.has('known')).toBe(true)
    expect(methods.has('osc')).toBe(false)
    expect(await methods.call('osc', 'send', {})).toMatchObject({ ok: false, error: { code: 'addon.unknown' } })
  })
})

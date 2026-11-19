import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let current: string | undefined = 'https://tablet'
let listed: { url: string }[] = [{ url: 'https://tablet' }, { url: 'https://laptop' }]
vi.mock('./hostUrl', () => ({ getHostUrl: () => current }))
vi.mock('../store/useBandSettingsStore', () => ({ useBandSettingsStore: { getState: () => ({ settings: { hosts: listed } }) } }))

import { forgetHostCapabilities, resolveHostFor } from './jobHost'

const caps = (speech: boolean) => ({ kind: speech ? 'desktop' : 'android', platform: 'x', arch: 'x', database: 'builtin', plugins: [], jobs: [{ id: 'speech', available: speech, needs: speech ? null : 'an Android version (not built yet)', ...(speech ? {} : { note: 'Slow on a tablet.' }) }] })

const hosts = (answers: Record<string, unknown>) =>
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const key = Object.keys(answers).find((k) => url.startsWith(k))
    return key ? new Response(JSON.stringify(answers[key]), { status: 200 }) : Promise.reject(new TypeError('down'))
  }))

beforeEach(() => {
  forgetHostCapabilities()
  current = 'https://tablet'
  listed = [{ url: 'https://tablet' }, { url: 'https://laptop' }]
})
afterEach(() => vi.unstubAllGlobals())

describe('resolveHostFor (#962)', () => {
  it('a request that is no job goes to the current host without asking anything', async () => {
    hosts({})
    expect(await resolveHostFor('GET', '/time')).toEqual({ base: 'https://tablet' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends speech to the laptop the band lists when the current tablet host cannot', async () => {
    hosts({ 'https://tablet': caps(false), 'https://laptop': caps(true) })
    expect(await resolveHostFor('GET', '/speech')).toEqual({ base: 'https://laptop' })
  })

  it('stays on the current host when it can', async () => {
    hosts({ 'https://tablet': caps(true), 'https://laptop': caps(true) })
    expect(await resolveHostFor('GET', '/speech')).toEqual({ base: 'https://tablet' })
  })

  it('says what is missing, with the host\'s note, when no host can', async () => {
    hosts({ 'https://tablet': caps(false), 'https://laptop': caps(false) })
    const answer = await resolveHostFor('GET', '/speech')
    expect(answer.base).toBeNull()
    expect((answer as { message: string }).message).toContain('an Android version (not built yet)')
    expect((answer as { message: string }).message).toContain('Slow on a tablet.')
  })

  it('is "no host" without a host address', async () => {
    current = undefined
    expect(await resolveHostFor('GET', '/speech')).toEqual({ base: null, message: 'no-host' })
  })
})

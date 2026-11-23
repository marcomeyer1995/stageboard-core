import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let current: string | undefined = 'https://tablet'
let listed: { url: string }[] = [{ url: 'https://tablet' }, { url: 'https://laptop' }]
vi.mock('./hostUrl', () => ({ getHostUrl: () => current }))
vi.mock('../store/useBandSettingsStore', () => ({ useBandSettingsStore: { getState: () => ({ settings: { hosts: listed } }) } }))

import { forgetHostCapabilities, resolveExecutorFor, resolveHostFor } from './jobHost'

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

describe('resolveExecutorFor: this device first, then a host (#964)', () => {
  const yt = (can: boolean, kind: 'desktop' | 'android' = 'desktop') => ({ kind, platform: 'x', arch: 'x', database: 'builtin', cpuCores: 8, jobs: [], plugins: [{ id: 'youtube-download', available: can, needs: can ? null : 'yt-dlp' }] })

  it('does a light job itself when it can - without asking any host', async () => {
    hosts({ 'https://tablet': yt(true), 'https://laptop': yt(true) })
    expect(await resolveExecutorFor('youtube-download', 'light', { canRun: true, power: 8 })).toEqual({ where: 'self' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('hands a heavy job to a clearly stronger host', async () => {
    hosts({ 'https://tablet': yt(false, 'android'), 'https://laptop': yt(true, 'desktop') })
    expect(await resolveExecutorFor('youtube-download', 'heavy', { canRun: true, power: 8 })).toEqual({ where: 'host', url: 'https://laptop' })
  })

  it('a device that cannot goes to the host it is on when that can, else the listed one', async () => {
    hosts({ 'https://tablet': yt(true, 'android'), 'https://laptop': yt(true) })
    expect(await resolveExecutorFor('youtube-download', 'light', { canRun: false, power: 8 })).toEqual({ where: 'host', url: 'https://tablet' })
    forgetHostCapabilities()
    hosts({ 'https://tablet': yt(false, 'android'), 'https://laptop': yt(true) })
    expect(await resolveExecutorFor('youtube-download', 'light', { canRun: false, power: 8 })).toEqual({ where: 'host', url: 'https://laptop' })
  })
})

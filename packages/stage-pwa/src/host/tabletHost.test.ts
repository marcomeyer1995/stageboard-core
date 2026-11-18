import { describe, expect, it, vi } from 'vitest'
import type { BandHostEntry } from 'shared-types'
import { createTabletHost } from './tabletHost'

const SELF = 'tablet'
const tablet = (priority: 1 | 2): BandHostEntry => ({ hostId: SELF, url: 'https://10.0.0.2:8443', priority })
const laptop = (priority: 1 | 2): BandHostEntry => ({ hostId: 'laptop', url: 'https://10.0.0.1:8443', priority })

async function host(hosts: BandHostEntry[] | null, post = vi.fn(async () => ({ accepted: true, epoch: 1, active: false }))) {
  let saved = { epoch: 0, active: false }
  const h = createTabletHost({
    selfHostId: SELF,
    baseEpoch: 1,
    roleStore: { load: () => saved, save: (r) => void (saved = r) },
    workspaceId: () => 'band',
    readHosts: async () => hosts,
    readAccessCode: async () => '12345678',
    post,
    get: async () => null,
    now: () => 1_000,
  })
  await h.service.sendOnce() // reads the list
  return h
}

describe('the tablet on the shared host service (#949)', () => {
  it('serves as the listed primary, and reports its place in the list', async () => {
    const h = await host([tablet(1), laptop(2)])
    expect(h.state()).toEqual({ hostId: SELF, epoch: 1, active: true, outdated: false, priority: 1 })
  })

  it('is passive as the listed backup', async () => {
    const h = await host([laptop(1), tablet(2)])
    expect(h.state()).toMatchObject({ active: false, priority: 2 })
  })

  it('never serves while the band does not list it - the laptop rule "no list, I am the host" is not the tablet\'s', async () => {
    expect((await host(null)).state()).toMatchObject({ active: false, priority: null })
    expect((await host([laptop(1), { ...laptop(2), hostId: 'other' }])).state()).toMatchObject({ active: false, priority: null })
  })

  it('stops serving once the backup answers with a higher epoch', async () => {
    const h = await host([tablet(1), laptop(2)], vi.fn(async () => ({ accepted: true, epoch: 5, active: true })))
    expect(h.state()).toMatchObject({ active: false, outdated: true })
  })

  it('answers the clock with its own time until it has taken over', async () => {
    const h = await host([laptop(1), tablet(2)])
    expect(h.clockOffsetMs()).toBe(0)
    expect(h.bandTime()).toBe(1_000)
  })
})

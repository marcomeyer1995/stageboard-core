import { describe, expect, it, vi } from 'vitest'
import type { BandHostEntry } from 'shared-types'
import { followHostOnce, hostToFollow } from './hostFollow'

const primary: BandHostEntry = { hostId: 'laptop', url: 'https://10.0.0.1:8443', priority: 1 }
const backup: BandHostEntry = { hostId: 'stage-pc', url: 'https://10.0.0.2:8443', priority: 2 }
const HOSTS = [primary, backup]

describe('hostToFollow (#916)', () => {
  it('picks the other host when it announces a higher epoch than the current one', () => {
    expect(hostToFollow(HOSTS, primary.url, 1, { [backup.url]: 2 })).toEqual(backup)
  })

  it('stays when the other host has an equal or lower epoch, is unreachable, or says none', () => {
    expect(hostToFollow(HOSTS, primary.url, 2, { [backup.url]: 2 })).toBeNull()
    expect(hostToFollow(HOSTS, primary.url, 2, { [backup.url]: 1 })).toBeNull()
    expect(hostToFollow(HOSTS, primary.url, 1, { [backup.url]: null })).toBeNull()
    expect(hostToFollow(HOSTS, primary.url, 1, {})).toBeNull()
  })

  it('goes back to the first host only when it has the higher epoch (a handback raises it)', () => {
    expect(hostToFollow(HOSTS, backup.url, 2, { [primary.url]: 3 })).toEqual(primary)
    expect(hostToFollow(HOSTS, backup.url, 2, { [primary.url]: 1 })).toBeNull()
  })

  it('compares addresses without a trailing slash or letter case', () => {
    expect(hostToFollow(HOSTS, 'HTTPS://10.0.0.1:8443/', 1, { [backup.url]: 2 })).toEqual(backup)
  })

  it('does nothing without two hosts, or when the current address is in neither', () => {
    expect(hostToFollow([primary], primary.url, 1, { [primary.url]: 9 })).toBeNull()
    expect(hostToFollow(undefined, primary.url, 1, {})).toBeNull()
    expect(hostToFollow(HOSTS, 'https://elsewhere.local', 1, { [primary.url]: 5, [backup.url]: 5 })).toBeNull()
  })
})

describe('followHostOnce (#916)', () => {
  it('probes the other host and switches to it when it is ahead', async () => {
    const probe = vi.fn().mockResolvedValue(2)
    const switchTo = vi.fn()
    await followHostOnce({ hosts: HOSTS, currentUrl: primary.url, currentEpoch: 1, probe, switchTo })
    expect(probe).toHaveBeenCalledWith(backup.url)
    expect(switchTo).toHaveBeenCalledWith(backup)
  })

  it('does not probe the current host, and does not switch when the other is not ahead', async () => {
    const probe = vi.fn().mockResolvedValue(1)
    const switchTo = vi.fn()
    await followHostOnce({ hosts: HOSTS, currentUrl: primary.url, currentEpoch: 1, probe, switchTo })
    expect(probe).toHaveBeenCalledTimes(1)
    expect(switchTo).not.toHaveBeenCalled()
  })

  it('does not probe at all without two hosts', async () => {
    const probe = vi.fn()
    await followHostOnce({ hosts: [primary], currentUrl: primary.url, currentEpoch: 1, probe, switchTo: vi.fn() })
    expect(probe).not.toHaveBeenCalled()
  })
})

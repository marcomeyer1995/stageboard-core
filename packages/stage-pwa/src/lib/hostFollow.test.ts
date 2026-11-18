import { describe, expect, it, vi } from 'vitest'
import type { BandHostEntry } from 'shared-types'
import { followHostOnce, hostToFollow } from './hostFollow'

const primary: BandHostEntry = { hostId: 'laptop', url: 'https://10.0.0.1:8443', priority: 1 }
const backup: BandHostEntry = { hostId: 'stage-pc', url: 'https://10.0.0.2:8443', priority: 2 }
const HOSTS = [primary, backup]
const seen = (epoch: number, active?: boolean) => ({ epoch, ...(active === undefined ? {} : { active }) })

describe('hostToFollow (#916)', () => {
  it('picks the other host when it announces a higher epoch than the current one', () => {
    expect(hostToFollow(HOSTS, primary.url, { epoch: 1 }, { [backup.url]: seen(2) })).toEqual(backup)
  })

  it('stays when the other host has an equal or lower epoch, is unreachable, or says none', () => {
    expect(hostToFollow(HOSTS, primary.url, { epoch: 2 }, { [backup.url]: seen(2) })).toBeNull()
    expect(hostToFollow(HOSTS, primary.url, { epoch: 2 }, { [backup.url]: seen(1) })).toBeNull()
    expect(hostToFollow(HOSTS, primary.url, { epoch: 1 }, { [backup.url]: null })).toBeNull()
    expect(hostToFollow(HOSTS, primary.url, { epoch: 1 }, {})).toBeNull()
  })

  it('goes back to the first host only when it has the higher epoch (a handback raises it)', () => {
    expect(hostToFollow(HOSTS, backup.url, { epoch: 2 }, { [primary.url]: seen(3) })).toEqual(primary)
    expect(hostToFollow(HOSTS, backup.url, { epoch: 2 }, { [primary.url]: seen(1) })).toBeNull()
  })

  it('compares addresses without a trailing slash or letter case', () => {
    expect(hostToFollow(HOSTS, 'HTTPS://10.0.0.1:8443/', { epoch: 1 }, { [backup.url]: seen(2) })).toEqual(backup)
  })

  it('does nothing without two hosts, or when the current address is in neither', () => {
    expect(hostToFollow([primary], primary.url, { epoch: 1 }, { [primary.url]: seen(9) })).toBeNull()
    expect(hostToFollow(undefined, primary.url, { epoch: 1 }, {})).toBeNull()
    expect(hostToFollow(HOSTS, 'https://elsewhere.local', { epoch: 1 }, { [primary.url]: seen(5), [backup.url]: seen(5) })).toBeNull()
  })
})

describe('hostToFollow after a handback (#938)', () => {
  // The handback leaves both hosts on the same epoch: only the primary is the host now.
  it('leaves a passive host for the active one at the same epoch', () => {
    expect(hostToFollow(HOSTS, backup.url, { epoch: 7, active: false }, { [primary.url]: seen(7, true) })).toEqual(primary)
  })

  it('does not leave the active host for a passive one, whatever the epochs', () => {
    expect(hostToFollow(HOSTS, primary.url, { epoch: 7, active: true }, { [backup.url]: seen(7, false) })).toBeNull()
  })

  it('does not move between two active hosts of the same epoch, or when nothing says who is active (an older host)', () => {
    expect(hostToFollow(HOSTS, backup.url, { epoch: 7, active: true }, { [primary.url]: seen(7, true) })).toBeNull()
    expect(hostToFollow(HOSTS, backup.url, { epoch: 7 }, { [primary.url]: seen(7, true) })).toBeNull()
    expect(hostToFollow(HOSTS, backup.url, { epoch: 7, active: false }, { [primary.url]: seen(7) })).toBeNull()
  })

  it('never goes to an active host with a LOWER epoch (the out-of-date old primary)', () => {
    expect(hostToFollow(HOSTS, backup.url, { epoch: 7, active: false }, { [primary.url]: seen(5, true) })).toBeNull()
  })

  it('a higher epoch still wins, active or not', () => {
    expect(hostToFollow(HOSTS, primary.url, { epoch: 1, active: true }, { [backup.url]: seen(2, true) })).toEqual(backup)
  })
})

describe('followHostOnce (#916)', () => {
  it('probes the other host and switches to it when it is ahead', async () => {
    const probe = vi.fn().mockResolvedValue(seen(2))
    const switchTo = vi.fn()
    await followHostOnce({ hosts: HOSTS, currentUrl: primary.url, currentEpoch: 1, probe, switchTo })
    expect(probe).toHaveBeenCalledWith(backup.url)
    expect(switchTo).toHaveBeenCalledWith(backup)
  })

  it('does not probe the current host, and does not switch when the other is not ahead', async () => {
    const probe = vi.fn().mockResolvedValue(seen(1))
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

  it('returns to the active host at the same epoch when the current one says it is passive', async () => {
    const switchTo = vi.fn()
    await followHostOnce({ hosts: HOSTS, currentUrl: backup.url, currentEpoch: 7, currentActive: false, probe: vi.fn().mockResolvedValue(seen(7, true)), switchTo })
    expect(switchTo).toHaveBeenCalledWith(primary)
  })
})

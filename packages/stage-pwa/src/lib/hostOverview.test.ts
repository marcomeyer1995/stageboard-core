import { describe, expect, it } from 'vitest'
import type { BandHostEntry } from 'shared-types'
import { backupHostOf, describeHosts } from './hostOverview'

const primary: BandHostEntry = { hostId: 'laptop', url: 'https://10.0.0.1:8443', priority: 1 }
const backup: BandHostEntry = { hostId: 'stage-pc', url: 'https://10.0.0.2:8443', priority: 2 }
const HOSTS = [backup, primary] // stored in the "wrong" order on purpose
const probe = (epoch: number, active?: boolean, hostId?: string) => ({ epoch, ...(active === undefined ? {} : { active }), ...(hostId ? { hostId } : {}) })

describe('describeHosts (#941)', () => {
  it('lists the primary first, with its role, and marks the host this device is on', () => {
    const o = describeHosts(HOSTS, { [primary.url]: probe(1, true), [backup.url]: probe(1, false) }, backup.url)
    expect(o.rows.map((r) => [r.hostId, r.role, r.current])).toEqual([['laptop', 'primary', false], ['stage-pc', 'backup', true]])
  })

  it('normal: the primary is the host, the backup stands by', () => {
    const o = describeHosts(HOSTS, { [primary.url]: probe(1, true), [backup.url]: probe(1, false) }, primary.url)
    expect(o.rows.map((r) => r.state)).toEqual(['host', 'standby'])
    expect(o.problem).toBeNull()
  })

  it('after a takeover: the backup is the host, the primary is gone - a hint, not a fault (the show goes on)', () => {
    const o = describeHosts(HOSTS, { [primary.url]: null, [backup.url]: probe(2, true) }, backup.url)
    expect(o.rows.map((r) => r.state)).toEqual(['unreachable', 'host'])
    expect(o.problem).toBeNull()
    expect(o.rows[0]!.status).toBe('warning')
  })

  it('a returned primary that has not handed back yet is out of date', () => {
    const o = describeHosts(HOSTS, { [primary.url]: probe(1, false), [backup.url]: probe(2, true) }, backup.url)
    expect(o.rows.map((r) => r.state)).toEqual(['outdated', 'host'])
  })

  it('the backup missing is a warning: there is no safety net', () => {
    const o = describeHosts(HOSTS, { [primary.url]: probe(1, true), [backup.url]: null }, primary.url)
    expect(o.rows.map((r) => r.state)).toEqual(['host', 'unreachable'])
    expect(o.rows[1]!.status).toBe('warning')
  })

  it('nobody is the host: nothing answers, or only a backup that has not taken over yet', () => {
    expect(describeHosts(HOSTS, { [primary.url]: null, [backup.url]: null }, primary.url).problem).toBe('none-reachable')
    expect(describeHosts(HOSTS, { [primary.url]: null, [backup.url]: probe(1, false) }, backup.url).problem).toBe('no-host')
  })

  it('two hosts both say they are the host: a split, shown as an error', () => {
    const o = describeHosts(HOSTS, { [primary.url]: probe(1, true), [backup.url]: probe(2, true) }, primary.url)
    expect(o.problem).toBe('two-hosts')
  })

  it('a host that says nothing about being active (an older build) is unknown, never a problem on its own', () => {
    const o = describeHosts(HOSTS, { [primary.url]: probe(1), [backup.url]: probe(1) }, primary.url)
    expect(o.rows.map((r) => r.state)).toEqual(['unknown', 'unknown'])
    expect(o.problem).toBeNull()
  })

  it('shows the epoch a host announced, and no epoch for one that did not answer', () => {
    const o = describeHosts(HOSTS, { [primary.url]: null, [backup.url]: probe(4, true) }, backup.url)
    expect(o.rows.map((r) => r.epoch)).toEqual([null, 4])
  })

  it('is empty without two hosts', () => {
    expect(describeHosts([primary], { [primary.url]: probe(1, true) }, primary.url)).toEqual({ rows: [], problem: null })
    expect(describeHosts(undefined, {}, primary.url)).toEqual({ rows: [], problem: null })
  })

  it('finds a probe by address without a trailing slash, and matches the current address the same way', () => {
    const o = describeHosts(HOSTS, { 'https://10.0.0.1:8443/': probe(1, true), [backup.url]: probe(1, false) }, 'HTTPS://10.0.0.2:8443/')
    expect(o.rows.map((r) => [r.state, r.current])).toEqual([['host', false], ['standby', true]])
  })
})

describe('backupHostOf (#941)', () => {
  it('names the backup when this device is on it, and nothing on the primary', () => {
    expect(backupHostOf(HOSTS, backup.url)).toBe('stage-pc')
    expect(backupHostOf(HOSTS, primary.url)).toBeNull()
  })

  it('is nothing without two hosts, without an address, or on an address that is in neither', () => {
    expect(backupHostOf([backup], backup.url)).toBeNull()
    expect(backupHostOf(undefined, backup.url)).toBeNull()
    expect(backupHostOf(HOSTS, undefined)).toBeNull()
    expect(backupHostOf(HOSTS, 'https://elsewhere.local')).toBeNull()
  })

  it('matches the address without a trailing slash or letter case', () => {
    expect(backupHostOf(HOSTS, 'HTTPS://10.0.0.2:8443/')).toBe('stage-pc')
  })
})

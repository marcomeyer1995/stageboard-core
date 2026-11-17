import { describe, expect, it } from 'vitest'
import type { BandHostEntry } from 'shared-types'
import { assignHostRole, removeHostRole } from './bandHosts'

const laptop = { hostId: 'laptop', url: 'https://10.0.0.1:8443', certFingerprint: 'a'.repeat(64) }
const stagePc = { hostId: 'stage-pc', url: 'https://10.0.0.2:8443', certFingerprint: 'b'.repeat(64) }
const third = { hostId: 'third', url: 'https://10.0.0.3:8443' }
const ids = (hosts: BandHostEntry[]) => hosts.map((h) => `${h.hostId}:${h.priority}`)

describe('assignHostRole (#914)', () => {
  it('sets the first host as primary or backup', () => {
    expect(ids(assignHostRole(undefined, laptop, 'primary'))).toEqual(['laptop:1'])
    expect(ids(assignHostRole([], laptop, 'backup'))).toEqual(['laptop:2'])
  })

  it('keeps the other role when one is set', () => {
    const hosts = assignHostRole(assignHostRole([], laptop, 'primary'), stagePc, 'backup')
    expect(ids(hosts)).toEqual(['laptop:1', 'stage-pc:2'])
  })

  it('moves a host that already has a role - one host never holds both', () => {
    const hosts = assignHostRole(assignHostRole([], laptop, 'primary'), laptop, 'backup')
    expect(ids(hosts)).toEqual(['laptop:2'])
  })

  it('a new primary replaces the old one, which loses its role; the backup stays', () => {
    const start = assignHostRole(assignHostRole([], laptop, 'primary'), stagePc, 'backup')
    expect(ids(assignHostRole(start, third, 'primary'))).toEqual(['third:1', 'stage-pc:2'])
  })

  it('updates address and fingerprint when the same host is set again', () => {
    const moved = { ...laptop, url: 'https://10.0.0.9:8443' }
    const hosts = assignHostRole(assignHostRole([], laptop, 'primary'), moved, 'primary')
    expect(hosts).toHaveLength(1)
    expect(hosts[0]!.url).toBe('https://10.0.0.9:8443')
  })

  it('always gives a list the band settings accept', async () => {
    const { BandHostsSchema } = await import('shared-types')
    const hosts = assignHostRole(assignHostRole(assignHostRole([], laptop, 'backup'), stagePc, 'primary'), third, 'backup')
    expect(BandHostsSchema.safeParse(hosts).success).toBe(true)
  })

  it('does not change the list it was given', () => {
    const start = assignHostRole([], laptop, 'primary')
    assignHostRole(start, stagePc, 'primary')
    expect(ids(start)).toEqual(['laptop:1'])
  })
})

describe('removeHostRole (#914)', () => {
  it('takes a host out, leaves the other, and ignores an unknown id', () => {
    const start = assignHostRole(assignHostRole([], laptop, 'primary'), stagePc, 'backup')
    expect(ids(removeHostRole(start, 'laptop'))).toEqual(['stage-pc:2'])
    expect(ids(removeHostRole(start, 'nobody'))).toEqual(['laptop:1', 'stage-pc:2'])
    expect(removeHostRole(undefined, 'laptop')).toEqual([])
  })
})

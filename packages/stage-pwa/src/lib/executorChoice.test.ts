import { describe, expect, it } from 'vitest'
import type { HostCapabilities } from 'shared-types'
import { chooseExecutor, powerOf } from './executorChoice'

const caps = (kind: 'desktop' | 'android', cores: number, can: string[] = []): HostCapabilities =>
  ({ kind, platform: kind === 'desktop' ? 'linux' : 'android', arch: 'x', database: 'builtin', cpuCores: cores, jobs: [], plugins: can.map((id) => ({ id, available: true, needs: null })) }) as unknown as HostCapabilities
const cannot = (kind: 'desktop' | 'android', cores: number): HostCapabilities =>
  ({ ...caps(kind, cores), plugins: [{ id: 'youtube-download', available: false, needs: 'yt-dlp', note: 'install yt-dlp' }] }) as unknown as HostCapabilities
const JOB = 'plugin:youtube-download'
const laptop = { url: 'https://laptop', capabilities: caps('desktop', 16, ['youtube-download']) }
const tabletNo = { url: 'https://tablet', capabilities: cannot('android', 8) }
const tabletYes = { url: 'https://tablet2', capabilities: caps('android', 8, ['youtube-download']) }

describe('chooseExecutor: first this device itself, then the host that can - unless elsewhere is clearly faster (#964)', () => {
  it('a light job runs on this device when it can, even with a laptop host in reach', () => {
    expect(chooseExecutor({ job: JOB, load: 'light', self: { canRun: true, power: 8 }, current: laptop, others: [] })).toEqual({ where: 'self' })
  })

  it('a heavy job leaves this device for a host that is clearly stronger', () => {
    expect(chooseExecutor({ job: JOB, load: 'heavy', self: { canRun: true, power: 8 }, current: laptop, others: [] })).toEqual({ where: 'host', url: 'https://laptop' })
  })

  it('a heavy job stays on this device when the host is no stronger (a tablet next to a tablet)', () => {
    expect(chooseExecutor({ job: JOB, load: 'heavy', self: { canRun: true, power: 8 }, current: tabletYes, others: [] })).toEqual({ where: 'self' })
  })

  it('a heavy job stays on this device when no host can do it at all', () => {
    expect(chooseExecutor({ job: JOB, load: 'heavy', self: { canRun: true, power: 8 }, current: tabletNo, others: [] })).toEqual({ where: 'self' })
  })

  it('a device that cannot do it uses the host it is on, when that one can', () => {
    expect(chooseExecutor({ job: JOB, load: 'light', self: { canRun: false, power: 8 }, current: laptop, others: [{ url: 'https://other', capabilities: caps('desktop', 4, ['youtube-download']) }] })).toEqual({ where: 'host', url: 'https://laptop' })
  })

  it('...else another host of the band that can - the strongest one when several can', () => {
    const weak = { url: 'https://weak', capabilities: caps('desktop', 4, ['youtube-download']) }
    const strong = { url: 'https://strong', capabilities: caps('desktop', 16, ['youtube-download']) }
    expect(chooseExecutor({ job: JOB, load: 'light', self: { canRun: false, power: 8 }, current: tabletNo, others: [weak, strong] })).toEqual({ where: 'host', url: 'https://weak' })
    expect(chooseExecutor({ job: JOB, load: 'heavy', self: { canRun: false, power: 8 }, current: tabletNo, others: [weak, strong] })).toEqual({ where: 'host', url: 'https://strong' })
  })

  it('a host that says nothing (older, unreachable) is asked as before', () => {
    expect(chooseExecutor({ job: JOB, load: 'light', self: { canRun: false, power: 8 }, current: { url: 'https://old', capabilities: null }, others: [] })).toEqual({ where: 'host', url: 'https://old' })
  })

  it('nothing can: says what is missing, from the host that said it', () => {
    expect(chooseExecutor({ job: JOB, load: 'light', self: { canRun: false, power: 8 }, current: tabletNo, others: [] })).toEqual({ where: 'none', needs: 'yt-dlp', note: 'install yt-dlp' })
  })
})

describe('powerOf', () => {
  it('weighs a desktop host above a tablet with as many cores, and counts cores', () => {
    expect(powerOf(caps('desktop', 8))).toBeGreaterThan(powerOf(caps('android', 8)))
    expect(powerOf(caps('android', 8))).toBeGreaterThan(powerOf(caps('android', 4)))
    expect(powerOf({ kind: 'android' } as unknown as HostCapabilities)).toBeGreaterThan(0)
  })
})

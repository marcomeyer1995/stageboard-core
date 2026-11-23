import { describe, expect, it } from 'vitest'
import { HostCapabilitiesSchema } from 'shared-types'
import { JOB_IDS } from 'sync-host'
import { createTabletCapabilities } from './tabletCapabilities'

describe('what a tablet host can do (#962)', () => {
  it('says what it lacks for every job and heavy plugin, in an answer the schema accepts', () => {
    const caps = createTabletCapabilities({ platform: 'android', arch: 'arm64', cpuCores: 8, memoryMb: 4096 })
    expect(HostCapabilitiesSchema.parse(caps)).toEqual(caps)
    expect(caps.jobs.map((job) => job.id).sort()).toEqual([...JOB_IDS].sort())
    expect(caps.jobs.every((job) => !job.available && job.needs)).toBe(true)
    expect(caps.plugins.find((plugin) => plugin.id === 'stem-separation')).toMatchObject({ available: false })
  })

  it('says "not built yet" rather than "impossible", and explains why a heavy job is slow and how to improve it (Marco: everything feasible is allowed)', () => {
    const caps = createTabletCapabilities({ platform: 'android' })
    const stems = caps.plugins.find((plugin) => plugin.id === 'stem-separation')
    expect(stems?.needs).toMatch(/not built yet/)
    expect(stems?.needs).not.toMatch(/desktop/i)
    expect(stems?.note).toMatch(/overnight/)
    expect(stems?.note).toMatch(/laptop/)
    expect(caps.jobs.find((job) => job.id === 'speech')?.note).toMatch(/much longer/)
  })

  it('knows YouTube already runs on the tablet itself through the Android helper', () => {
    const youtube = createTabletCapabilities({ platform: 'android' }).plugins.find((plugin) => plugin.id === 'youtube-download')
    expect(youtube?.note).toMatch(/Android helper/)
  })

  it('leaves out what it cannot tell instead of inventing it', () => {
    const caps = createTabletCapabilities({ platform: 'android' })
    expect(caps).not.toHaveProperty('cpuCores')
    expect(caps).not.toHaveProperty('memoryMb')
  })

  it('says a plug-in is available when this device can run it itself (its helper app is here) - and only that one (#964)', () => {
    const caps = createTabletCapabilities({ platform: 'android' }, ['youtube-download'])
    expect(caps.plugins.find((plugin) => plugin.id === 'youtube-download')).toMatchObject({ available: true })
    expect(caps.plugins.find((plugin) => plugin.id === 'stem-separation')).toMatchObject({ available: false })
    expect(HostCapabilitiesSchema.parse(caps)).toEqual(caps)
  })
})

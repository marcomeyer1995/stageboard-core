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

  it('leaves out what it cannot tell instead of inventing it', () => {
    const caps = createTabletCapabilities({ platform: 'android' })
    expect(caps).not.toHaveProperty('cpuCores')
    expect(caps).not.toHaveProperty('memoryMb')
  })
})

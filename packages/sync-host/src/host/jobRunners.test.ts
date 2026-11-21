import { describe, expect, it } from 'vitest'
import { HostCapabilitiesSchema } from 'shared-types'
import { JOB_IDS } from './capabilities.js'
import { createJobRunners, type DeviceDescription } from './jobRunners.js'

const laptop: DeviceDescription = { kind: 'desktop', platform: 'linux', arch: 'x64', cpuCores: 16, memoryMb: 32768 }
const tablet: DeviceDescription = { kind: 'android', platform: 'android', arch: 'arm64', cpuCores: 8, memoryMb: 4096 }
const NOT_BUILT = 'an Android version of it (not built yet)'
const options = { plugins: ['stem-separation', 'osc', 'mock-x'], notBuilt: NOT_BUILT }

describe('what a host can do, from the runners it has (#964)', () => {
  it('lists every job of the shared table; a job nobody registered is unavailable and says it is not built', () => {
    const caps = createJobRunners().capabilities(tablet, options)
    expect(HostCapabilitiesSchema.parse(caps)).toEqual(caps)
    expect(caps.jobs.map((j) => j.id).sort()).toEqual([...JOB_IDS].sort())
    expect(caps.jobs.every((j) => !j.available && j.needs === NOT_BUILT)).toBe(true)
  })

  it('a registered runner is available, or says what it lacks - and keeps the note the person reads', () => {
    const runners = createJobRunners([
      { id: 'backup', kind: 'job' },
      { id: 'speech', kind: 'job', missing: () => 'piper', note: 'Install piper, or use a laptop.' },
    ])
    const caps = runners.capabilities(laptop, options)
    expect(caps.jobs.find((j) => j.id === 'backup')).toEqual({ id: 'backup', available: true, needs: null })
    expect(caps.jobs.find((j) => j.id === 'speech')).toEqual({ id: 'speech', available: false, needs: 'piper', note: 'Install piper, or use a laptop.' })
  })

  it('what a runner\'s manifest asks of the device (runsOn) decides too - an add-on for Windows or Linux is not available on Android', () => {
    const runners = createJobRunners([{ id: 'stem-separation', kind: 'plugin', runsOn: { platforms: ['win32', 'linux'], minMemoryMb: 8192 } }])
    expect(runners.capabilities(laptop, options).plugins.find((p) => p.id === 'stem-separation')).toMatchObject({ available: true })
    const onTablet = runners.capabilities(tablet, options).plugins.find((p) => p.id === 'stem-separation')
    expect(onTablet?.available).toBe(false)
    expect(onTablet?.needs).toContain('win32, linux')
  })

  it('a plugin of the build with no runner needs nothing special', () => {
    expect(createJobRunners().capabilities(laptop, options).plugins.find((p) => p.id === 'osc')).toEqual({ id: 'osc', available: true, needs: null })
  })

  it('the capabilities carry the device\'s power only when it is known', () => {
    const caps = createJobRunners().capabilities({ kind: 'android', platform: 'android', arch: 'arm64' }, options)
    expect(caps).not.toHaveProperty('cpuCores')
    expect(caps).not.toHaveProperty('memoryMb')
  })
})

describe('which capability a background job needs, from the runners (#964)', () => {
  it('is the id of the runner that works on that job type - a plugin as plugin:<id>', () => {
    const runners = createJobRunners([
      { id: 'stem-separation', kind: 'plugin', asyncJobType: 'stem-separation' },
    ])
    // An add-on's audio needs that add-on - from the job itself, no runner has to name the job type.
    expect(runners.needsOfJob({ type: 'audio-import', addonId: 'some-addon' })).toBe('plugin:some-addon')
    expect(runners.needsOfJob({ type: 'audio-import' })).toBeNull()
    expect(runners.needsOfJob({ type: 'stem-separation' })).toBe('plugin:stem-separation')
  })

  it('is null for a job no runner works on - a device\'s conversion, or one this host cannot do at all', () => {
    expect(createJobRunners().needsOfJob({ type: 'opus-convert' })).toBeNull()
  })

  it('a runner registered later replaces an earlier one of the same id (an add-on that updates)', () => {
    const runners = createJobRunners([{ id: 'speech', kind: 'job', missing: () => 'piper' }])
    runners.register({ id: 'speech', kind: 'job' })
    expect(runners.capabilities(laptop, options).jobs.find((j) => j.id === 'speech')?.available).toBe(true)
  })
})

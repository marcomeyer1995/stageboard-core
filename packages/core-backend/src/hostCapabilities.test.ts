import { describe, expect, it } from 'vitest'
import { HostCapabilitiesSchema } from 'shared-types'
import { createJobRunners } from 'sync-host'
import { addonHostNeeds, hostCapabilities } from './hostCapabilities.js'
import { builtinRunners } from './builtinRunners.js'

describe('hostCapabilities (docs/25 §6, 2026-11-07)', () => {
  it('names per server plugin whether it runs here and what it lacks; test plugins left out', () => {
    const caps = hostCapabilities(createJobRunners([{ id: 'stem-separation', kind: 'plugin', missing: () => 'demucs' }, { id: 'youtube-download', kind: 'plugin' }]), ['stem-separation', 'youtube-download', 'osc', 'mock-mixer'])
    expect(HostCapabilitiesSchema.parse(caps)).toEqual(caps)
    expect(caps.kind).toBe('desktop')
    expect(caps.cpuCores).toBeGreaterThan(0)
    expect(caps.plugins).toEqual([
      { id: 'stem-separation', available: false, needs: 'demucs' },
      { id: 'youtube-download', available: true, needs: null },
      { id: 'osc', available: true, needs: null },
    ])
  })

  it('reports the database the host runs on: the built-in one, there is no other (#960)', () => {
    expect(hostCapabilities(createJobRunners(), []).database).toBe('builtin')
  })

  it('names per job whether this machine can do it: a missing tool is what a job lacks, everything else a Node machine does (#962)', () => {
    const caps = hostCapabilities(createJobRunners([{ id: 'speech', kind: 'job', missing: () => 'piper' }, { id: 'lookup', kind: 'job' }, { id: 'backup', kind: 'job' }]), [])
    expect(caps.jobs.find((job) => job.id === 'speech')).toEqual({ id: 'speech', available: false, needs: 'piper' })
    expect(caps.jobs.find((job) => job.id === 'lookup')).toEqual({ id: 'lookup', available: true, needs: null })
    expect(caps.jobs.find((job) => job.id === 'backup')).toEqual({ id: 'backup', available: true, needs: null })
  })
})

describe('addonHostNeeds (#962, step 4)', () => {
  const base = { ...hostCapabilities(createJobRunners(), []), kind: 'desktop' as const, platform: 'linux', cpuCores: 8, memoryMb: 16384 }

  it('only the jobs file is limited: an add-on without one runs anywhere', () => {
    expect(addonHostNeeds({ runsOn: { platforms: ['win32'] } }, base)).toBeNull()
  })

  it('a jobs file that needs another platform or more power is refused with what is missing', () => {
    expect(addonHostNeeds({ jobsFile: 'jobs.js', runsOn: { platforms: ['win32'] } }, base)).toContain('win32')
    expect(addonHostNeeds({ jobsFile: 'jobs.js', runsOn: { minMemoryMb: 65536 } }, base)).toContain('65536 MB')
    expect(addonHostNeeds({ jobsFile: 'jobs.js', runsOn: { platforms: ['linux'], minCpuCores: 4 } }, base)).toBeNull()
    expect(addonHostNeeds({ jobsFile: 'jobs.js' }, base)).toBeNull()
  })
})

describe('the runners a Node host ships with (#964)', () => {
  it('declares a runner for every job of the shared table - none is left to be "not built" on a laptop', () => {
    const caps = hostCapabilities(builtinRunners(), [])
    expect(caps.jobs.filter((j) => j.needs === 'a runner for it on this host')).toEqual([])
  })

  it('says which background job type each heavy runner works on, so the queue knows what a job needs', () => {
    const runners = builtinRunners()
    expect(runners.needsOfJob({ type: 'audio-import', addonId: 'youtube-download' })).toBe('plugin:youtube-download')
    expect(runners.needsOfJob({ type: 'stem-separation' })).toBe('plugin:stem-separation')
    expect(runners.needsOfJob({ type: 'opus-convert' })).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { HostCapabilitiesSchema } from 'shared-types'
import { addonHostNeeds, hostCapabilities } from './hostCapabilities.js'

describe('hostCapabilities (docs/25 §6, 2026-11-07)', () => {
  it('names per server plugin whether it runs here and what it lacks; test plugins left out', () => {
    const caps = hostCapabilities({ 'stem-separation': () => 'demucs', 'youtube-download': () => null }, ['stem-separation', 'youtube-download', 'osc', 'mock-mixer'])
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
    expect(hostCapabilities({}, []).database).toBe('builtin')
  })

  it('names per job whether this machine can do it: a missing tool is what a job lacks, everything else a Node machine does (#962)', () => {
    const caps = hostCapabilities({ 'youtube-download': () => 'yt-dlp', 'piper-speech': () => null }, [])
    expect(caps.jobs.find((job) => job.id === 'youtube-download')).toEqual({ id: 'youtube-download', available: false, needs: 'yt-dlp' })
    expect(caps.jobs.find((job) => job.id === 'speech')).toEqual({ id: 'speech', available: true, needs: null })
    expect(caps.jobs.find((job) => job.id === 'backup')).toEqual({ id: 'backup', available: true, needs: null })
  })
})

describe('addonHostNeeds (#962, step 4)', () => {
  const base = { ...hostCapabilities({}, []), kind: 'desktop' as const, platform: 'linux', cpuCores: 8, memoryMb: 16384 }

  it('only the server part is limited: an add-on without one installs anywhere', () => {
    expect(addonHostNeeds({ runsOn: { platforms: ['win32'] } }, base)).toBeNull()
  })

  it('a server part that needs another platform or more power is refused with what is missing', () => {
    expect(addonHostNeeds({ serverFile: 'server.js', runsOn: { platforms: ['win32'] } }, base)).toContain('win32')
    expect(addonHostNeeds({ serverFile: 'server.js', runsOn: { minMemoryMb: 65536 } }, base)).toContain('65536 MB')
    expect(addonHostNeeds({ serverFile: 'server.js', runsOn: { platforms: ['linux'], minCpuCores: 4 } }, base)).toBeNull()
    expect(addonHostNeeds({ serverFile: 'server.js' }, base)).toBeNull()
  })
})

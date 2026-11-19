import { describe, expect, it } from 'vitest'
import type { HostCapabilities } from 'shared-types'
import { HostCapabilitiesSchema } from 'shared-types'
import { JOB_IDS, JOB_ROUTES, jobOfRequest, refusalFor, unavailableJobs } from './capabilities.js'

const tablet: HostCapabilities = {
  kind: 'android',
  platform: 'android',
  arch: 'arm64',
  database: 'builtin',
  cpuCores: 8,
  memoryMb: 4096,
  jobs: unavailableJobs('a Node machine', JOB_IDS),
  plugins: [{ id: 'stem-separation', available: false, needs: 'demucs' }, { id: 'osc', available: true, needs: null }],
}

describe('jobs a host can be asked for (#962)', () => {
  it('knows the job of every route that needs a capable device', () => {
    expect(jobOfRequest('POST', '/server/backup/run')).toBe('backup')
    expect(jobOfRequest('GET', '/speech/voices/de_DE-thorsten/license')).toBe('speech')
    expect(jobOfRequest('GET', '/lookup/ug/search')).toBe('lookup')
    expect(jobOfRequest('POST', '/plugins/stem-separation/trigger')).toBe('plugin:stem-separation')
    expect(jobOfRequest('POST', '/workspaces/band/activate-hardware')).toBe('hardware')
    expect(jobOfRequest('GET', '/server/backup-status/')).toBe('backup')
    expect(jobOfRequest('GET', '/time')).toBeNull()
    expect(jobOfRequest('GET', '/server/backup/run')).toBeNull()
  })

  it('refuses a job the device cannot do with 501, the capability and what is missing - never 404', () => {
    const refused = refusalFor(tablet, 'POST', '/server/backup/run')
    expect(refused?.status).toBe(501)
    expect(refused?.body).toMatchObject({ error: 'capability_missing', capability: 'backup', needs: 'a Node machine' })
    expect(refusalFor(tablet, 'POST', '/plugins/stem-separation/trigger')?.body).toMatchObject({ capability: 'plugin:stem-separation', needs: 'demucs' })
  })

  it('lets a job through when the device can do it, and a plugin the build does not know is refused as unknown', () => {
    expect(refusalFor(tablet, 'POST', '/plugins/osc/trigger')).toBeNull()
    expect(refusalFor({ ...tablet, jobs: [{ id: 'backup', available: true, needs: null }] }, 'POST', '/server/backup/run')).toBeNull()
    expect(refusalFor(tablet, 'POST', '/plugins/mystery/trigger')?.body).toMatchObject({ needs: 'unknown' })
  })

  it('every job of the table is one a host has to say something about, and the schema accepts the answer', () => {
    expect(JOB_IDS).toEqual(expect.arrayContaining(['backup', 'measure-inputs', 'calibration', 'speech', 'lookup', 'youtube-download', 'plugin-runtime', 'hardware', 'osc-in', 'host-lookup']))
    expect(new Set(JOB_ROUTES.map((r) => `${r.method} ${r.pattern}`)).size).toBe(JOB_ROUTES.length)
    expect(HostCapabilitiesSchema.parse(tablet)).toEqual(tablet)
  })
})

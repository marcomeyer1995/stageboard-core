import { describe, expect, it } from 'vitest'
import type { HostCapabilities } from 'shared-types'
import { HostCapabilitiesSchema } from 'shared-types'
import { canDoFromCapabilities, JOB_IDS, JOB_ROUTES, addonRefusal, jobOfRequest, refusalFor, unavailableJobs, unmetRequirement } from './capabilities.js'

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
    expect(JOB_IDS).toEqual(expect.arrayContaining(['backup', 'measure-inputs', 'calibration', 'speech', 'lookup', 'plugin-runtime', 'hardware', 'osc-in', 'host-lookup']))
    expect(new Set(JOB_ROUTES.map((r) => `${r.method} ${r.pattern}`)).size).toBe(JOB_ROUTES.length)
    expect(HostCapabilitiesSchema.parse(tablet)).toEqual(tablet)
  })
})

describe('what an add-on needs from the device that hosts it (#962)', () => {
  const linux: HostCapabilities = { ...tablet, kind: 'desktop', platform: 'linux', cpuCores: 16, memoryMb: 32768 }

  it('an add-on without requirements runs anywhere', () => {
    expect(unmetRequirement(undefined, tablet)).toBeNull()
    expect(unmetRequirement({}, tablet)).toBeNull()
  })

  it('an add-on for Windows or Linux does not run on Android, and says what is missing', () => {
    const needs = unmetRequirement({ platforms: ['win32', 'linux'] }, tablet)
    expect(needs).toContain('win32, linux')
    expect(needs).toContain('android')
    expect(unmetRequirement({ platforms: ['win32', 'linux'] }, linux)).toBeNull()
  })

  it('power is checked only where the device told it - never invented', () => {
    expect(unmetRequirement({ minMemoryMb: 8192 }, tablet)).toContain('8192 MB')
    expect(unmetRequirement({ minCpuCores: 12 }, tablet)).toContain('12 CPU cores')
    expect(unmetRequirement({ minMemoryMb: 8192, minCpuCores: 12 }, linux)).toBeNull()
    const unknown: HostCapabilities = { ...tablet }
    delete unknown.memoryMb
    expect(unmetRequirement({ minMemoryMb: 8192 }, unknown)).toBeNull()
  })

  it('refuses with 501 and the capability of the add-on', () => {
    expect(addonRefusal('stem-separation', '16 GB')).toMatchObject({ status: 501, body: { error: 'capability_missing', capability: 'plugin:stem-separation', needs: '16 GB' } })
  })
})

describe('jobOfRequest - which capability a route needs (#964)', () => {
  it('fills the add-on id of a method route into plugin:<id> - the literal pattern must never reach the host choice', () => {
    expect(jobOfRequest('POST', '/addons/youtube-download/methods/search')).toBe('plugin:youtube-download')
    expect(jobOfRequest('POST', '/plugins/stem-separation/trigger')).toBe('plugin:stem-separation')
    expect(jobOfRequest('GET', '/speech/voices')).toBe('speech')
    expect(jobOfRequest('POST', '/addons/no%20such/methods/search')).toBe('plugin:no such')
  })
})

describe('what a device can do, as a yes/no for the job queue (#964)', () => {
  it('says yes only for what the device lists as available - jobs and plugins', () => {
    const can = canDoFromCapabilities({ ...tablet, jobs: [{ id: 'lookup', available: true, needs: null }, { id: 'speech', available: false, needs: 'piper' }], plugins: [{ id: 'stem-separation', available: true, needs: null }] })
    expect(can('lookup')).toBe(true)
    expect(can('speech')).toBe(false)
    expect(can('plugin:stem-separation')).toBe(true)
    expect(can('plugin:unknown')).toBe(false)
    expect(can('never-listed')).toBe(false)
  })
})

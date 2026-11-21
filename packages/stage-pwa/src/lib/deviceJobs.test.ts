import { describe, expect, it } from 'vitest'
import type { AsyncJob } from 'shared-types'
import { deviceRunner, leftoverDeviceJobs } from './deviceJobs'

const job = (id: string, runner: string | undefined, status: AsyncJob['status'] = 'running'): AsyncJob => ({ id, type: 'audio-import', status, progress: 0, createdAt: 1, updatedAt: 1, variantId: 'v', addonId: 'a', method: 'm', args: {}, label: 'l', ...(runner ? { runner } : {}) })

describe('leftoverDeviceJobs', () => {
  it("only this device's running jobs that aren't running now", () => {
    const mine = job('mine', deviceRunner('redmi'))
    const other = job('other', deviceRunner('fire'))
    const host = job('host-job', 'host:laptop')
    const unclaimed = job('unclaimed', undefined)
    const done = job('done', deviceRunner('redmi'), 'done')
    expect(leftoverDeviceJobs([mine, other, host, unclaimed, done], 'redmi', new Set()).map((j) => j.id)).toEqual(['mine'])
    expect(leftoverDeviceJobs([mine], 'redmi', new Set([mine.id]))).toEqual([])
  })
})

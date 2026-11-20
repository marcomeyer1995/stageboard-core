import { describe, expect, it } from 'vitest'
import type { AsyncJob } from 'shared-types'
import { hostRunner, jobNeeds, jobsNobodyCanDo, pickNextClaimable, stillMine, stuckJobsOfHost } from './jobQueue.js'

const job = (over: Record<string, unknown> = {}): AsyncJob =>
  ({ id: 'j', type: 'youtube-extract', status: 'queued', progress: 0, createdAt: 1, updatedAt: 1, variantId: 'v', url: 'u', label: 'l', ...over }) as AsyncJob
const stem = (over: Record<string, unknown> = {}): AsyncJob => job({ type: 'stem-separation', sourceTrackId: 't', model: 'standard', splitGuitar: false, ...over })
const convert = (over: Record<string, unknown> = {}): AsyncJob => job({ type: 'opus-convert', trackId: 't', ...over })

const laptop = { hostId: 'laptop', canDo: () => true }
const weak = { hostId: 'tablet', canDo: (needs: string) => needs === 'youtube-download' }

describe('what a job needs from its host (#964)', () => {
  it('says which capability each host job needs, and that a device\'s conversion needs none', () => {
    expect(jobNeeds(job())).toBe('youtube-download')
    expect(jobNeeds(stem())).toBe('plugin:stem-separation')
    expect(jobNeeds(convert())).toBeNull()
  })
})

describe('which job a host takes (#964)', () => {
  it('takes the oldest queued job it can do - a plain FIFO', () => {
    expect(pickNextClaimable([job({ id: 'new', createdAt: 5 }), job({ id: 'old', createdAt: 2 })], laptop)?.id).toBe('old')
  })

  it('leaves a job it cannot do for a host that can - it neither takes nor fails it', () => {
    const jobs = [stem({ id: 'stems', createdAt: 1 }), job({ id: 'yt', createdAt: 2 })]
    expect(pickNextClaimable(jobs, weak)?.id).toBe('yt')
    expect(pickNextClaimable([stem()], weak)).toBeUndefined()
  })

  it('leaves alone a job that has a runner, a conversion for devices, and anything that is not queued', () => {
    const jobs = [job({ id: 'claimed', runner: 'host:other' }), job({ id: 'onDevice', runner: 'device:fire' }), convert({ id: 'c' }), job({ id: 'running', status: 'running' }), job({ id: 'done', status: 'done' }), job({ id: 'failed', status: 'error' })]
    expect(pickNextClaimable(jobs, laptop)).toBeUndefined()
  })

  it('a host that says nothing about itself is asked to do everything, as before', () => {
    expect(pickNextClaimable([stem()], { hostId: 'old' })?.type).toBe('stem-separation')
  })
})

describe('jobs a host left behind (#964)', () => {
  it('a running job of this host that nothing works on is stuck - also one of the old kind with no runner', () => {
    const mine = job({ id: 'mine', status: 'running', runner: hostRunner('laptop') })
    const old = job({ id: 'old', status: 'running' })
    expect(stuckJobsOfHost([mine, old], 'laptop', null).map((j) => j.id)).toEqual(['mine', 'old'])
  })

  it('is not the job being worked on, not another runner\'s, not a device\'s, not a conversion', () => {
    const jobs = [job({ id: 'now', status: 'running', runner: 'host:laptop' }), job({ id: 'theirs', status: 'running', runner: 'host:tablet' }), job({ id: 'dev', status: 'running', runner: 'device:fire' }), convert({ id: 'c', status: 'running' })]
    expect(stuckJobsOfHost(jobs, 'laptop', 'now')).toEqual([])
  })
})

describe('two hosts claim the same job (#964)', () => {
  it('after the claim has settled a host goes on only if the job still names it', () => {
    expect(stillMine(job({ runner: 'host:laptop' }), 'laptop')).toBe(true)
    expect(stillMine(job({ runner: 'host:tablet' }), 'laptop')).toBe(false)
    expect(stillMine(job(), 'laptop')).toBe(false)
    expect(stillMine(undefined, 'laptop')).toBe(false)
  })
})

describe('jobs nobody can do (#964)', () => {
  it('lists the queued jobs no host can do, so the person is told instead of waiting', () => {
    const jobs = [stem({ id: 'stems' }), job({ id: 'yt' }), stem({ id: 'claimed', runner: 'host:x' })]
    expect(jobsNobodyCanDo(jobs, [weak]).map((j) => j.id)).toEqual(['stems'])
    expect(jobsNobodyCanDo(jobs, [weak, laptop])).toEqual([])
  })
})

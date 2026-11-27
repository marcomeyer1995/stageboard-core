import { describe, expect, it, vi } from 'vitest'
import type { AsyncJob } from 'shared-types'
import { createJobClaimLoop, type JobClaimLoopDeps } from './jobClaimLoop.js'

const job = (over: Partial<AsyncJob> = {}): AsyncJob =>
  ({
    id: 'j1',
    type: 'audio-import',
    status: 'queued',
    progress: 0,
    createdAt: 1,
    updatedAt: 1,
    variantId: 'v',
    addonId: 'youtube-download',
    method: 'fetchAudio',
    args: { url: 'u' },
    label: 'L',
    ...over,
  }) as AsyncJob

type Options = {
  jobs: AsyncJob[]
  can?: string[]
  serving?: boolean
  peers?: boolean
  stored?: (id: string) => AsyncJob | undefined
} & Partial<Pick<JobClaimLoopDeps, 'takeAllWhenAlone' | 'claim' | 'run'>>

function setUp({ jobs, can, serving, peers, stored, ...over }: Options) {
  const opts = { jobs, can, serving, peers, stored }
  const claimed: AsyncJob[] = []
  const ran: AsyncJob[] = []
  const loop = createJobClaimLoop({
    hostId: 'tab',
    jobs: () => opts.jobs,
    canDo: (needs) => (opts.can ?? ['plugin:youtube-download']).includes(needs),
    serving: () => opts.serving ?? true,
    hasPeers: () => opts.peers ?? false,
    read: async (id) => opts.stored?.(id) ?? claimed.filter((j) => j.id === id).pop() ?? opts.jobs.find((j) => j.id === id),
    claim: async (j) => void claimed.push(j),
    run: async (j) => void ran.push(j),
    settleMs: 0,
    now: () => 99,
    ...over,
  })
  return { loop, claimed, ran }
}

describe('a host works the jobs it can do - the one claim loop of every host (#964)', () => {
  it('claims a queued job it can do by naming itself as the runner, then runs it', async () => {
    const { loop, claimed, ran } = setUp({ jobs: [job()] })
    expect(await loop.tick()).toBe(true)
    expect(claimed[0]).toMatchObject({
      id: 'j1',
      status: 'running',
      progress: 0,
      runner: 'host:tab',
      updatedAt: 99,
    })
    expect(ran).toHaveLength(1)
    expect(ran[0]).toMatchObject({ id: 'j1', runner: 'host:tab' })
  })

  it('leaves a job it cannot do - another host or device may', async () => {
    const { loop, claimed, ran } = setUp({ jobs: [job()], can: [] })
    expect(await loop.tick()).toBe(false)
    expect(claimed).toEqual([])
    expect(ran).toEqual([])
  })

  it('the only host of a band that says so takes every job for hosts, so the runner ends it with its reason - but not with a peer (#964)', async () => {
    const alone = setUp({ jobs: [job()], can: [], takeAllWhenAlone: true })
    expect(await alone.loop.tick()).toBe(true)
    const withPeer = setUp({
      jobs: [job()],
      can: [],
      takeAllWhenAlone: true,
      peers: true,
    })
    expect(await withPeer.loop.tick()).toBe(false)
  })

  it('does nothing while it does not serve the band (a passive backup, no band), and leaves jobs somebody already runs or that only devices do', async () => {
    const idle = setUp({ jobs: [job()], serving: false })
    expect(await idle.loop.tick()).toBe(false)
    const taken = setUp({
      jobs: [job({ runner: 'device:x', status: 'running' } as Partial<AsyncJob>)],
    })
    await taken.loop.tick()
    expect(taken.claimed).toEqual([])
    const deviceJob = setUp({
      jobs: [job({ type: 'opus-convert' } as Partial<AsyncJob>)],
      can: [],
      takeAllWhenAlone: true,
    })
    await deviceJob.loop.tick()
    expect(deviceJob.claimed).toEqual([])
  })

  it('with another host in the band, goes on only if the claim still names it after it settled', async () => {
    const lost = setUp({
      jobs: [job()],
      peers: true,
      stored: () => job({ runner: 'host:laptop', status: 'running' } as Partial<AsyncJob>),
    })
    expect(await lost.loop.tick()).toBe(false)
    expect(lost.ran).toEqual([])
    const won = setUp({
      jobs: [job()],
      peers: true,
      stored: () => job({ runner: 'host:tab', status: 'running' } as Partial<AsyncJob>),
    })
    expect(await won.loop.tick()).toBe(true)
    expect(won.ran).toHaveLength(1)
  })

  it('a claim that cannot be written leaves the job for the next pass; a runner that throws does not stop the loop', async () => {
    const failing = setUp({
      jobs: [job()],
      claim: async () => Promise.reject(new Error('conflict')),
    })
    expect(await failing.loop.tick()).toBe(false)
    expect(failing.ran).toEqual([])
    expect(failing.loop.current()).toBeNull()
    const throwing = setUp({
      jobs: [job()],
      run: async () => Promise.reject(new Error('boom')),
    })
    expect(await throwing.loop.tick()).toBe(true)
    expect(throwing.loop.current()).toBeNull()
  })

  it('works one job at a time: a second tick during a run starts nothing', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const ran: string[] = []
    const loop = createJobClaimLoop({
      hostId: 'tab',
      jobs: () => [job({ id: 'a' }), job({ id: 'b', createdAt: 2 })],
      canDo: () => true,
      hasPeers: () => false,
      read: async () => undefined,
      claim: async () => {},
      run: async (j) => {
        ran.push(j.id)
        await gate
      },
      settleMs: 0,
    })
    const first = loop.tick()
    await vi.waitFor(() => expect(ran).toEqual(['a']))
    expect(loop.current()).toBe('a')
    expect(await loop.tick()).toBe(false)
    expect(ran).toEqual(['a'])
    release()
    await first
  })

  it('at startup, hands over its own jobs left running by a restart - not those of another runner, not the one it runs', async () => {
    const jobs = [
      job({
        id: 'mine',
        status: 'running',
        runner: 'host:tab',
      } as Partial<AsyncJob>),
      job({ id: 'old-kind', status: 'running' } as Partial<AsyncJob>),
      job({
        id: 'theirs',
        status: 'running',
        runner: 'host:laptop',
      } as Partial<AsyncJob>),
      job({ id: 'queued' }),
    ]
    const { loop } = setUp({ jobs })
    const failed: string[] = []
    await loop.failLeftRunning(async (j) => void failed.push(j.id))
    expect(failed).toEqual(['mine', 'old-kind'])
  })
})

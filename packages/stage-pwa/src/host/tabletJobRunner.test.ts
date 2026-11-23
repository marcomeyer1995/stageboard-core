import { describe, expect, it, vi } from 'vitest'
import type { AsyncJob } from 'shared-types'
import { createTabletJobRunner } from './tabletJobRunner'

const job = (over: Partial<AsyncJob> = {}): AsyncJob =>
  ({ id: 'j1', type: 'audio-import', status: 'queued', progress: 0, createdAt: 1, updatedAt: 1, variantId: 'v', addonId: 'youtube-download', method: 'fetchAudio', args: { url: 'u' }, label: 'L', ...over }) as AsyncJob

function setUp(opts: { jobs: AsyncJob[]; can?: string[]; serving?: boolean; peers?: boolean; stored?: (id: string) => AsyncJob | undefined }) {
  const written: AsyncJob[] = []
  const ran: AsyncJob[] = []
  const runner = createTabletJobRunner({
    hostId: 'tab',
    jobs: () => opts.jobs,
    canDo: (needs) => (opts.can ?? ['plugin:youtube-download']).includes(needs),
    serving: () => opts.serving ?? true,
    hasPeers: () => opts.peers ?? false,
    read: async (id) => opts.stored?.(id) ?? written.filter((j) => j.id === id).pop() ?? opts.jobs.find((j) => j.id === id),
    write: async (j) => void written.push(j),
    run: async (j) => void ran.push(j),
    settleMs: 0,
  })
  return { runner, written, ran }
}

describe('the tablet host works the jobs it can do (#964)', () => {
  it('claims a queued job it can do by naming itself as the runner, then runs it', async () => {
    const { runner, written, ran } = setUp({ jobs: [job()] })
    await runner.tick()
    expect(written[0]).toMatchObject({ id: 'j1', status: 'running', runner: 'host:tab' })
    expect(ran).toHaveLength(1)
    expect(ran[0]).toMatchObject({ id: 'j1', runner: 'host:tab' })
  })

  it('leaves a job it cannot do - another host or device may', async () => {
    const { runner, written, ran } = setUp({ jobs: [job()], can: [] })
    await runner.tick()
    expect(written).toEqual([])
    expect(ran).toEqual([])
  })

  it('does nothing while it does not serve the band (a passive backup, no band), and leaves jobs somebody already runs', async () => {
    const idle = setUp({ jobs: [job()], serving: false })
    await idle.runner.tick()
    expect(idle.written).toEqual([])
    const taken = setUp({ jobs: [job({ runner: 'device:x', status: 'running' } as Partial<AsyncJob>)] })
    await taken.runner.tick()
    expect(taken.written).toEqual([])
  })

  it('with another host in the band, goes on only if the claim still names it after it settled', async () => {
    const lost = setUp({ jobs: [job()], peers: true, stored: () => job({ runner: 'host:laptop', status: 'running' } as Partial<AsyncJob>) })
    await lost.runner.tick()
    expect(lost.ran).toEqual([])
    const won = setUp({ jobs: [job()], peers: true, stored: () => job({ runner: 'host:tab', status: 'running' } as Partial<AsyncJob>) })
    await won.runner.tick()
    expect(won.ran).toHaveLength(1)
  })

  it('works one job at a time: a second tick during a run starts nothing', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const ran: string[] = []
    const runner = createTabletJobRunner({
      hostId: 'tab',
      jobs: () => [job({ id: 'a' }), job({ id: 'b', createdAt: 2 })],
      canDo: () => true,
      serving: () => true,
      hasPeers: () => false,
      read: async () => undefined,
      write: async () => {},
      run: async (j) => {
        ran.push(j.id)
        await gate
      },
      settleMs: 0,
    })
    const first = runner.tick()
    await vi.waitFor(() => expect(ran).toEqual(['a']))
    await runner.tick()
    expect(ran).toEqual(['a'])
    release()
    await first
  })
})

import { describe, expect, it } from 'vitest'
import type { HostCapabilities } from 'shared-types'
import { chooseHostForJob } from './jobChoice'

const caps = (jobs: Record<string, boolean | { available: false; needs: string; note?: string }>): HostCapabilities => ({
  kind: 'desktop',
  platform: 'linux',
  arch: 'x64',
  database: 'builtin',
  plugins: [],
  jobs: Object.entries(jobs).map(([id, v]) => (typeof v === 'boolean' ? { id, available: v, needs: null } : { id, ...v })),
})

const laptop = { url: 'https://laptop', capabilities: caps({ speech: true }) }
const tablet = { url: 'https://tablet', capabilities: caps({ speech: { available: false, needs: 'an Android version (not built yet)', note: 'Slow on a tablet.' } }) }

describe('chooseHostForJob (#962)', () => {
  it('stays on the current host when it can do the job', () => {
    expect(chooseHostForJob('speech', laptop, [tablet])).toEqual({ url: 'https://laptop' })
  })

  it('moves the job to a band host that can, when the current one cannot', () => {
    expect(chooseHostForJob('speech', tablet, [laptop])).toEqual({ url: 'https://laptop' })
  })

  it('sends it nowhere when no host can, and says what is missing and why', () => {
    expect(chooseHostForJob('speech', tablet, [])).toEqual({ url: null, needs: 'an Android version (not built yet)', note: 'Slow on a tablet.' })
  })

  it('asks a host that does not say (an older one) as before - it answers for itself', () => {
    expect(chooseHostForJob('speech', { url: 'https://old', capabilities: null }, [laptop])).toEqual({ url: 'https://old' })
  })

  it('does not send a job to a host that did not answer', () => {
    expect(chooseHostForJob('speech', tablet, [{ url: 'https://gone', capabilities: null }])).toMatchObject({ url: null })
  })

  it('finds a plugin job by the plugin id', () => {
    const withStems: HostCapabilities = { ...caps({}), plugins: [{ id: 'stem-separation', available: true, needs: null }] }
    expect(chooseHostForJob('plugin:stem-separation', tablet, [{ url: 'https://pc', capabilities: withStems }])).toEqual({ url: 'https://pc' })
  })
})

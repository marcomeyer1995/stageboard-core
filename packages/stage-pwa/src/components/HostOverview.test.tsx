import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostOverview as Overview } from '../lib/hostOverview'
import '../i18n'

const overview = vi.hoisted(() => ({ value: null as Overview | null }))
vi.mock('../lib/useHostOverview', () => ({ useHostOverview: () => overview.value }))

const { HostOverview } = await import('./HostOverview')

const row = (over: object = {}) => ({ hostId: 'laptop', role: 'primary' as const, url: 'https://10.0.0.1:8443', state: 'host' as const, status: 'ok' as const, epoch: 1, current: false, ...over })

beforeEach(() => {
  overview.value = null
})

describe('HostOverview (#941)', () => {
  it('shows nothing while there is nothing to show (no two hosts, or no answer yet)', () => {
    const { container } = render(<HostOverview />)
    expect(container.textContent).toBe('')
    overview.value = { rows: [], problem: null }
    const again = render(<HostOverview />)
    expect(again.container.textContent).toBe('')
  })

  it('names each host with its role and what it is doing, and marks the one this device is on', () => {
    overview.value = {
      rows: [row({ current: true }), row({ hostId: 'stage-pc', role: 'backup', state: 'standby', status: 'off', epoch: 1, url: 'https://10.0.0.2:8443' })],
      problem: null,
    }
    render(<HostOverview />)
    expect(screen.getByText('laptop')).toBeTruthy()
    expect(screen.getByText('stage-pc')).toBeTruthy()
    expect(screen.getByText(/Primary/)).toBeTruthy()
    expect(screen.getByText(/Backup/)).toBeTruthy()
    expect(screen.getByText(/ist der Host/)).toBeTruthy()
    expect(screen.getByText(/bereit/)).toBeTruthy()
    expect(screen.getAllByText(/dieses Gerät/)).toHaveLength(1)
  })

  it('says what is wrong in words, and a missing host or an out-of-date primary as a hint', () => {
    overview.value = {
      rows: [row({ state: 'outdated', status: 'warning', epoch: 1 }), row({ hostId: 'stage-pc', role: 'backup', state: 'host', epoch: 2, url: 'https://10.0.0.2:8443' })],
      problem: null,
    }
    render(<HostOverview />)
    expect(screen.getByText(/veraltet/)).toBeTruthy()
  })

  it('names the problems: no host answers, nobody is the host, two hosts', () => {
    for (const [problem, text] of [['none-reachable', /Kein Host antwortet/], ['no-host', /Keiner der Hosts ist gerade der Host/], ['two-hosts', /Zwei Hosts halten sich für den Host/]] as const) {
      overview.value = { rows: [row({ state: 'unreachable', status: 'warning', epoch: null })], problem }
      const { unmount } = render(<HostOverview />)
      expect(screen.getByText(text)).toBeTruthy()
      unmount()
    }
  })

  it('shows the epoch of a host that answered, and none for one that did not', () => {
    overview.value = { rows: [row({ epoch: 4 }), row({ hostId: 'stage-pc', role: 'backup', state: 'unreachable', status: 'warning', epoch: null })], problem: null }
    render(<HostOverview />)
    expect(screen.getByText(/Epoch 4/)).toBeTruthy()
    expect(screen.queryAllByText(/Epoch/)).toHaveLength(1)
  })
})

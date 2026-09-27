import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Dashboard } from 'shared-types'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { useDashboardsStore } = await import('../store/useDashboardsStore')
const { DashboardManager } = await import('./DashboardManager')

function dashboard(id: string, extra: Partial<Dashboard> = {}): Dashboard {
  return { id, name: id, order: 0, widgets: [], layouts: {}, visibility: 'public', ...extra }
}

const save = vi.fn()

beforeEach(() => {
  save.mockReset()
  useDashboardsStore.setState({ save })
})

function chips(name: string) {
  const row = screen.getByDisplayValue(name).closest('div.flex-wrap') as HTMLElement
  const group = row.querySelector('[role=group]') as HTMLElement
  return { gig: group.querySelectorAll('button')[0], solo: group.querySelectorAll('button')[1] }
}

describe('DashboardManager - availability per session mode', () => {
  it('shows both chips pressed for a dashboard without modes, and saves the narrowed modes', () => {
    useDashboardsStore.setState({ dashboards: [dashboard('Bühne'), dashboard('Probe', { order: 1 })] })
    render(<DashboardManager onClose={vi.fn()} />)

    const { gig, solo } = chips('Probe')
    expect(gig).toHaveAttribute('aria-pressed', 'true')
    expect(solo).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(gig)
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'Probe', modes: ['practice'] }))
  })

  it('locks the chip of the only dashboard left in a mode', () => {
    useDashboardsStore.setState({
      dashboards: [dashboard('Bühne', { modes: ['gig'] }), dashboard('Probe', { order: 1, modes: ['practice'] })],
    })
    render(<DashboardManager onClose={vi.fn()} />)

    expect(chips('Bühne').gig).toBeDisabled()
    expect(chips('Bühne').solo).toHaveAttribute('aria-pressed', 'false')
    expect(chips('Bühne').solo).not.toBeDisabled()
  })
})

describe('DashboardManager - status bar per dashboard (PR F2)', () => {
  function statusBarChip(name: string) {
    const row = screen.getByDisplayValue(name).closest('div.flex-wrap') as HTMLElement
    return [...row.querySelectorAll('button')].find((b) => b.textContent === 'Statusleiste')!
  }

  it('shows the bar by default and saves statusBar: false when switched off, true when back on', () => {
    useDashboardsStore.setState({ dashboards: [dashboard('Bühne'), dashboard('Prompter', { order: 1, statusBar: false })] })
    render(<DashboardManager onClose={vi.fn()} />)

    expect(statusBarChip('Bühne')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(statusBarChip('Bühne'))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'Bühne', statusBar: false }))

    expect(statusBarChip('Prompter')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(statusBarChip('Prompter'))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'Prompter', statusBar: true }))
  })
})

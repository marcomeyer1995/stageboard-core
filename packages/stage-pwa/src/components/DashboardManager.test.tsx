import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Dashboard } from 'shared-types'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const me = vi.hoisted(() => ({ profile: { id: 'p-me', name: 'Caro', stageRoles: [] as string[] } }))
vi.mock('../lib/useActiveProfile', () => ({ useActiveProfile: () => me.profile }))

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

describe('DashboardManager - read-only templates (#16)', () => {
  it('a musician cannot rename or delete a template, and duplicating it gives an own editable copy', async () => {
    me.profile.stageRoles = []
    const duplicate = vi.fn(async () => null)
    useDashboardsStore.setState({ duplicate, dashboards: [dashboard('Bühne', { isReadOnly: true }), dashboard('Probe', { order: 1 })] })
    render(<DashboardManager onClose={vi.fn()} />)

    expect(screen.getByDisplayValue('Bühne')).toBeDisabled()
    const row = screen.getByDisplayValue('Bühne').closest('div.flex-wrap') as HTMLElement
    expect(within(row).getByRole('button', { name: 'Löschen' })).toBeDisabled()
    expect(within(row).getByRole('button', { name: /Vorlage/ })).toBeDisabled()
    fireEvent.click(within(row).getByRole('button', { name: 'Duplizieren' }))
    expect(duplicate).toHaveBeenCalledWith(expect.any(String), 'Bühne Kopie', 'p-me')
    expect(screen.getByDisplayValue('Probe')).not.toBeDisabled()
  })

  it('a musician cannot switch modes, status bar or order of a template either (found live on the Fire)', () => {
    me.profile.stageRoles = []
    useDashboardsStore.setState({ dashboards: [dashboard('Bühne', { isReadOnly: true }), dashboard('Probe', { order: 1 }), dashboard('Pause', { order: 2 })] })
    render(<DashboardManager onClose={vi.fn()} />)
    const row = (name: string) => screen.getByDisplayValue(name).closest('div.flex-wrap') as HTMLElement
    expect(chips('Bühne').gig).toBeDisabled()
    expect(chips('Bühne').solo).toBeDisabled()
    expect(within(row('Bühne')).getByRole('button', { name: 'Statusleiste' })).toBeDisabled()
    expect(within(row('Bühne')).getByTitle('Nach unten')).toBeDisabled()
    // Moving a normal dashboard past the template would rewrite the template's order too.
    expect(within(row('Probe')).getByTitle('Nach oben')).toBeDisabled()
    expect(within(row('Probe')).getByTitle('Nach unten')).not.toBeDisabled()
    expect(chips('Probe').gig).not.toBeDisabled()
    fireEvent.click(chips('Bühne').gig)
    expect(save).not.toHaveBeenCalled()
  })

  it('an admin protects a dashboard as template and can still edit it', () => {
    me.profile.stageRoles = ['admin']
    useDashboardsStore.setState({ dashboards: [dashboard('Bühne'), dashboard('Probe', { order: 1 })] })
    render(<DashboardManager onClose={vi.fn()} />)
    const row = screen.getByDisplayValue('Bühne').closest('div.flex-wrap') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: /Vorlage/ }))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'Bühne', isReadOnly: true }))
    expect(screen.getByDisplayValue('Bühne')).not.toBeDisabled()
  })
})


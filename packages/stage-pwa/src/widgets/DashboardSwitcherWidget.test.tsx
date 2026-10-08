import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Dashboard } from 'shared-types'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))
vi.mock('../lib/useActiveProfile', () => ({ useActiveProfile: () => ({ id: 'p-caro', name: 'Caro', stageRoles: [] }) }))

const { useDashboardsStore } = await import('../store/useDashboardsStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { useDashboardMenuStore } = await import('../store/useDashboardMenuStore')
const { useAppModeStore } = await import('../store/useAppModeStore')
const { DashboardSwitcherView: DashboardSwitcherWidget, DashboardSwitcherConfigPanel } = await import('./DashboardSwitcherWidget')

const board = (id: string, order: number, extra: Partial<Dashboard> = {}): Dashboard => ({ id, name: id, order, widgets: [], layouts: {}, visibility: 'public', ...extra })

beforeEach(() => {
  useWorkspaceStore.setState({ workspaces: [{ id: 'band', name: 'Band' }], activeWorkspaceId: 'band' } as never)
  useAppModeStore.setState({ mode: 'gig' } as never)
  useDashboardsStore.setState({
    dashboards: [
      board('Bühne', 0),
      board('Solo', 1, { modes: ['practice'] }),
      board('Marcos', 2, { visibility: 'private', ownerProfileId: 'p-marco' }),
      board('Monitor', 3),
      board('Pause', 4),
    ],
  })
  useDashboardMenuStore.setState({ byWorkspace: { band: { order: ['Pause', 'Bühne'], hidden: ['Monitor'] } } })
})

describe('Dashboard-Umschalter = the burger menu list', () => {
  it("shows exactly this device's menu: current mode, visible to the person, own order, without hidden ones", () => {
    render(<DashboardSwitcherWidget config={{ orientation: 'horizontal' }} />)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Pause', 'Bühne'])
  })

  it('its settings have no dashboard selection of their own any more, and say where it is decided', () => {
    render(<DashboardSwitcherConfigPanel config={{ orientation: 'horizontal' }} onChange={vi.fn()} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByText(/Zeigt dieselben Dashboards wie das Menü/)).toBeInTheDocument()
  })
})

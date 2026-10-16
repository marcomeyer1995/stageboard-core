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

const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { useDashboardsStore } = await import('../store/useDashboardsStore')
const { useActiveDashboardStore } = await import('../store/useActiveDashboardStore')
const { DashboardMenu } = await import('./DashboardMenu')

function dashboard(id: string, name: string, order: number): Dashboard {
  return { id, name, order, widgets: [], layouts: {}, visibility: 'public' }
}

beforeEach(() => {
  useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }], activeWorkspaceId: 'band-a' })
  useDashboardsStore.setState({ dashboards: [] })
  useActiveDashboardStore.setState({ byWorkspace: {} })
})

describe('DashboardMenu - the bento menu (docs/15 D8)', () => {
  it('slides in from the right', () => {
    render(<DashboardMenu onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Dashboards' })).toHaveAttribute('data-side', 'right')
  })

  it('changing the dashboard list (new, order, hide, edit) sits behind one "Bearbeiten", also with a single dashboard', () => {
    useDashboardsStore.setState({ dashboards: [dashboard('d1', 'Bühne', 0)] })
    render(<DashboardMenu onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Neues Dashboard' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }))
    expect(screen.getByRole('button', { name: 'Neues Dashboard' })).toBeInTheDocument()
  })

  it('highlights the active dashboard', () => {
    useDashboardsStore.setState({ dashboards: [dashboard('d1', 'Bühne', 0), dashboard('d2', 'Monitor', 1)] })
    useActiveDashboardStore.setState({ byWorkspace: { 'band-a': 'd2' } })
    render(<DashboardMenu onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^Monitor/ })).toHaveClass('bg-accent')
    expect(screen.getByRole('button', { name: 'Bühne' })).not.toHaveClass('bg-accent')
  })

  it('picking a dashboard sets it active and closes the menu', () => {
    useDashboardsStore.setState({ dashboards: [dashboard('d1', 'Bühne', 0), dashboard('d2', 'Monitor', 1)] })
    const onClose = vi.fn()
    render(<DashboardMenu onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Monitor' }))
    expect(useActiveDashboardStore.getState().byWorkspace['band-a']).toBe('d2')
    expect(onClose).toHaveBeenCalled()
  })

  it('a swipe back toward the right edge closes it', () => {
    const onClose = vi.fn()
    render(<DashboardMenu onClose={onClose} />)
    const panel = screen.getByRole('dialog', { name: 'Dashboards' })
    fireEvent.pointerDown(panel, { clientX: 100 })
    fireEvent.pointerUp(panel, { clientX: 200 })
    expect(onClose).toHaveBeenCalled()
  })
})

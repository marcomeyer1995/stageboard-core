import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Dashboard } from 'shared-types'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))
const me = vi.hoisted(() => ({ profile: { id: 'p-caro', name: 'Caro', stageRoles: [] as string[] } }))
vi.mock('../lib/useActiveProfile', () => ({ useActiveProfile: () => me.profile }))

const { useDashboardsStore } = await import('../store/useDashboardsStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { useActiveDashboardStore } = await import('../store/useActiveDashboardStore')
const { useEditModeStore } = await import('../store/useEditModeStore')
const { useDashboardMenuStore } = await import('../store/useDashboardMenuStore')
const { useDialogStore } = await import('../store/useDialogStore')
const { DashboardMenuList, HOLD_MS, FILL_DELAY_MS } = await import('./DashboardMenuList')

const board = (id: string, order: number, extra: Partial<Dashboard> = {}): Dashboard => ({ id, name: id, order, widgets: [], layouts: {}, visibility: 'public', ...extra })

beforeEach(() => {
  vi.useFakeTimers()
  me.profile.stageRoles = []
  useWorkspaceStore.setState({ workspaces: [{ id: 'band', name: 'Band' }], activeWorkspaceId: 'band' } as never)
  useDashboardsStore.setState({ dashboards: [board('Bühne', 0), board('Monitor', 1), board('Pause', 2)] })
  useActiveDashboardStore.setState({ byWorkspace: { band: 'Bühne' }, byWorkspaceMode: {} } as never)
  useDashboardMenuStore.setState({ byWorkspace: {} })
  useEditModeStore.getState().setEditing(false)
})
afterEach(() => vi.useRealTimers())

const entry = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })
function hold(el: HTMLElement) {
  fireEvent.pointerDown(el)
  act(() => vi.advanceTimersByTime(HOLD_MS + 50))
}

describe('DashboardMenuList', () => {
  it('a tap switches, holding opens the dashboard in edit mode', () => {
    const onSelect = vi.fn()
    const onEdit = vi.fn()
    render(<DashboardMenuList onSelect={onSelect} onEdit={onEdit} />)
    fireEvent.pointerDown(entry('Monitor'))
    fireEvent.pointerUp(entry('Monitor'))
    expect(onSelect).toHaveBeenCalledWith('Monitor')
    hold(entry('Pause'))
    expect(useEditModeStore.getState().isEditing).toBe(true)
    expect(useActiveDashboardStore.getState().byWorkspace.band).toBe('Pause')
    expect(onEdit).toHaveBeenCalled()
  })

  it('a short tap shows no fill - it only starts after a moment of holding', () => {
    render(<DashboardMenuList onSelect={vi.fn()} onEdit={vi.fn()} />)
    const fill = () => screen.getAllByTestId('dashboard-hold-progress')[1]!.style.width
    fireEvent.pointerDown(entry('Monitor'))
    act(() => vi.advanceTimersByTime(FILL_DELAY_MS - 50))
    expect(fill()).toBe('0%')
    act(() => vi.advanceTimersByTime(100))
    expect(fill()).toBe('100%')
  })

  it('sliding off while holding (scrolling the menu) does nothing', () => {
    const onSelect = vi.fn()
    render(<DashboardMenuList onSelect={onSelect} onEdit={vi.fn()} />)
    fireEvent.pointerDown(entry('Monitor'))
    fireEvent.pointerLeave(entry('Monitor'))
    act(() => vi.advanceTimersByTime(HOLD_MS + 50))
    expect(onSelect).not.toHaveBeenCalled()
    expect(useEditModeStore.getState().isEditing).toBe(false)
  })

  it('a template shows a lock for a musician; holding it offers an own copy instead of editing it', async () => {
    useDashboardsStore.setState({ dashboards: [board('Bühne', 0, { isReadOnly: true }), board('Monitor', 1)] })
    const duplicate = vi.fn(async () => board('Bühne Kopie', 2, { visibility: 'private', ownerProfileId: 'p-caro' }))
    useDashboardsStore.setState({ duplicate })
    render(<DashboardMenuList onSelect={vi.fn()} onEdit={vi.fn()} />)
    expect(screen.getByLabelText('Vorlage')).toBeInTheDocument()
    hold(entry('Bühne'))
    expect(useDialogStore.getState().request).toMatchObject({ kind: 'confirm', confirmLabel: 'Eigene Kopie bearbeiten' })
    await act(async () => useDialogStore.getState().acceptConfirm())
    expect(duplicate).toHaveBeenCalledWith('Bühne', 'Bühne Kopie', 'p-caro')
    expect(useEditModeStore.getState().isEditing).toBe(true)
  })

  it('"Ordnen": the eye hides a dashboard on this device; drag order is per device too', () => {
    render(<DashboardMenuList onSelect={vi.fn()} onEdit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ordnen' }))
    fireEvent.click(screen.getByRole('button', { name: '„Pause“ ausblenden' }))
    expect(useDashboardMenuStore.getState().byWorkspace.band?.hidden).toEqual(['Pause'])
    fireEvent.click(screen.getByRole('button', { name: 'Ordnen beenden' }))
    expect(screen.queryByRole('button', { name: /^Pause/ })).not.toBeInTheDocument()
    expect(entry('Monitor')).toBeInTheDocument()
  })

  it('"+ Neues Dashboard" asks for a name, creates it privately and opens it for editing', async () => {
    const create = vi.fn(async (name: string) => board(name, 3, { visibility: 'private', ownerProfileId: 'p-caro' }))
    useDashboardsStore.setState({ create })
    render(<DashboardMenuList onSelect={vi.fn()} onEdit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Neues Dashboard' }))
    await act(async () => useDialogStore.getState().submit({ value: 'Drums' }))
    expect(create).toHaveBeenCalledWith('Drums', { ownerProfileId: 'p-caro', visibility: 'private' })
    expect(useEditModeStore.getState().isEditing).toBe(true)
    expect(useActiveDashboardStore.getState().byWorkspace.band).toBe('Drums')
  })
})

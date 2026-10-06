import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ctx = vi.hoisted(() => ({
  active: { isReadOnly: false } as { id?: string; name?: string; isReadOnly?: boolean } | undefined,
  roles: [] as string[],
  duplicate: (() => Promise.resolve(null)) as (id: string, name: string, personalFor?: string) => Promise<{ id: string } | null>,
  setActive: (() => undefined) as (workspaceId: string, id: string) => void,
}))
vi.mock('../lib/useModeDashboards', () => ({ useModeDashboards: () => ({ active: ctx.active, candidates: [] }) }))
vi.mock('../lib/useActiveProfile', () => ({ useActiveProfile: () => ({ id: 'p-caro', stageRoles: ctx.roles }) }))
vi.mock('../store/useDashboardsStore', () => ({ useDashboardsStore: (select: (s: object) => unknown) => select({ duplicate: (...a: Parameters<typeof ctx.duplicate>) => ctx.duplicate(...a) }) }))
vi.mock('../store/useActiveDashboardStore', () => ({ useActiveDashboardStore: (select: (s: object) => unknown) => select({ setActive: (...a: Parameters<typeof ctx.setActive>) => ctx.setActive(...a) }) }))
vi.mock('../store/useWorkspaceStore', () => ({ useWorkspaceStore: (select: (s: object) => unknown) => select({ activeWorkspaceId: 'band' }) }))

const { EditLock } = await import('./EditLock')
const { useEditModeStore } = await import('../store/useEditModeStore')

beforeEach(() => {
  vi.useFakeTimers()
  useEditModeStore.getState().setEditing(false)
  ctx.active = { isReadOnly: false }
  ctx.roles = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('EditLock', () => {
  it('unlocks after a long press, with the progress fill running while held', () => {
    const onUnlock = vi.fn()
    render(<EditLock onUnlock={onUnlock} />)
    fireEvent.pointerDown(screen.getByText('Bearbeiten'))
    expect(screen.getByTestId('edit-lock-progress').style.width).toBe('100%')
    act(() => vi.advanceTimersByTime(600))
    expect(useEditModeStore.getState().isEditing).toBe(true)
    expect(onUnlock).toHaveBeenCalled()
  })

  it('says to hold it after a too-short tap instead of doing nothing silently', () => {
    render(<EditLock />)
    const button = screen.getByText('Bearbeiten')
    fireEvent.pointerDown(button)
    act(() => vi.advanceTimersByTime(200))
    fireEvent.pointerUp(button)
    expect(useEditModeStore.getState().isEditing).toBe(false)
    expect(screen.getByRole('status')).toHaveTextContent('Zum Bearbeiten gedrückt halten')
    expect(screen.getByTestId('edit-lock-progress').style.width).toBe('0%')

    act(() => vi.advanceTimersByTime(2500))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows no hint when the finger slides off (a scroll of the menu)', () => {
    render(<EditLock />)
    const button = screen.getByText('Bearbeiten')
    fireEvent.pointerDown(button)
    fireEvent.pointerLeave(button)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('EditLock on a read-only template (#16)', () => {
  it('a musician cannot unlock it and is told how to get an own copy', () => {
    ctx.active = { isReadOnly: true }
    render(<EditLock />)
    fireEvent.pointerDown(screen.getByText('Bearbeiten'))
    act(() => vi.advanceTimersByTime(700))
    expect(useEditModeStore.getState().isEditing).toBe(false)
    expect(screen.getByText(/Vorlage - nur Admins/)).toBeInTheDocument()
  })

  it('"Eigene Kopie bearbeiten": an own copy for the musician, switched to and straight into edit mode - even when every dashboard is a template', async () => {
    ctx.active = { id: 'stage', name: 'Bühne', isReadOnly: true }
    const duplicate = vi.fn(async () => ({ id: 'copy' }))
    const setActive = vi.fn()
    ctx.duplicate = duplicate
    ctx.setActive = setActive
    const onUnlock = vi.fn()
    render(<EditLock onUnlock={onUnlock} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Eigene Kopie bearbeiten/ })))
    expect(duplicate).toHaveBeenCalledWith('stage', 'Bühne Kopie', 'p-caro')
    expect(setActive).toHaveBeenCalledWith('band', 'copy')
    expect(useEditModeStore.getState().isEditing).toBe(true)
    expect(onUnlock).toHaveBeenCalled()
  })

  it('an admin can still unlock it', () => {
    ctx.active = { isReadOnly: true }
    ctx.roles = ['admin']
    render(<EditLock />)
    fireEvent.pointerDown(screen.getByText('Bearbeiten'))
    act(() => vi.advanceTimersByTime(600))
    expect(useEditModeStore.getState().isEditing).toBe(true)
  })
})


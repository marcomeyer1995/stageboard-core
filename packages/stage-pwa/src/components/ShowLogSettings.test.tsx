import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({ default: class {} }))

const { useBandSettingsStore } = await import('../store/useBandSettingsStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { ShowLogSettings } = await import('./ShowLogSettings')

const save = vi.fn(async () => {})
function setAdmin(isAdmin: boolean) {
  useWorkspaceStore.setState({ workspaces: [{ id: 'w', name: 'Band', isAdmin }] as never, activeWorkspaceId: 'w' })
}

beforeEach(() => {
  save.mockClear()
  useBandSettingsStore.setState({ settings: { id: 'band' }, save })
})

describe('ShowLogSettings (#673)', () => {
  it('records everything by default; an admin switches a category off and on again', () => {
    setAdmin(true)
    render(<ShowLogSettings />)
    expect(screen.getAllByRole('switch').every((s) => s.getAttribute('aria-checked') === 'true')).toBe(true)
    fireEvent.click(screen.getByRole('switch', { name: /Abschnitte/ }))
    expect(save).toHaveBeenCalledWith({ id: 'band', showLogOff: ['sections'] })
    act(() => useBandSettingsStore.setState({ settings: { id: 'band', showLogOff: ['sections'] } }))
    fireEvent.click(screen.getByRole('switch', { name: /Abschnitte/ }))
    expect(save).toHaveBeenLastCalledWith({ id: 'band', showLogOff: [] })
  })

  it('only admins may change it', () => {
    setAdmin(false)
    render(<ShowLogSettings />)
    expect(screen.getByText('Nur Band-Admins können das ändern.')).toBeInTheDocument()
    expect(screen.getAllByRole('switch').every((s) => (s as HTMLButtonElement).disabled)).toBe(true)
  })
})

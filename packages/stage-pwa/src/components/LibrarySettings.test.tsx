import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({ default: class {} }))
const { useBandSettingsStore } = await import('../store/useBandSettingsStore')
const { useLibraryPrefsStore } = await import('../store/useLibraryPrefsStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { PracticeWindowSettings, RehearsalWindowSettings } = await import('./LibrarySettings')

const asAdmin = (isAdmin: boolean) =>
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws', workspaces: [{ id: 'ws', name: 'Band', isAdmin }] as never })

describe('Bibliothek settings', () => {
  it('Geübt: the period is a per-device choice', () => {
    render(<PracticeWindowSettings />)
    fireEvent.click(screen.getByRole('radio', { name: '14 Tage' }))
    expect(useLibraryPrefsStore.getState().practiceDays).toBe(14)
  })

  it('Geprobt: an admin switches between days and last shows - stored for the band', () => {
    asAdmin(true)
    const save = vi.fn(async () => {})
    useBandSettingsStore.setState({ settings: { id: 'band' }, save })
    render(<RehearsalWindowSettings />)
    expect(screen.getByRole('radio', { name: '90 Tage' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: 'Shows' }))
    expect(save).toHaveBeenCalledWith({ id: 'band', rehearsalWindow: { kind: 'shows', shows: 5 } })
  })

  it('Geprobt: others see it but cannot change it', () => {
    asAdmin(false)
    useBandSettingsStore.setState({ settings: { id: 'band', rehearsalWindow: { kind: 'shows', shows: 10 } } })
    render(<RehearsalWindowSettings />)
    expect(screen.getByRole('radio', { name: 'letzte 10' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Tagen' })).toBeDisabled()
    expect(screen.getByText('Nur Band-Admins können das ändern.')).toBeInTheDocument()
  })
})

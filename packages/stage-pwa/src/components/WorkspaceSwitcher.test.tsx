import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

beforeEach(() => {
  useWorkspaceStore.setState({
    workspaces: [
      { id: 'band-a', name: 'Band A' },
      { id: 'band-b', name: 'Band B' },
    ],
    activeWorkspaceId: 'band-a',
  })
})

describe('WorkspaceSwitcher', () => {
  it('is a pure picker - lists every known band, no management controls', () => {
    render(<WorkspaceSwitcher />)

    expect(screen.getByRole('combobox')).toHaveValue('band-a')
    expect(screen.getByText('Band A')).toBeInTheDocument()
    expect(screen.getByText('Band B')).toBeInTheDocument()
    // Creating/renaming/inviting moved to SystemView's Band tab (BandManagementView.tsx).
    expect(screen.queryByTitle('Neue Band anlegen')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Band-Mitglieder einladen')).not.toBeInTheDocument()
  })

  it('picking a band calls setActiveWorkspace', () => {
    const setActiveWorkspace = vi.fn()
    useWorkspaceStore.setState({ setActiveWorkspace })
    render(<WorkspaceSwitcher />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'band-b' } })

    expect(setActiveWorkspace).toHaveBeenCalledWith('band-b')
  })
})

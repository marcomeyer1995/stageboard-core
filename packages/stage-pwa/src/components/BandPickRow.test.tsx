import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))

const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { useShowStateStore } = await import('../store/useShowStateStore')
const { BandPickRow } = await import('./BandPickRow')

describe('BandPickRow ("Band: …" in ☰, Marco 2026-10-16)', () => {
  it('shows the band and switches it from a small list; locked while a song plays', () => {
    const setActiveWorkspace = vi.fn()
    useWorkspaceStore.setState({ workspaces: [{ id: 'a', name: 'Abadschendaler' }, { id: 'b', name: 'Coverband' }], activeWorkspaceId: 'a', setActiveWorkspace } as never)
    useShowStateStore.setState({ state: { playbackStatus: 'stopped' } } as never)
    const { unmount } = render(<BandPickRow />)
    fireEvent.click(screen.getByRole('button', { name: /Band: Abadschendaler/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Coverband' }))
    expect(setActiveWorkspace).toHaveBeenCalledWith('b')
    unmount()
    useShowStateStore.setState({ state: { playbackStatus: 'playing' } } as never)
    render(<BandPickRow />)
    expect(screen.getByRole('button', { name: /Band: Abadschendaler/ })).toBeDisabled()
  })
})

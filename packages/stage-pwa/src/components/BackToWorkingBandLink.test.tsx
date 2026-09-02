import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// useWorkspaceStore now imports workspaceDb.ts (removeWorkspaceLocally's
// destroyLocalWorkspaceDb), which constructs a real PouchDB at module load time - unavailable
// under happy-dom (see workspaceDb.test.ts's identical mock).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
    destroy() {
      return Promise.resolve()
    }
  },
}))

const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { BackToWorkingBandLink } = await import('./BackToWorkingBandLink')

beforeEach(() => {
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: '' })
})

describe('BackToWorkingBandLink', () => {
  it('renders nothing when there is no other workspace with a stored password', () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A' }],
      activeWorkspaceId: 'band-a',
    })
    const { container } = render(<BackToWorkingBandLink />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists other workspaces this device already has a password for, excluding the active one', () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: 'band-a', name: 'Band A' },
        { id: 'band-b', name: 'Band B', couchPassword: 'pw-b' },
        { id: 'band-c', name: 'Band C', couchPassword: 'pw-c' },
      ],
      activeWorkspaceId: 'band-a',
    })
    render(<BackToWorkingBandLink />)

    expect(screen.getByText('← Zurück zu Band B')).toBeInTheDocument()
    expect(screen.getByText('← Zurück zu Band C')).toBeInTheDocument()
    expect(screen.queryByText(/Band A/)).not.toBeInTheDocument()
  })

  it('picking one calls setActiveWorkspace with its id', () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: 'band-a', name: 'Band A' },
        { id: 'band-b', name: 'Band B', couchPassword: 'pw-b' },
      ],
      activeWorkspaceId: 'band-a',
    })
    render(<BackToWorkingBandLink />)

    fireEvent.click(screen.getByText('← Zurück zu Band B'))

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('band-b')
  })
})

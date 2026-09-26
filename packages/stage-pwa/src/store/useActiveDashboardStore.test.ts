import { beforeEach, describe, expect, it, vi } from 'vitest'

// useAppModeStore reaches workspaceDb.ts (a real PouchDB at module load) - same mock as elsewhere.
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { useActiveDashboardStore } = await import('./useActiveDashboardStore')
const { useAppModeStore } = await import('./useAppModeStore')

beforeEach(() => {
  useActiveDashboardStore.setState({ byWorkspace: {}, byWorkspaceMode: {} })
})

describe('useActiveDashboardStore', () => {
  it('remembers the chosen dashboard per session mode, plus the last one shown overall', () => {
    useAppModeStore.setState({ mode: 'gig' })
    useActiveDashboardStore.getState().setActive('band', 'stage')
    useAppModeStore.setState({ mode: 'practice' })
    useActiveDashboardStore.getState().setActive('band', 'rehearsal')

    const state = useActiveDashboardStore.getState()
    expect(state.byWorkspaceMode.band).toEqual({ gig: 'stage', practice: 'rehearsal' })
    expect(state.byWorkspace.band).toBe('rehearsal')
  })
})

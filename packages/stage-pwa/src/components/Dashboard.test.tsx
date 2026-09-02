import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Dashboard as DashboardDoc } from 'shared-types'
import { useDashboardsStore } from '../store/useDashboardsStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

vi.mock('../lib/useElementSize', () => ({
  useElementSize: () => [(() => {}) as unknown as (el: HTMLElement | null) => void, { width: 1200, height: 800 }],
}))

// Every *Db.ts module instantiates a real PouchDB (directly, or via workspaceCollection.ts)
// at import time, against IndexedDB - unavailable under happy-dom. This test only exercises
// store/render wiring, never actual persistence, so every PouchDB instance is a harmless stub.
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    allDocs() {
      return Promise.resolve({ rows: [] })
    }
    get() {
      return Promise.reject(new Error('not found'))
    }
    put() {
      return Promise.resolve({ ok: true })
    }
    changes() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

import { Dashboard } from './Dashboard'

function makeDashboard(): DashboardDoc {
  return {
    id: 'default-prompter',
    name: 'Prompter',
    order: 0,
    widgets: [],
    layouts: {},
    visibility: 'public',
  }
}

describe('Dashboard', () => {
  beforeEach(() => {
    useDashboardsStore.setState({ dashboards: [makeDashboard()], loaded: true, resetNonce: 0 })
    useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }], activeWorkspaceId: 'band-a' })
  })

  it('does not enter a render loop when the dashboards store hands back a fresh-but-equal snapshot repeatedly', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<Dashboard />)

    // Mirrors useDashboardsStore's refresh(): every PouchDB `change` event re-fetches and
    // replaces `dashboards` with a brand new array/object graph, even when nothing in the
    // underlying documents actually changed - live sync traffic can fire this repeatedly.
    for (let i = 0; i < 50; i++) {
      act(() => {
        useDashboardsStore.setState({ dashboards: [makeDashboard()] })
      })
    }

    const loopWarnings = errorSpy.mock.calls.filter((args) =>
      args.some((arg) => typeof arg === 'string' && arg.includes('Maximum update depth exceeded')),
    )
    expect(loopWarnings).toHaveLength(0)

    errorSpy.mockRestore()
  })
})

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

  it('remounts the grid when the active dashboard\'s own widget set changes, not just on dashboard switch/reset (adding a widget from the library writes to *this same* dashboard, so active.id/resetNonce alone never changed for that case - the grid used to receive a fresh `layouts` object as a bare prop update on an already-mounted instance instead, which is exactly the react-grid-layout stale-internal-state resync bug this file\'s key already exists to avoid for other transitions - found live, 2026-09-15: "widgets jumping and resizing" specifically right after initial load or right after adding a widget)', () => {
    const dashboard: DashboardDoc = {
      id: 'default-prompter',
      name: 'Prompter',
      order: 0,
      widgets: [{ i: 'a', type: 'active-setlist', frameless: false }],
      layouts: { lg: [{ i: 'a', x: 0, y: 0, w: 3, h: 3 }] },
      visibility: 'public',
    }
    useDashboardsStore.setState({ dashboards: [dashboard], loaded: true, resetNonce: 0 })

    const { container } = render(<Dashboard />)
    const gridBefore = container.querySelector('.react-grid-layout')
    expect(gridBefore).not.toBeNull()

    // Same dashboard id/resetNonce - only the widget set changed, the same shape a "+
    // Widget" add (or an incoming remote sync of the same dashboard) produces.
    act(() => {
      useDashboardsStore.setState({
        dashboards: [
          {
            ...dashboard,
            widgets: [...dashboard.widgets, { i: 'b', type: 'active-setlist', frameless: false }],
            layouts: { lg: [...dashboard.layouts.lg!, { i: 'b', x: 3, y: 0, w: 3, h: 3 }] },
          },
        ],
      })
    })

    const gridAfter = container.querySelector('.react-grid-layout')
    expect(gridAfter).not.toBeNull()
    expect(gridAfter).not.toBe(gridBefore)
  })

  it('clamps a widget to its current registry maxW/maxH, not just whatever was persisted (#22)', () => {
    // 'active-setlist' registers maxW:6/maxH:6 (registry.tsx) - 'a' is persisted well past
    // that (e.g. seeded before the widget had a max, or from an older/larger registry
    // value). layoutFor must refresh the bound from WIDGET_REGISTRY on every read, so 'a'
    // renders exactly like 'b', which was placed at 6x6 to begin with.
    const dashboard: DashboardDoc = {
      id: 'default-prompter',
      name: 'Prompter',
      order: 0,
      widgets: [
        { i: 'a', type: 'active-setlist', frameless: false },
        { i: 'b', type: 'active-setlist', frameless: false },
      ],
      layouts: {
        lg: [
          { i: 'a', x: 0, y: 0, w: 10, h: 10 },
          { i: 'b', x: 6, y: 0, w: 6, h: 6 },
        ],
      },
      visibility: 'public',
    }
    useDashboardsStore.setState({ dashboards: [dashboard], loaded: true, resetNonce: 0 })

    const { container } = render(<Dashboard />)
    const [oversized, reference] = [...container.querySelectorAll('.react-grid-item')]
    const sizeOf = (el: Element) => el.getAttribute('style')?.match(/width: (\d+)px; height: (\d+)px/)?.slice(1)

    expect(sizeOf(reference)).toBeDefined()
    expect(sizeOf(oversized)).toEqual(sizeOf(reference))
  })
})

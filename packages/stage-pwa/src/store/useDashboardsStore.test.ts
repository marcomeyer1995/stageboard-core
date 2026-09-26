import { describe, expect, it, vi } from 'vitest'

// The real read path (init -> refresh -> toDashboard) against a stubbed database layer.
const docs = [
  { id: 'stage', name: 'Bühne', order: 0, widgets: [], layouts: {}, visibility: 'public', modes: ['gig'] },
  { id: 'both', name: 'Beide', order: 1, widgets: [], layouts: {}, visibility: 'public' },
]
vi.mock('../lib/dashboardsDb', () => ({
  getAllDashboards: vi.fn(async () => docs),
  dashboardsChanges: vi.fn(() => ({ on: () => undefined, cancel: () => undefined })),
  putDashboard: vi.fn(),
  removeDashboard: vi.fn(),
  switchDashboardsWorkspace: vi.fn(),
  updateDashboard: vi.fn(),
}))

const { useDashboardsStore } = await import('./useDashboardsStore')

describe('useDashboardsStore read path', () => {
  it('keeps a dashboard\'s modes when reading it from the database', async () => {
    // Regression (2026-09-27): toDashboard listed fields explicitly and dropped `modes`, so the
    // Gig/Solo chips saved, snapped back, and the next save from the store erased the setting.
    await useDashboardsStore.getState().init('band')
    const byId = Object.fromEntries(useDashboardsStore.getState().dashboards.map((d) => [d.id, d]))
    expect(byId.stage.modes).toEqual(['gig'])
    expect(byId.both.modes).toBeUndefined()
  })
})

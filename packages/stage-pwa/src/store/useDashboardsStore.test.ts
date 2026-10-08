import { describe, expect, it, vi } from 'vitest'
import { DashboardSchema } from 'shared-types'

// The real read path (init -> refresh -> toDashboard) against a stubbed database layer.
const docs = [
  { id: 'stage', name: 'Bühne', order: 0, widgets: [], layouts: {}, visibility: 'public', modes: ['gig'], statusBar: false, isReadOnly: true },
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

  it('keeps a dashboard\'s status bar setting when reading it from the database', async () => {
    // Same explicit field list as `modes` above - a dropped `statusBar` would bring the bar back.
    await useDashboardsStore.getState().init('band')
    const byId = Object.fromEntries(useDashboardsStore.getState().dashboards.map((d) => [d.id, d]))
    expect(byId.stage.statusBar).toBe(false)
    expect(byId.both.statusBar).toBeUndefined()
  })

  it('keeps the template protection (#16)', async () => {
    await useDashboardsStore.getState().init('band')
    const byId = Object.fromEntries(useDashboardsStore.getState().dashboards.map((d) => [d.id, d]))
    expect(byId.stage.isReadOnly).toBe(true)
    expect(byId.both.isReadOnly).toBeUndefined()
  })

  it('every dashboard field survives the read path - the next new field cannot be forgotten', async () => {
    // Third time this trap struck (modes, statusBar, isReadOnly): toDashboard lists fields by
    // hand. Each field the schema knows has to come through.
    const full = { id: 'full', name: 'Voll', order: 2, widgets: [], layouts: {}, visibility: 'private', ownerProfileId: 'p1', ownerRole: 'crew', modes: ['solo'], statusBar: true, isReadOnly: true }
    docs.push(full as (typeof docs)[number])
    await useDashboardsStore.getState().init('band')
    const read = useDashboardsStore.getState().dashboards.find((d) => d.id === 'full') as Record<string, unknown>
    for (const key of Object.keys(DashboardSchema.shape)) {
      expect(read[key], `field "${key}"`).toEqual((full as Record<string, unknown>)[key])
    }
    docs.pop()
  })

  it('a new dashboard or copy is in the store at once - the caller opens it right away (#422 review)', async () => {
    useDashboardsStore.setState({ dashboards: [] })
    const created = await useDashboardsStore.getState().create('Neu')
    expect(useDashboardsStore.getState().dashboards.map((d) => d.id)).toContain(created.id)
    const copy = await useDashboardsStore.getState().duplicate(created.id, 'Neu Kopie')
    expect(useDashboardsStore.getState().dashboards.map((d) => d.id)).toContain(copy!.id)
  })
})

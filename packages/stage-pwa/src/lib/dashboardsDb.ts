import type { Dashboard } from 'shared-types'
import { createWorkspaceCollection, type Doc } from './workspaceCollection'

export type DashboardDoc = Doc<Dashboard>

const dashboards = createWorkspaceCollection<Dashboard>('dashboards')

export const getDashboardsDb = dashboards.getDb
export const switchDashboardsWorkspace = dashboards.switchWorkspace
export const getAllDashboards = dashboards.getAll
export const putDashboard = dashboards.put
export const removeDashboard = dashboards.remove
export const startDashboardsSync = dashboards.startSync

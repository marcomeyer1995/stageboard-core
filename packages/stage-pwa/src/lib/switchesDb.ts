import type { Switch } from './switches'
import { createWorkspaceCollection } from './workspaceCollection'

/** The band's switches (docs/23 §11) - band-wide, like the dashboards their buttons sit on. */
const switches = createWorkspaceCollection<Switch>('switch')

export const switchSwitchesWorkspace = switches.switchWorkspace
export const getAllSwitches = switches.getAll
export const putSwitch = switches.put
export const removeSwitch = switches.remove
export const switchesChanges = switches.changes

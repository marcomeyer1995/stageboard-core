// The real stage map on its own page with local data only (PouchDB in the browser, no
// Stage-Server) - see README.md. Copied into packages/stage-pwa/src by run.sh, never committed there.
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import * as ST from 'shared-types'
import { initTheme } from './store/useThemeStore'
import { getDeviceId } from './lib/deviceId'
import { useWorkspaceStore, type Workspace } from './store/useWorkspaceStore'
import { useActiveProfileStore } from './store/useActiveProfileStore'
import { useProfilesStore } from './store/useProfilesStore'
import { usePresenceStore } from './store/usePresenceStore'
import { useDevicesStore } from './store/useDevicesStore'
import { useStageMapStore } from './store/useStageMapStore'
import { useDeviceInfoStore } from './store/useDeviceInfoStore'
import { usePluginsStore } from './store/usePluginsStore'
import { useOutputPlanStore } from './lib/audioMix'
import { StageMap } from './components/StageMap'
import { DialogHost } from './components/DialogHost'

// For scripts (tools/cdp/cdp.mjs eval): the shared types and the stores.
Object.assign(window, { __st: ST, __map: useStageMapStore, __di: useDeviceInfoStore, __pl: usePluginsStore, __op: useOutputPlanStore })

initTheme()
const me = getDeviceId()
const admin = new URLSearchParams(location.search).get('admin') !== '0'
useWorkspaceStore.setState({ workspaces: [{ id: 'harness', name: 'Test', isAdmin: admin } as Workspace], activeWorkspaceId: 'harness' })
useActiveProfileStore.setState({ byWorkspace: { harness: 'p-a' } })
useProfilesStore.setState({ profiles: [{ id: 'p-a', name: 'Alex' }, { id: 'p-b', name: 'Kai' }] as never })
usePresenceStore.setState({ presence: { devices: { [me]: { profileId: 'p-a' }, tablet2: { profileId: 'p-b' } } } as never })
const now = Date.now()
useDevicesStore.setState({
  devices: [
    { id: me, name: 'Tablet 1', lastSeenAt: now, firstSeenAt: 0, revoked: false },
    { id: 'tablet2', name: 'Tablet 2', lastSeenAt: now, firstSeenAt: 0, revoked: false },
    { id: 'phone', name: 'Phone', lastSeenAt: now, firstSeenAt: 0, revoked: false },
  ],
  loaded: true,
})
void useStageMapStore.getState().init('harness').then(() => {
  createRoot(document.getElementById('root')!).render(
    <div className="min-h-screen bg-stage p-4 text-ink">
      <StageMap />
      <DialogHost />
    </div>,
  )
})

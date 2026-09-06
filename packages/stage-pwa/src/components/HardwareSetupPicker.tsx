import { setActiveHardwareSetup } from '../lib/queue'
import { useHardwareSetupsStore } from '../store/useHardwareSetupsStore'
import { useShowStateStore } from '../store/useShowStateStore'

/**
 * Lets Master pick which HardwareSetup profile is active tonight (#10, replacing the earlier
 * per-capability DeviceClaimControl) - instantiated once in AppMenu.tsx. Only a *picker*: no UI
 * exists yet to create or edit a HardwareSetup's own bindings (a follow-up slice), so this list
 * is empty until one is seeded some other way (directly in CouchDB, or a future admin UI).
 */
export function HardwareSetupPicker() {
  const isMaster = useShowStateStore((state) => state.isMaster)
  const activeHardwareSetupId = useShowStateStore((state) => state.state.activeHardwareSetupId)
  const setups = useHardwareSetupsStore((state) => state.setups)

  return (
    <div className="flex h-12 items-center justify-between rounded-sb bg-control px-4 text-base text-ink-soft">
      Hardware-Setup
      <select
        value={activeHardwareSetupId ?? ''}
        disabled={!isMaster}
        onChange={(e) => void setActiveHardwareSetup(e.target.value || null)}
        className="rounded-sb-sm bg-control-strong px-2 py-1 text-sm font-medium text-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        <option value="">Standard (Stage-Server-Plugins)</option>
        {setups.map((setup) => (
          <option key={setup.id} value={setup.id}>
            {setup.name}
          </option>
        ))}
      </select>
    </div>
  )
}

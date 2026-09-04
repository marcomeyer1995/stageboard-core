import { claimDevice, releaseDevice } from '../lib/queue'
import { useDeviceName } from '../store/useDevicesStore'
import { useShowStateStore } from '../store/useShowStateStore'

/**
 * One capability's device claim (#10, generalized beyond audio - see showState.ts's
 * `deviceClaims` doc comment) - instantiated once per relay-backed capability in AppMenu.tsx.
 */
export function DeviceClaimControl({ capability, label, hint }: { capability: string; label: string; hint: string }) {
  const isMaster = useShowStateStore((state) => state.isMaster)
  const deviceId = useShowStateStore((state) => state.deviceId)
  const claimedDeviceId = useShowStateStore((state) => state.state.deviceClaims[capability])
  const isMine = claimedDeviceId === deviceId
  const otherDeviceName = useDeviceName(isMine ? null : (claimedDeviceId ?? null))

  return (
    <div className="flex h-12 items-center justify-between rounded-sb bg-control px-4 text-base text-ink-soft">
      {label}
      {claimedDeviceId === undefined ? (
        <button type="button" onClick={() => void claimDevice(capability)} disabled={!isMaster}
          title={hint}
          className="font-medium text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline">
          Dieses Gerät übernehmen
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <span className={`text-sm ${isMine ? 'text-accent' : 'text-ink-faint'}`}>
            {isMine ? 'Dieses Gerät' : (otherDeviceName ?? 'Anderes Gerät')}
          </span>
          <button type="button" onClick={() => void releaseDevice(capability)} disabled={!isMaster}
            className="text-sm font-medium text-ink-soft hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline">
            Freigeben
          </button>
        </div>
      )}
    </div>
  )
}

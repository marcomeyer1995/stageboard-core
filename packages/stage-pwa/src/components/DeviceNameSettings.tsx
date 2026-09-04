import { useEffect, useState } from 'react'
import { getDeviceId } from '../lib/deviceId'
import { useDevicesStore } from '../store/useDevicesStore'

/**
 * Lets this device rename itself in the workspace's DeviceRegistry (#10's first slice) - the
 * name every other tablet then sees wherever this device is already referenced (Master-Token,
 * the audio-output claim). Deliberately self-service, not an admin-managed list: a musician
 * naming their own tablet "Marcos iPad" doesn't need anyone else's permission, and there's no
 * per-device access control riding on this (that's the roster/profile system's job).
 */
export function DeviceNameSettings() {
  const devices = useDevicesStore((state) => state.devices)
  const rename = useDevicesStore((state) => state.rename)
  const deviceId = getDeviceId()
  const current = devices.find((device) => device.id === deviceId)?.name ?? ''
  const [draft, setDraft] = useState(current)

  // Picks up the auto-generated name once useDevicesStore's self-registration finishes -
  // this component can mount before that write/refresh has landed.
  useEffect(() => setDraft(current), [current])

  const dirty = draft.trim().length > 0 && draft.trim() !== current

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Name dieses Geräts"
        className="h-12 flex-1 rounded-sb bg-control px-4 text-base text-ink placeholder:text-ink-faint"
      />
      <button
        type="button"
        onClick={() => void rename(deviceId, draft.trim())}
        disabled={!dirty}
        className="h-12 rounded-sb bg-control-strong px-4 text-sm font-medium text-accent hover:bg-control-strong-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        Speichern
      </button>
    </div>
  )
}

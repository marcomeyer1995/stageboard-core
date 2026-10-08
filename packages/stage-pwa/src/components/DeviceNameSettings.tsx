import { useEffect, useState } from 'react'
import { getDeviceId } from '../lib/deviceId'
import { useDevicesStore } from '../store/useDevicesStore'
import { INPUT_FREE } from './ui/styles'
import { Button } from './ui'

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
        className={`h-form flex-1 min-w-0 px-4 text-base placeholder:text-ink-faint ${INPUT_FREE}`}
      />
      <Button onClick={() => void rename(deviceId, draft.trim())} disabled={!dirty}>
        Speichern
      </Button>
    </div>
  )
}

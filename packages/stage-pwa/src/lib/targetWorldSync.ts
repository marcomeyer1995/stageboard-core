import { useEffect } from 'react'
import { useBandSettingsStore } from '../store/useBandSettingsStore'
import { useDevicesStore } from '../store/useDevicesStore'
import { useHostEpochStore } from './hostEpoch'
import { useTargetWorldStore } from './targetWorld'
import { targetWorldOf } from './targetWorldOf'

/** Mounted once in App.tsx: keeps `useTargetWorldStore` in step with the host this device talks to, the band's listed hosts and the roster. */
export function useTargetWorldSync(): void {
  const currentHostId = useHostEpochStore((s) => s.currentHostId)
  const hosts = useBandSettingsStore((s) => s.settings.hosts)
  const devices = useDevicesStore((s) => s.devices)
  const hostDevices = useDevicesStore((s) => s.hosts)
  useEffect(() => {
    useTargetWorldStore.getState().set(targetWorldOf({ currentHostId, listedHostIds: [...(hosts ?? []).map((h) => h.hostId), ...hostDevices.map((h) => h.id)], deviceIds: devices.map((d) => d.id) }))
  }, [currentHostId, hosts, devices, hostDevices])
}

import { useMemo } from 'react'
import { addonsForSlot } from '../lib/addonUi/builtinAddons'
import { AddonSlot, type ViewWorkerFactory } from '../lib/addonUi/slotHost'
import i18n from '../i18n'
import { useDeviceStateStore } from '../store/useDeviceStateStore'
import { usePluginsStore } from '../store/usePluginsStore'

/**
 * The panels add-ons offer for a device (docs/36 §6 slot `device.panel`, §5a, #964): each installed add-on that declared the slot draws its own view of the
 * device - drawn from a description, bound to the device's live state (`{bind: "state:<device>.<key>"}`), so the panel follows the device without asking the
 * add-on again. The caller says which logical device it is and where to put this; it knows nothing of what a panel shows.
 */
export function DevicePanelSlots({ logicalDeviceId, createWorker }: { logicalDeviceId: string; createWorker?: ViewWorkerFactory }) {
  const installed = usePluginsStore((s) => s.installed)
  const values = useDeviceStateStore((s) => s.values)
  const entries = useMemo(() => addonsForSlot('device.panel', installed.filter((p) => p.enabled).map((p) => p.id)), [installed])
  const sources = useMemo(() => ({ jobs: {}, state: values }), [values])
  if (entries.length === 0) return null
  return (
    <>
      {entries.map(({ addon, entry }) => (
        <AddonSlot
          key={`${addon.id}:${entry.id}:${logicalDeviceId}`}
          slot="device.panel"
          addon={{ id: addon.id, code: addon.viewScript, permissions: addon.permissions, imageOrigins: addon.imageOrigins }}
          context={{ device: logicalDeviceId }}
          language={i18n.language}
          sources={sources}
          // A panel asks nothing of the host: its values are bound to the device's state.
          {...(createWorker ? { createWorker } : {})}
        />
      ))}
    </>
  )
}

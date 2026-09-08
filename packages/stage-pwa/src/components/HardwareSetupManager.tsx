import { useState } from 'react'
import { SERVER_EXECUTION_TARGET, type LogicalDevice } from 'shared-types'
import { getDeviceId } from '../lib/deviceId'
import { findLogicalDeviceUsage } from '../lib/logicalDeviceUsage'
import { useDeviceTransportConfigStore } from '../store/useDeviceTransportConfigStore'
import { useDialogStore } from '../store/useDialogStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { useSongsStore } from '../store/useSongsStore'
import { DeviceSetupWizard } from './DeviceSetupWizard'

const STATUS_LABEL: Record<'complete' | 'incomplete', string> = {
  complete: 'vollständig',
  incomplete: 'unvollständig',
}

/**
 * Every configured Logical Device, guided setup for adding/editing one via `DeviceSetupWizard`.
 * Replaces the old flat LogicalDeviceList + HardwareSetupList + BindingEditor + standalone
 * DiscoveryWizard - #10's routing (which plugin, which execution target) now lives directly on
 * each Logical Device (see logicalDevice.ts's doc comment for why multi-Setup swapping was
 * dropped), so there's exactly one list here, not three separate CRUD screens.
 */
function DeviceList({ onEdit, onAdd }: { onEdit: (device: LogicalDevice) => void; onAdd: () => void }) {
  const devices = useLogicalDevicesStore((state) => state.devices)
  const remove = useLogicalDevicesStore((state) => state.remove)
  const installed = usePluginsStore((state) => state.installed)
  const devicesRegistry = useDeviceTransportConfigStore((state) => state.configs)
  const variants = useSongVariantsStore((state) => state.variants)
  const songs = useSongsStore((state) => state.songs)
  const confirm = useDialogStore((state) => state.confirm)

  function pluginNameOf(pluginId: string | null): string {
    return (pluginId && installed.find((p) => p.id === pluginId)?.name) || '—'
  }

  function targetLabel(executionTarget: string | null): string {
    if (!executionTarget) return '—'
    if (executionTarget === SERVER_EXECUTION_TARGET) return 'Stage-Server'
    return executionTarget === getDeviceId() ? 'Dieses Gerät' : executionTarget
  }

  return (
    <div className="flex flex-col gap-2">
      {devices.length === 0 && <p className="text-sm text-ink-faint">Noch keine Geräte eingerichtet.</p>}
      {devices.map((device) => {
        const complete = Boolean(device.pluginId && device.executionTarget)
        const usage = findLogicalDeviceUsage(device.id, variants, songs)
        const hasOwnTransportConfig = devicesRegistry.some((c) => c.logicalDeviceId === device.id && c.deviceId === getDeviceId())
        return (
          <div key={device.id} className="flex items-center gap-3 rounded-sb border border-line bg-surface px-4 py-3 shadow-sb">
            <div className="flex-1">
              <p className="font-semibold">
                {device.name} <span className="text-xs font-normal text-ink-faint">({STATUS_LABEL[complete ? 'complete' : 'incomplete']})</span>
              </p>
              <p className="text-xs text-ink-muted">
                {pluginNameOf(device.pluginId)} · {targetLabel(device.executionTarget)}
                {usage.length > 0 && <span className="text-ink-faint"> · verwendet in: {usage.map((u) => u.songTitle).join(', ')}</span>}
                {hasOwnTransportConfig && device.executionTarget === getDeviceId() && <span className="text-ink-faint"> · Anschluss auf diesem Gerät gesetzt</span>}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onEdit(device)}
              className="rounded-sb-sm bg-control-strong px-3 py-1 text-xs font-medium text-accent hover:bg-control-strong-hover"
            >
              Einrichten
            </button>
            <button
              type="button"
              onClick={async () => {
                if (await confirm(`"${device.name}" löschen?`, { confirmLabel: 'Löschen', danger: true })) {
                  void remove(device.id)
                }
              }}
              className="rounded-sb-sm bg-control px-3 py-1 text-xs text-ink-soft hover:bg-control-hover"
            >
              Entfernen
            </button>
          </div>
        )
      })}

      <button
        type="button"
        onClick={onAdd}
        className="h-11 rounded-sb border border-dashed border-line text-sm font-medium text-accent hover:bg-control-hover"
      >
        + Neues Gerät
      </button>
    </div>
  )
}

/**
 * The admin UI #10's issue asked for, redesigned as a guided setup wizard (Marco, explicit
 * request, Home-Assistant-style "add integration" flow): name a device, pick its type
 * (installing the matching plugin inline), connect it (Discovery Mode's auto-discovery or a
 * manual fallback), verify it works - all in `DeviceSetupWizard.tsx`, opened from either "+ Neues
 * Gerät" or an existing device's "Einrichten".
 *
 * There used to be a second, separately scoped "Dieses Gerät" section below the device list for
 * quick inline edits of just this tablet's own transport wiring - dropped (Marco, explicit
 * request) in favor of one single entry point per device: two different places to edit the same
 * connection data was more surface to keep in sync, not less. "Einrichten" reopens the wizard
 * already positioned at Step 3 (Connection) for a device that already has a type, so the common
 * case - tweak this device's port/host - is still a click away, not four.
 */
export function HardwareSetupManager() {
  const [editing, setEditing] = useState<LogicalDevice | null | undefined>(undefined) // undefined = wizard closed

  return (
    <div className="h-dvh overflow-y-auto sb-app-bg p-4 text-ink">
      <h1 className="mb-1 text-2xl font-bold">Hardware-Setup</h1>
      <p className="mb-4 text-sm text-ink-muted">
        Jedes Gerät ist eine benannte Rolle (z.B. „Marcos Kemper“) mit ihrer eigenen, aktuell
        gültigen Verbindung - Typ, ausführendes Gerät und Anschluss. „Einrichten“ führt noch
        einmal durch die Einrichtung, mit den bisherigen Angaben schon ausgefüllt - bei einem
        bereits eingerichteten Gerät direkt beim Anschluss.
      </p>

      <div className="mb-6">
        <DeviceList onEdit={setEditing} onAdd={() => setEditing(null)} />
      </div>

      {editing !== undefined && <DeviceSetupWizard device={editing} onClose={() => setEditing(undefined)} />}
    </div>
  )
}

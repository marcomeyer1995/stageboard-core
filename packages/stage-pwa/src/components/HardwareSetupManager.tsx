import { useEffect, useState } from 'react'
import { CAPABILITIES, SERVER_EXECUTION_TARGET, type LogicalDevice } from 'shared-types'
import { getDeviceId } from '../lib/deviceId'
import { findLogicalDeviceUsage } from '../lib/logicalDeviceUsage'
import { useDeviceTransportConfigStore } from '../store/useDeviceTransportConfigStore'
import { useDevicesStore } from '../store/useDevicesStore'
import { useDialogStore } from '../store/useDialogStore'
import { useHardwareSetupWizardStore, type NewDevicePrefill } from '../store/useHardwareSetupWizardStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { useMidiControllerRulesStore } from '../store/useMidiControllerRulesStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { useSongsStore } from '../store/useSongsStore'
import { BuiltInOutputs, builtInRoles } from './BuiltInOutputs'
import { DeviceSetupWizard } from './DeviceSetupWizard'
import { MidiControllerButtonsDialog } from './MidiControllerButtons'
import { pluginKind } from '../lib/pluginCatalog'
import { ActionMenu, AddRow } from './ui'

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
  const allDevices = useLogicalDevicesStore((state) => state.devices)
  // Klick, Backing-Track and Ansagen are the fixed first rows (BuiltInOutputs).
  const builtIn = builtInRoles(allDevices)
  const devices = allDevices.filter((device) => !builtIn.includes(device))
  const remove = useLogicalDevicesStore((state) => state.remove)
  const installed = usePluginsStore((state) => state.installed)
  const uninstall = usePluginsStore((state) => state.uninstall)
  const devicesRegistry = useDeviceTransportConfigStore((state) => state.configs)
  const variants = useSongVariantsStore((state) => state.variants)
  const songs = useSongsStore((state) => state.songs)
  const confirm = useDialogStore((state) => state.confirm)
  const knownDevices = useDevicesStore((state) => state.devices)
  const removeButtons = useMidiControllerRulesStore((state) => state.remove)
  const [buttonsFor, setButtonsFor] = useState<LogicalDevice | null>(null)

  function pluginNameOf(pluginId: string | null): string | null {
    return (pluginId && installed.find((p) => p.id === pluginId)?.name) || null
  }

  function targetLabel(executionTarget: string | null): string | null {
    if (!executionTarget) return null
    if (executionTarget === SERVER_EXECUTION_TARGET) return 'Stage-Server'
    if (executionTarget === getDeviceId()) return 'Dieses Gerät'
    // The tablet's name from the Geräte list, never its internal id (System cleanup, 2026-10-16).
    return knownDevices.find((d) => d.id === executionTarget)?.name ?? 'unbekanntes Gerät'
  }

  return (
    <div className="flex flex-col gap-2">
      <BuiltInOutputs />
      {devices.map((device) => {
        const complete = Boolean(device.pluginId && device.executionTarget)
        const usage = findLogicalDeviceUsage(device.id, variants, songs)
        const hasOwnTransportConfig = devicesRegistry.some((c) => c.logicalDeviceId === device.id && c.deviceId === getDeviceId())
        return (
          <div key={device.id} className="flex items-center gap-3 rounded-control border border-line bg-surface px-3 py-1">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {device.name} <span className="text-xs font-normal text-ink-faint">({STATUS_LABEL[complete ? 'complete' : 'incomplete']})</span>
              </p>
              <p className="break-words text-sm text-ink-muted">
                {/* Only what is known - no "—" placeholders (System cleanup, 2026-10-16). */}
                {[pluginNameOf(device.pluginId) ?? 'Typ fehlt', targetLabel(device.executionTarget) ?? 'kein Gerät gewählt'].join(' · ')}
                {usage.length > 0 && <span className="text-ink-faint"> · verwendet in: {usage.map((u) => u.songTitle).join(', ')}</span>}
                {hasOwnTransportConfig && device.executionTarget === getDeviceId() && <span className="text-ink-faint"> · Anschluss auf diesem Gerät gesetzt</span>}
              </p>
            </div>
            {/* Actions behind ⋯ like every list row - two buttons beside the text pushed past the
                card on the phone and squeezed the text to a narrow column (2026-10-07). */}
            <ActionMenu
              title={device.name}
              actions={[
                { label: 'Einrichten', onClick: () => onEdit(device) },
                ...(device.capability === CAPABILITIES.midiController ? [{ label: 'Knöpfe belegen', onClick: () => setButtonsFor(device) }] : []),
                {
                  label: 'Entfernen',
                  danger: true,
                  onClick: async () => {
                    if (!(await confirm(`"${device.name}" löschen?`, { confirmLabel: 'Löschen', danger: true }))) return
                    await remove(device.id)
                    if (device.capability === CAPABILITIES.midiController) void removeButtons(device.id)
                    // Drivers stay out of sight (Marco, 2026-10-16): one no device needs any more is
                    // offered for removal with its last device.
                    const driver = installed.find((p) => p.id === device.pluginId)
                    if (!driver || pluginKind(driver) !== 'drivers' || allDevices.some((d) => d.id !== device.id && d.pluginId === driver.id)) return
                    if (await confirm(`Kein Gerät braucht den Treiber „${driver.name}“ mehr. Auch ihn entfernen?`, { confirmLabel: 'Treiber entfernen' })) void uninstall(driver.id)
                  },
                },
              ]}
            />
          </div>
        )
      })}

      <AddRow label="Neues Gerät" onClick={onAdd} />
      {buttonsFor && <MidiControllerButtonsDialog device={buttonsFor} onClose={() => setButtonsFor(null)} />}
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
  const [newDevicePrefill, setNewDevicePrefill] = useState<NewDevicePrefill | null>(null)
  const pendingPrefill = useHardwareSetupWizardStore((state) => state.prefill)
  const consumePrefill = useHardwareSetupWizardStore((state) => state.consumePrefill)

  // useHardwareDetection.ts's "no matching role yet" dialog offering to create one on the spot
  // (see useHardwareSetupWizardStore.ts) - only reachable while this screen is already showing
  // (that dialog is itself gated to System → Bühnentechnik), so opening straight into it here is safe.
  useEffect(() => {
    if (!pendingPrefill) return
    setNewDevicePrefill(pendingPrefill)
    setEditing(null)
    consumePrefill()
  }, [pendingPrefill, consumePrefill])

  function openBlankWizard(): void {
    setNewDevicePrefill(null)
    setEditing(null)
  }

  function closeWizard(): void {
    setEditing(undefined)
    setNewDevicePrefill(null)
  }

  return (
    <div className="h-full overflow-y-auto sb-app-bg p-4 text-ink">
      <h1 className="mb-1 text-2xl font-bold">Bühnentechnik</h1>
      {/* One list (Marco, 2026-10-16): what the band has and where it hangs. Drivers are a technical
          detail - installed with a device, offered for removal with its last one; Diagnose lists them. */}
      <p className="mb-4 text-sm text-ink-muted">
        Alle Geräte der Band und wo sie hängen. Oben Klick, Backing-Track und Ansagen - eingebaut, nur das spielende Gerät ist wählbar. Darunter Amp, Mischpult, Looper und
        Co., je mit Typ und dem Tablet, an dem sie hängen.
      </p>

      <div className="mb-6">
        <DeviceList onEdit={setEditing} onAdd={openBlankWizard} />
      </div>

      {editing !== undefined && (
        <DeviceSetupWizard device={editing} initialDraft={editing === null ? newDevicePrefill : null} onClose={closeWizard} />
      )}
    </div>
  )
}

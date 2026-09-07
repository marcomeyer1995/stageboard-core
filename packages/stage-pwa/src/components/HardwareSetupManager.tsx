import { useState } from 'react'
import { SERVER_EXECUTION_TARGET, type LogicalDevice, type PluginInstallation } from 'shared-types'
import { getTranslator, hasClientTranslator } from '../lib/clientTranslator'
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
              Bearbeiten
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

function TransportConfigForm({ logicalDevice, plugin }: { logicalDevice: LogicalDevice; plugin: PluginInstallation }) {
  const deviceId = getDeviceId()
  const configId = `${deviceId}:${logicalDevice.id}`
  const existing = useDeviceTransportConfigStore((state) => state.configs.find((c) => c.id === configId))
  const save = useDeviceTransportConfigStore((state) => state.save)
  const installed = usePluginsStore((state) => state.installed)
  const [transportId, setTransportId] = useState(existing?.transportId ?? plugin.transports[0]?.id ?? '')
  const [values, setValues] = useState<Record<string, string>>(existing?.values ?? {})
  const [testResult, setTestResult] = useState<string | null>(null)
  const transport = plugin.transports.find((t) => t.id === transportId)

  function submit() {
    if (!transport) return
    void save({ id: configId, deviceId, logicalDeviceId: logicalDevice.id, transportId: transport.id, values })
  }

  async function runTest() {
    setTestResult('…')
    const result = await getTranslator(logicalDevice.capability)?.({ type: 'test', payload: {} })
    setTestResult(result ? `${result.status}${result.message ? `: ${result.message}` : ''}` : 'kein Translator')
  }

  return (
    <div className="flex flex-col gap-2 rounded-sb-sm bg-control px-3 py-2">
      <div className="flex items-center justify-between gap-3 text-sm text-ink-soft">
        <span>
          {logicalDevice.name} <span className="text-xs text-ink-faint">via {plugin.name}</span>
        </span>
        {plugin.transports.length > 1 && (
          <select
            value={transportId}
            onChange={(e) => {
              setTransportId(e.target.value)
              setValues({})
            }}
            className="h-8 rounded-sb-sm bg-control-strong px-2 text-xs text-ink"
          >
            {plugin.transports.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {transport && (
        <div className="flex flex-wrap items-end gap-2">
          {transport.fields.map((field) => (
            <label key={field.key} className="flex flex-col gap-1 text-xs text-ink-muted">
              {field.label}
              <input
                type={field.type}
                value={values[field.key] ?? ''}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                className="w-32 rounded-sb-sm bg-control-strong px-2 py-1 text-sm text-ink"
              />
            </label>
          ))}
          <button
            type="button"
            onClick={submit}
            className="h-8 rounded-sb-sm bg-control-strong px-3 text-xs font-medium text-accent hover:bg-control-strong-hover"
          >
            Speichern
          </button>
          {hasClientTranslator(installed, logicalDevice.capability) && (
            <button
              type="button"
              onClick={() => void runTest()}
              className="h-8 rounded-sb-sm bg-control-strong px-3 text-xs font-medium text-ink-soft hover:bg-control-strong-hover"
            >
              Testen
            </button>
          )}
          {testResult && <span className="text-xs text-ink-faint">{testResult}</span>}
        </div>
      )}
    </div>
  )
}

/**
 * This tablet's own transport wiring (#100) - only ever this device's entries, never another
 * tablet's: a browser can only enumerate what's physically attached to *it*, so editing someone
 * else's wiring from here would be meaningless. Only lists Logical Devices whose own
 * `executionTarget` is this device (one hop, now that #10's routing lives directly on the
 * Logical Device instead of a separate per-Setup binding map) and whose plugin actually declares
 * transports - nothing to configure otherwise.
 */
function DeviceTransportConfigSection() {
  const deviceId = getDeviceId()
  const logicalDevices = useLogicalDevicesStore((state) => state.devices)
  const installed = usePluginsStore((state) => state.installed)

  const entries: { logicalDevice: LogicalDevice; plugin: PluginInstallation }[] = []
  for (const logicalDevice of logicalDevices) {
    if (logicalDevice.executionTarget !== deviceId) continue
    const plugin = installed.find((p) => p.id === logicalDevice.pluginId)
    if (!plugin || plugin.transports.length === 0) continue
    entries.push({ logicalDevice, plugin })
  }

  if (entries.length === 0) return null

  return (
    <>
      <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-ink-muted">Dieses Gerät</h2>
      <div className="mb-6 flex flex-col gap-2">
        <p className="text-xs text-ink-faint">
          Anschluss-Konfiguration für Rollen, die aktuell diesem Gerät zugewiesen sind - nur hier
          änderbar, da nur dieses Gerät seine eigenen Anschlüsse kennt.
        </p>
        {entries.map(({ logicalDevice, plugin }) => (
          <TransportConfigForm key={logicalDevice.id} logicalDevice={logicalDevice} plugin={plugin} />
        ))}
      </div>
    </>
  )
}

/**
 * The admin UI #10's issue asked for, redesigned as a guided setup wizard (Marco, explicit
 * request, Home-Assistant-style "add integration" flow): name a device, pick its type
 * (installing the matching plugin inline), connect it (Discovery Mode's auto-discovery or a
 * manual fallback), verify it works - all in `DeviceSetupWizard.tsx`, opened from either "+ Neues
 * Gerät" or an existing device's "Bearbeiten".
 *
 * "Dieses Gerät" (DeviceTransportConfigSection, #100) stays its own, separately scoped section
 * below the device list: which plugin/target a role uses is a band-wide choice (set inside the
 * wizard, replicated to everyone), but the actual transport wiring (MIDI port, USB device, IP)
 * can only be set standing at the device itself.
 */
export function HardwareSetupManager() {
  const [editing, setEditing] = useState<LogicalDevice | null | undefined>(undefined) // undefined = wizard closed

  return (
    <div className="h-dvh overflow-y-auto sb-app-bg p-4 text-ink">
      <h1 className="mb-1 text-2xl font-bold">Hardware-Setup</h1>
      <p className="mb-4 text-sm text-ink-muted">
        Jedes Gerät ist eine benannte Rolle (z.B. „Marcos Kemper“) mit ihrer eigenen, aktuell
        gültigen Verbindung - Typ, ausführendes Gerät und Anschluss. „Bearbeiten“ führt noch
        einmal durch die Einrichtung, mit den bisherigen Angaben schon ausgefüllt.
      </p>

      <div className="mb-6">
        <DeviceList onEdit={setEditing} onAdd={() => setEditing(null)} />
      </div>

      <DeviceTransportConfigSection />

      {editing !== undefined && <DeviceSetupWizard device={editing} onClose={() => setEditing(undefined)} />}
    </div>
  )
}

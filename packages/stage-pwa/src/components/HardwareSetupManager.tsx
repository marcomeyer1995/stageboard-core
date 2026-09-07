import { useState } from 'react'
import {
  CAPABILITIES,
  SERVER_EXECUTION_TARGET,
  type CapabilityId,
  type HardwareBinding,
  type LogicalDevice,
  type PluginInstallation,
} from 'shared-types'
import { getTranslator, hasClientTranslator, supportsLocalExecution } from '../lib/clientTranslator'
import { getDeviceId } from '../lib/deviceId'
import { randomId } from '../lib/id'
import { useDevicesStore } from '../store/useDevicesStore'
import { useDeviceTransportConfigStore } from '../store/useDeviceTransportConfigStore'
import { useDialogStore } from '../store/useDialogStore'
import { useHardwareSetupsStore } from '../store/useHardwareSetupsStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { usePluginsStore } from '../store/usePluginsStore'

const CAPABILITY_OPTIONS = Object.values(CAPABILITIES)

function LogicalDeviceList() {
  const devices = useLogicalDevicesStore((state) => state.devices)
  const save = useLogicalDevicesStore((state) => state.save)
  const remove = useLogicalDevicesStore((state) => state.remove)
  const confirm = useDialogStore((state) => state.confirm)
  const installed = usePluginsStore((state) => state.installed)
  const [name, setName] = useState('')
  const [capability, setCapability] = useState<CapabilityId>(CAPABILITY_OPTIONS[0])

  // capability.ts's own vocabulary is deliberately open ("community plugins bring their own") -
  // an installed plugin's capability isn't necessarily one of StageBoard's core CAPABILITY_OPTIONS
  // (e.g. a device-specific plugin like Kemper Profiler declares 'kemper-control'), so without
  // this a Logical Device could never be created for it at all.
  const capabilityOptions = Array.from(new Set([...CAPABILITY_OPTIONS, ...installed.flatMap((p) => p.capabilities)]))

  async function add() {
    const trimmed = name.trim()
    if (!trimmed) return
    await save({ id: randomId(), name: trimmed, capability })
    setName('')
  }

  return (
    <div className="flex flex-col gap-2">
      {devices.length === 0 && <p className="text-sm text-ink-faint">Noch keine Logical Devices.</p>}
      {devices.map((device) => (
        <div
          key={device.id}
          className="flex items-center gap-3 rounded-sb border border-line bg-surface px-4 py-3 shadow-sb"
        >
          <div className="flex-1">
            <p className="font-semibold">{device.name}</p>
            <p className="text-xs text-ink-muted">{device.capability}</p>
          </div>
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
      ))}

      <div className="flex flex-wrap items-center gap-2 rounded-sb border border-dashed border-line px-4 py-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name, z.B. „Marcos Kemper“"
          className="h-10 min-w-40 flex-1 rounded-sb-sm bg-control px-3 text-sm text-ink placeholder:text-ink-faint"
        />
        <select
          value={capability}
          onChange={(e) => setCapability(e.target.value)}
          className="h-10 rounded-sb-sm bg-control px-2 text-sm text-ink"
        >
          {capabilityOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void add()}
          disabled={!name.trim()}
          className="h-10 rounded-sb-sm bg-control-strong px-3 text-sm font-medium text-accent hover:bg-control-strong-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          Hinzufügen
        </button>
      </div>
    </div>
  )
}

function BindingEditor({
  logicalDevice,
  binding,
  onChange,
}: {
  logicalDevice: LogicalDevice
  binding: HardwareBinding
  onChange: (binding: HardwareBinding) => void
}) {
  const physicalDevices = useDevicesStore((state) => state.devices)
  const installed = usePluginsStore((state) => state.installed)
  // #98: a tablet is only offered as a target when something can actually execute this
  // capability there (a real client-runtime plugin, or - audio-playback - native browser
  // playback) - otherwise the binding would silently promise routing nothing implements.
  const localExecutionAvailable = supportsLocalExecution(installed, logicalDevice.capability)
  // #100: only worth picking when there's real ambiguity - one candidate (or none) has
  // nothing to choose between, so the picker stays hidden rather than a dropdown with a
  // single, forced option.
  const candidatePlugins = installed.filter(
    (plugin) => plugin.enabled && plugin.capabilities.includes(logicalDevice.capability),
  )

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center justify-between gap-3 text-sm text-ink-soft">
        <span>
          {logicalDevice.name} <span className="text-xs text-ink-faint">({logicalDevice.capability})</span>
        </span>
        {localExecutionAvailable ? (
          <select
            value={binding.executionTarget}
            onChange={(e) => onChange({ ...binding, executionTarget: e.target.value })}
            className="h-9 rounded-sb-sm bg-control px-2 text-sm text-ink"
          >
            <option value={SERVER_EXECUTION_TARGET}>Server (Stage-Server-Plugin)</option>
            {physicalDevices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        ) : (
          <span
            className="text-xs text-ink-faint"
            title="Kein installiertes Plugin kann diese Capability lokal auf einem Tablet ausführen"
          >
            Server (kein lokales Plugin installiert)
          </span>
        )}
      </label>
      {candidatePlugins.length > 1 && (
        <label className="flex items-center justify-between gap-3 pl-2 text-xs text-ink-faint">
          Plugin
          <select
            value={binding.pluginId ?? ''}
            onChange={(e) => onChange({ ...binding, pluginId: e.target.value || null })}
            className="h-8 rounded-sb-sm bg-control px-2 text-xs text-ink"
          >
            <option value="">Automatisch</option>
            {candidatePlugins.map((plugin) => (
              <option key={plugin.id} value={plugin.id}>
                {plugin.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}

function HardwareSetupList() {
  const setups = useHardwareSetupsStore((state) => state.setups)
  const saveSetup = useHardwareSetupsStore((state) => state.save)
  const removeSetup = useHardwareSetupsStore((state) => state.remove)
  const logicalDevices = useLogicalDevicesStore((state) => state.devices)
  const confirm = useDialogStore((state) => state.confirm)
  const [name, setName] = useState('')

  async function add() {
    const trimmed = name.trim()
    if (!trimmed) return
    await saveSetup({ id: randomId(), name: trimmed, bindings: {} })
    setName('')
  }

  return (
    <div className="flex flex-col gap-3">
      {setups.length === 0 && <p className="text-sm text-ink-faint">Noch keine Hardware-Setups.</p>}
      {setups.map((setup) => (
        <div key={setup.id} className="flex flex-col gap-2 rounded-sb border border-line bg-surface px-4 py-3 shadow-sb">
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold">{setup.name}</p>
            <button
              type="button"
              onClick={async () => {
                if (await confirm(`"${setup.name}" löschen?`, { confirmLabel: 'Löschen', danger: true })) {
                  void removeSetup(setup.id)
                }
              }}
              className="rounded-sb-sm bg-control px-3 py-1 text-xs text-ink-soft hover:bg-control-hover"
            >
              Entfernen
            </button>
          </div>

          {logicalDevices.length === 0 ? (
            <p className="text-xs text-ink-faint">Erst ein Logical Device anlegen, um es hier zu binden.</p>
          ) : (
            <div className="flex flex-col gap-2 border-t border-line pt-2">
              {logicalDevices.map((device) => (
                <BindingEditor
                  key={device.id}
                  logicalDevice={device}
                  binding={setup.bindings[device.id] ?? { executionTarget: SERVER_EXECUTION_TARGET, pluginId: null }}
                  onChange={(binding) =>
                    void saveSetup({
                      ...setup,
                      bindings: { ...setup.bindings, [device.id]: binding },
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="flex items-center gap-2 rounded-sb border border-dashed border-line px-4 py-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name, z.B. „Festival“ oder „Akustik Solo“"
          className="h-10 flex-1 rounded-sb-sm bg-control px-3 text-sm text-ink placeholder:text-ink-faint"
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={!name.trim()}
          className="h-10 rounded-sb-sm bg-control-strong px-3 text-sm font-medium text-accent hover:bg-control-strong-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          Hinzufügen
        </button>
      </div>
    </div>
  )
}

/** Which installed plugin actually handles `logicalDevice` under `binding` - the pinned choice
 * if the admin set one (#100), otherwise the first enabled plugin providing the capability,
 * same tie-break `pluginProviding` (capabilities.ts) already uses elsewhere. */
function resolveBindingPlugin(
  binding: HardwareBinding,
  logicalDevice: LogicalDevice,
  installed: PluginInstallation[],
): PluginInstallation | null {
  if (binding.pluginId) return installed.find((plugin) => plugin.id === binding.pluginId) ?? null
  return installed.find((plugin) => plugin.enabled && plugin.capabilities.includes(logicalDevice.capability)) ?? null
}

function TransportConfigForm({
  logicalDevice,
  plugin,
}: {
  logicalDevice: LogicalDevice
  plugin: PluginInstallation
}) {
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
 * tablet's: a browser can only enumerate what's physically attached to *it*, so editing
 * someone else's wiring from here would be meaningless. Only lists Logical Devices some
 * HardwareSetup currently binds to this device, whose resolved plugin actually declares
 * transports (`resolveBindingPlugin`) - nothing to configure otherwise.
 */
function DeviceTransportConfigSection() {
  const deviceId = getDeviceId()
  const setups = useHardwareSetupsStore((state) => state.setups)
  const logicalDevices = useLogicalDevicesStore((state) => state.devices)
  const installed = usePluginsStore((state) => state.installed)

  const entries: { logicalDevice: LogicalDevice; plugin: PluginInstallation }[] = []
  const seen = new Set<string>()
  for (const setup of setups) {
    for (const [logicalDeviceId, binding] of Object.entries(setup.bindings)) {
      if (binding.executionTarget !== deviceId || seen.has(logicalDeviceId)) continue
      const logicalDevice = logicalDevices.find((d) => d.id === logicalDeviceId)
      if (!logicalDevice) continue
      const plugin = resolveBindingPlugin(binding, logicalDevice, installed)
      if (!plugin || plugin.transports.length === 0) continue
      seen.add(logicalDeviceId)
      entries.push({ logicalDevice, plugin })
    }
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
 * The admin UI #10's issue asked for and every earlier slice deferred: create Logical Devices
 * (a named role like "Marcos Kemper", with one capability) and Hardware-Setup profiles (a named
 * rig configuration binding each Logical Device to an ExecutionTarget - the Stage-Server or a
 * registered tablet from the DeviceRegistry). Once at least one HardwareSetup exists here,
 * AppMenu.tsx's HardwareSetupPicker can actually pick something other than "Standard".
 *
 * "Dieses Gerät" (DeviceTransportConfigSection, #100) is deliberately its own, separately
 * scoped section below the band-wide setup list: which plugin executes a binding is a band-wide
 * choice (BindingEditor's plugin picker, remotely configurable), but the actual transport
 * wiring (MIDI port, USB device, IP) can only be set standing at the device itself.
 */
export function HardwareSetupManager() {
  return (
    <div className="h-dvh overflow-y-auto sb-app-bg p-4 text-ink">
      <h1 className="mb-1 text-2xl font-bold">Hardware-Setup</h1>
      <p className="mb-4 text-sm text-ink-muted">
        Logical Devices sind benannte Geräte-Rollen (z.B. „Marcos Kemper“). Hardware-Setups sind
        benannte, umschaltbare Zuordnungen: welches physische Gerät jede Rolle gerade übernimmt.
        Welches Setup gerade aktiv ist, wird im Menü unter „Geräte-Zuweisung“ gewählt.
      </p>

      <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-ink-muted">Logical Devices</h2>
      <div className="mb-6">
        <LogicalDeviceList />
      </div>

      <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-ink-muted">Hardware-Setups</h2>
      <div className="mb-6">
        <HardwareSetupList />
      </div>

      <DeviceTransportConfigSection />
    </div>
  )
}

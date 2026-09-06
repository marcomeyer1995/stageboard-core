import { useState } from 'react'
import { CAPABILITIES, SERVER_EXECUTION_TARGET, type CapabilityId, type LogicalDevice } from 'shared-types'
import { supportsLocalExecution } from '../lib/clientTranslator'
import { randomId } from '../lib/id'
import { useDevicesStore } from '../store/useDevicesStore'
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
  const [name, setName] = useState('')
  const [capability, setCapability] = useState<CapabilityId>(CAPABILITY_OPTIONS[0])

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
          {CAPABILITY_OPTIONS.map((option) => (
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

function ExecutionTargetSelect({
  logicalDevice,
  executionTarget,
  onChange,
}: {
  logicalDevice: LogicalDevice
  executionTarget: string
  onChange: (target: string) => void
}) {
  const physicalDevices = useDevicesStore((state) => state.devices)
  const installed = usePluginsStore((state) => state.installed)
  // #98: a tablet is only offered as a target when something can actually execute this
  // capability there (a real client-runtime plugin, or - audio-playback - native browser
  // playback) - otherwise the binding would silently promise routing nothing implements.
  const localExecutionAvailable = supportsLocalExecution(installed, logicalDevice.capability)

  return (
    <label className="flex items-center justify-between gap-3 text-sm text-ink-soft">
      <span>
        {logicalDevice.name} <span className="text-xs text-ink-faint">({logicalDevice.capability})</span>
      </span>
      {localExecutionAvailable ? (
        <select
          value={executionTarget}
          onChange={(e) => onChange(e.target.value)}
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
                <ExecutionTargetSelect
                  key={device.id}
                  logicalDevice={device}
                  executionTarget={setup.bindings[device.id]?.executionTarget ?? SERVER_EXECUTION_TARGET}
                  onChange={(target) =>
                    void saveSetup({
                      ...setup,
                      bindings: { ...setup.bindings, [device.id]: { executionTarget: target } },
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

/**
 * The admin UI #10's issue asked for and every earlier slice deferred: create Logical Devices
 * (a named role like "Marcos Kemper", with one capability) and Hardware-Setup profiles (a named
 * rig configuration binding each Logical Device to an ExecutionTarget - the Stage-Server or a
 * registered tablet from the DeviceRegistry). Once at least one HardwareSetup exists here,
 * AppMenu.tsx's HardwareSetupPicker can actually pick something other than "Standard".
 *
 * Deliberately no `pluginConfig` editor (HardwareBinding's open transport-config bag) - nothing
 * reads it yet, so there is nothing to configure.
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
      <HardwareSetupList />
    </div>
  )
}

import { useEffect, useState } from 'react'
import type { HardwareId, LogicalDevice, PluginInstallation } from 'shared-types'
import { SERVER_EXECUTION_TARGET } from 'shared-types'
import { getDeviceId } from '../lib/deviceId'
import { assignDiscoveryCandidate, startDiscovery, stopDiscovery } from '../lib/discoveryClient'
import { getTranslator, hasClientTranslator } from '../lib/clientTranslator'
import { randomId } from '../lib/id'
import { findLogicalDeviceUsage } from '../lib/logicalDeviceUsage'
import { PLUGIN_CATALOG } from '../lib/pluginCatalog'
import { listenToPortByHardwareKey } from '../lib/webMidi'
import { sendCcSequence } from '../lib/webMidiOutput'
import { useDevicesStore } from '../store/useDevicesStore'
import { useDeviceTransportConfigStore } from '../store/useDeviceTransportConfigStore'
import { useDiscoverySessionStore } from '../store/useDiscoverySessionStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { useSongsStore } from '../store/useSongsStore'

const TOTAL_STEPS = 4
const STEP_TITLE: Record<number, string> = { 1: 'Name', 2: 'Typ', 3: 'Verbindung', 4: 'Prüfen' }

interface Draft {
  id: string
  name: string
  capability: string | null
  pluginId: string | null
  executionTarget: string | null
}

function draftFrom(device: LogicalDevice | null): Draft {
  if (device) return { ...device }
  return { id: randomId(), name: '', capability: null, pluginId: null, executionTarget: null }
}

interface MidiEvent {
  cc: number
  value: number
  t: number
}

function FeedLine({ events }: { events: MidiEvent[] | undefined }) {
  if (!events || events.length === 0) return <span className="text-ink-faint/60 italic">wartet auf Daten…</span>
  return <span className="font-mono text-[11px] text-accent">{events.map((e) => `CC${e.cc}=${e.value}`).join(' · ')}</span>
}

/** Step 1 - name the device, with the existing roster shown for context (so a name that
 * collides with something a song already targets is an informed choice, not a surprise). */
function NameStep({ draft, onChange, onNext }: { draft: Draft; onChange: (draft: Draft) => void; onNext: () => void }) {
  const existing = useLogicalDevicesStore((state) => state.devices)
  const variants = useSongVariantsStore((state) => state.variants)
  const songs = useSongsStore((state) => state.songs)
  const installed = usePluginsStore((state) => state.installed)

  function pluginNameOf(pluginId: string | null): string {
    return (pluginId && installed.find((p) => p.id === pluginId)?.name) || pluginId || 'kein Typ'
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-ink-soft">
        Name
        <input
          type="text"
          autoFocus
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="z.B. „Marcos Kemper“"
          className="h-11 rounded-sb-sm bg-control px-3 text-sm text-ink placeholder:text-ink-faint"
        />
      </label>

      {existing.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-bold uppercase tracking-widest text-ink-faint">Bereits angelegt</p>
          {existing.map((device) => {
            const usage = findLogicalDeviceUsage(device.id, variants, songs)
            return (
              <div key={device.id} className="rounded-sb-sm bg-control px-3 py-2 text-xs text-ink-soft">
                <span className="font-medium">{device.name}</span> · {pluginNameOf(device.pluginId)}
                {usage.length > 0 && (
                  <span className="text-ink-faint"> · verwendet in: {usage.map((u) => u.songTitle).join(', ')}</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      <button
        type="button"
        onClick={onNext}
        disabled={!draft.name.trim()}
        className="h-11 self-end rounded-sb-sm bg-accent px-6 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        Weiter
      </button>
    </div>
  )
}

/** Step 2 - device type. Picking a catalog entry installs it (if not already) right here and
 * derives the device's capability from it - no separate trip to the Plugins tab needed. */
function TypeStep({
  draft,
  onChange,
  onNext,
  onBack,
}: {
  draft: Draft
  onChange: (draft: Draft) => void
  onNext: () => Promise<void>
  onBack: () => void
}) {
  const installed = usePluginsStore((state) => state.installed)
  const [saving, setSaving] = useState(false)

  async function next() {
    setSaving(true)
    await onNext()
    setSaving(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-ink-faint">Welche Art Gerät ist das?</p>
      <div className="flex flex-col gap-2">
        {PLUGIN_CATALOG.map((candidate) => {
          const alreadyInstalled = installed.some((p) => p.id === candidate.id)
          const selected = draft.pluginId === candidate.id
          return (
            <button
              key={candidate.id}
              type="button"
              onClick={() => onChange({ ...draft, pluginId: candidate.id, capability: candidate.capabilities[0] ?? null })}
              className={`flex items-center justify-between gap-3 rounded-sb-sm border px-3 py-3 text-left text-sm ${
                selected ? 'border-accent bg-control-strong text-ink' : 'border-transparent bg-control text-ink-soft hover:bg-control-hover'
              }`}
            >
              <span>
                {candidate.name}
                <span className="ml-2 text-xs text-ink-faint">{candidate.capabilities.join(', ')}</span>
              </span>
              {!alreadyInstalled && <span className="shrink-0 text-xs text-ink-faint">wird installiert</span>}
            </button>
          )
        })}
      </div>
      <div className="flex justify-between">
        <button type="button" onClick={onBack} className="h-11 rounded-sb-sm bg-control-strong px-4 text-sm text-ink-soft hover:bg-control-strong-hover">
          Zurück
        </button>
        <button
          type="button"
          onClick={() => void next()}
          disabled={!draft.pluginId || saving}
          className="h-11 rounded-sb-sm bg-accent px-6 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? 'Speichere…' : 'Weiter'}
        </button>
      </div>
    </div>
  )
}

/** Step 3 - connection. Auto-discovery reuses Discovery Mode's own bandwide session/broadcast
 * (started fresh for this step, stopped when the wizard closes), filtered down to candidates
 * matching this device's chosen plugin and labeled by which participant reported them - a
 * tablet, the Stage-Server, or this device itself. A resolved/manually-picked candidate whose
 * gateway is a *different* device still needs that device to self-write its own
 * DeviceTransportConfig (unchanged Discovery Mode behavior, useHardwareDetection.ts's
 * resolveDiscoveryWins already does this regardless of which UI started the session) - this step
 * just reflects that state rather than pretending it's instantly done. Manual override
 * (execution target + transport fields) stays available throughout, same shape
 * TransportConfigForm/BindingEditor already offered before this wizard replaced them.
 */
function ConnectionStep({
  draft,
  device,
  onNext,
  onBack,
}: {
  draft: Draft
  device: LogicalDevice | null
  onNext: () => void
  onBack: () => void
}) {
  const workspaceId = useDiscoverySessionStore((state) => state.workspaceId)
  const session = useDiscoverySessionStore((state) => state.session)
  const installed = usePluginsStore((state) => state.installed)
  const devices = useDevicesStore((state) => state.devices)
  const saveDevice = useLogicalDevicesStore((state) => state.save)
  const saveTransportConfig = useDeviceTransportConfigStore((state) => state.save)
  const [feeds, setFeeds] = useState<Record<string, MidiEvent[]>>({})
  const [sendingKey, setSendingKey] = useState<string | null>(null)
  const [assigningKey, setAssigningKey] = useState<string | null>(null)
  const [manualTarget, setManualTarget] = useState(device?.executionTarget ?? '')
  const [manualTransportId, setManualTransportId] = useState('')
  const [manualValues, setManualValues] = useState<Record<string, string>>({})

  const plugin = installed.find((p) => p.id === draft.pluginId) ?? null
  const candidates = session.candidates.filter((c) => c.matchedPluginId === draft.pluginId)
  const identifyingHere = session.identifying?.logicalDeviceId === draft.id ? session.identifying : null

  useEffect(() => {
    void startDiscovery(workspaceId, getDeviceId())
    return () => void stopDiscovery(workspaceId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    const stops: (() => void)[] = []
    for (const candidate of candidates) {
      if (!candidate.hardwareKey.startsWith('webmidi:') || candidate.reporterId !== getDeviceId()) continue
      void listenToPortByHardwareKey(candidate.hardwareKey, (data) => {
        if (cancelled) return
        const status = data[0] ?? 0
        if ((status & 0xf0) !== 0xb0) return
        const event: MidiEvent = { cc: data[1] ?? 0, value: data[2] ?? 0, t: Date.now() }
        setFeeds((prev) => ({ ...prev, [candidate.hardwareKey]: [...(prev[candidate.hardwareKey] ?? []).slice(-3), event] }))
      }).then((stop) => (stop && !cancelled ? stops.push(stop) : stop?.()))
    }
    return () => {
      cancelled = true
      stops.forEach((stop) => stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates.map((c) => c.hardwareKey).join(',')])

  function reporterLabel(reporterId: string): string {
    if (reporterId === getDeviceId()) return 'Dieses Gerät'
    if (reporterId === SERVER_EXECUTION_TARGET) return 'Stage-Server'
    return devices.find((d) => d.id === reporterId)?.name ?? reporterId
  }

  const namePattern = plugin?.hardwareIds.find(
    (id): id is Extract<HardwareId, { kind: 'webmidi' }> => id.kind === 'webmidi' && !!id.namePattern,
  )?.namePattern

  async function sendTrigger(hardwareKey: string) {
    if (!namePattern || !identifyingHere) return
    setSendingKey(hardwareKey)
    await sendCcSequence(namePattern, identifyingHere.matchCcSequence)
    setSendingKey(null)
  }

  async function claimCandidate(reporterId: string, hardwareKey: string) {
    setAssigningKey(hardwareKey)
    await assignDiscoveryCandidate(workspaceId, reporterId, hardwareKey, draft.id)
    setAssigningKey(null)
  }

  async function saveManual() {
    await saveDevice({ id: draft.id, name: draft.name, capability: draft.capability ?? 'midi-input', pluginId: draft.pluginId, executionTarget: manualTarget || null })
    if (manualTarget === getDeviceId() && manualTransportId) {
      await saveTransportConfig({
        id: `${getDeviceId()}:${draft.id}`,
        deviceId: getDeviceId(),
        logicalDeviceId: draft.id,
        transportId: manualTransportId,
        values: manualValues,
      })
    }
  }

  const transport = plugin?.transports.find((t) => t.id === manualTransportId)
  const resolvedTarget = device?.executionTarget ?? null

  return (
    <div className="flex flex-col gap-4">
      {resolvedTarget && (
        <p className="rounded-sb-sm bg-control-strong px-3 py-2 text-sm text-ink">
          Verbunden mit {reporterLabel(resolvedTarget)}
          {resolvedTarget !== getDeviceId() && (
            <span className="text-ink-faint"> · wartet darauf, dass sich dieses Gerät selbst einträgt</span>
          )}
        </p>
      )}

      {identifyingHere && (
        <div className="flex flex-col gap-2 rounded-sb-sm border border-accent/40 bg-control px-3 py-3">
          <p className="text-sm font-semibold text-ink">{identifyingHere.instruction}</p>
          {candidates
            .filter((c) => c.status === 'identifying')
            .map((c) => (
              <div key={`${c.reporterId}:${c.hardwareKey}`} className="flex items-center justify-between gap-2 rounded-sb-sm bg-control-strong px-2 py-2 text-xs">
                <div className="flex flex-col gap-0.5">
                  <span className="text-ink-soft">
                    {c.name || c.hardwareKey} <span className="text-ink-faint">via {reporterLabel(c.reporterId)}</span>
                  </span>
                  <FeedLine events={feeds[c.hardwareKey]} />
                </div>
                {namePattern && c.reporterId === getDeviceId() && (
                  <button
                    type="button"
                    onClick={() => void sendTrigger(c.hardwareKey)}
                    disabled={sendingKey === c.hardwareKey}
                    className="h-7 shrink-0 rounded-sb-sm bg-accent px-2 text-[11px] font-medium text-accent-ink hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60"
                  >
                    {sendingKey === c.hardwareKey ? 'sende…' : 'Jetzt senden'}
                  </button>
                )}
              </div>
            ))}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <p className="text-xs font-bold uppercase tracking-widest text-ink-faint">Automatisch erkannt</p>
        {candidates.length === 0 && <p className="text-xs text-ink-faint">Noch keine passenden Geräte erkannt…</p>}
        {candidates.map((c) => (
          <div key={`${c.reporterId}:${c.hardwareKey}`} className="flex items-center justify-between gap-2 rounded-sb-sm bg-control px-3 py-2 text-xs">
            <div className="flex flex-col gap-0.5">
              <span className="text-ink-soft">
                {c.name || c.hardwareKey} <span className="text-ink-faint">via {reporterLabel(c.reporterId)}</span>
              </span>
              {c.reporterId === getDeviceId() && <FeedLine events={feeds[c.hardwareKey]} />}
            </div>
            {c.assignedLogicalDeviceId === draft.id ? (
              <span className="shrink-0 text-ink-faint">{c.status}</span>
            ) : (
              <button
                type="button"
                onClick={() => void claimCandidate(c.reporterId, c.hardwareKey)}
                disabled={assigningKey === c.hardwareKey}
                className="h-7 shrink-0 rounded-sb-sm bg-accent px-2 text-[11px] font-medium text-accent-ink hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60"
              >
                {assigningKey === c.hardwareKey ? 'übernehme…' : 'Verwenden'}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-sb-sm border border-dashed border-line px-3 py-3">
        <p className="text-xs font-bold uppercase tracking-widest text-ink-faint">Manuell festlegen</p>
        <select
          value={manualTarget}
          onChange={(e) => setManualTarget(e.target.value)}
          className="h-10 rounded-sb-sm bg-control px-2 text-sm text-ink"
        >
          <option value="">— nicht festgelegt —</option>
          <option value={SERVER_EXECUTION_TARGET}>Server (Stage-Server-Plugin)</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {manualTarget === getDeviceId() && plugin && plugin.transports.length > 0 && (
          <>
            <select
              value={manualTransportId}
              onChange={(e) => {
                setManualTransportId(e.target.value)
                setManualValues({})
              }}
              className="h-10 rounded-sb-sm bg-control px-2 text-sm text-ink"
            >
              <option value="">Anschlussart wählen…</option>
              {plugin.transports.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            {transport && (
              <div className="flex flex-wrap gap-2">
                {transport.fields.map((field) => (
                  <label key={field.key} className="flex flex-col gap-1 text-xs text-ink-muted">
                    {field.label}
                    <input
                      type={field.type}
                      value={manualValues[field.key] ?? ''}
                      onChange={(e) => setManualValues({ ...manualValues, [field.key]: e.target.value })}
                      className="w-32 rounded-sb-sm bg-control-strong px-2 py-1 text-sm text-ink"
                    />
                  </label>
                ))}
              </div>
            )}
          </>
        )}
        <button
          type="button"
          onClick={() => void saveManual()}
          className="h-9 self-start rounded-sb-sm bg-control-strong px-4 text-xs font-medium text-accent hover:bg-control-strong-hover"
        >
          Speichern
        </button>
      </div>

      <div className="flex justify-between">
        <button type="button" onClick={onBack} className="h-11 rounded-sb-sm bg-control-strong px-4 text-sm text-ink-soft hover:bg-control-strong-hover">
          Zurück
        </button>
        <button type="button" onClick={onNext} className="h-11 rounded-sb-sm bg-accent px-6 text-sm font-semibold text-accent-ink hover:bg-accent-hover">
          {resolvedTarget ? 'Weiter' : 'Später verbinden'}
        </button>
      </div>
    </div>
  )
}

/** Step 4 - verify. Reuses the exact "Testen" action TransportConfigForm already had - only
 * meaningful on whichever device actually executes this role. */
function VerifyStep({ draft, device, onBack, onFinish }: { draft: Draft; device: LogicalDevice | null; onBack: () => void; onFinish: () => void }) {
  const installed = usePluginsStore((state) => state.installed)
  const [testResult, setTestResult] = useState<string | null>(null)
  const executionTarget = device?.executionTarget ?? null
  const canTestHere = executionTarget === getDeviceId() && draft.capability && hasClientTranslator(installed, draft.capability)

  async function runTest() {
    if (!draft.capability) return
    setTestResult('…')
    const result = await getTranslator(draft.capability)?.({ type: 'test', payload: {} })
    setTestResult(result ? `${result.status}${result.message ? `: ${result.message}` : ''}` : 'kein Translator')
  }

  return (
    <div className="flex flex-col gap-4">
      {canTestHere ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void runTest()}
            className="h-11 rounded-sb-sm bg-control-strong px-4 text-sm font-medium text-ink-soft hover:bg-control-strong-hover"
          >
            Testen
          </button>
          {testResult && <span className="text-sm text-ink-faint">{testResult}</span>}
        </div>
      ) : executionTarget ? (
        <p className="text-sm text-ink-faint">
          Wird auf {executionTarget === SERVER_EXECUTION_TARGET ? 'dem Stage-Server' : 'einem anderen Gerät'} ausgeführt - dort prüfen.
        </p>
      ) : (
        <p className="text-sm text-ink-faint">Noch keine Verbindung festgelegt - erst Schritt 3 abschließen, um hier zu testen.</p>
      )}

      <div className="flex justify-between">
        <button type="button" onClick={onBack} className="h-11 rounded-sb-sm bg-control-strong px-4 text-sm text-ink-soft hover:bg-control-strong-hover">
          Zurück
        </button>
        <button type="button" onClick={onFinish} className="h-11 rounded-sb-sm bg-accent px-6 text-sm font-semibold text-accent-ink hover:bg-accent-hover">
          Fertig
        </button>
      </div>
    </div>
  )
}

/**
 * Guided setup for one piece of hardware - name it, pick its type (installing the matching
 * plugin inline), connect it (Discovery Mode's auto-discovery, filtered to this device, plus a
 * manual fallback), verify it works. Replaces the old flat LogicalDeviceList/BindingEditor/
 * HardwareSetupList/standalone DiscoveryWizard with one step-by-step flow, mirroring Home
 * Assistant's "add integration" pattern (Marco, explicit request).
 *
 * `device: null` starts a blank draft at Step 1 - the "+ Neues Gerät" path. Passing an existing
 * `LogicalDevice` (the device list's "Einrichten") resumes editing it, prefilled at every step,
 * but starts further in since Name/Type are usually already settled and what someone reopening
 * an existing device almost always wants is the connection: Step 3 if a type/plugin is already
 * chosen, Step 2 if only the name exists yet. Every step still has its own "Zurück" wired to the
 * previous step number regardless of where the wizard started, so nothing is actually skipped -
 * only not shown first. Nothing is written until Step 2 (the first point a valid `capability`
 * exists) - abandoning the wizard before then leaves nothing behind; abandoning any later step
 * leaves exactly what was set, which is also how "skip - the gear isn't here yet, finish later"
 * works: there's no separate skip codepath, just an incomplete-but-real Logical Device the
 * Hardware tab flags accordingly.
 */
export function DeviceSetupWizard({ device, onClose }: { device: LogicalDevice | null; onClose: () => void }) {
  const [step, setStep] = useState(() => (device ? (device.pluginId ? 3 : 2) : 1))
  const [draft, setDraft] = useState<Draft>(() => draftFrom(device))
  const saveDevice = useLogicalDevicesStore((state) => state.save)
  const installPlugin = usePluginsStore((state) => state.install)
  const installed = usePluginsStore((state) => state.installed)
  // Reflects live saves (e.g. a Discovery win writing executionTarget) back into the wizard -
  // `device` itself never re-renders once passed in as a prop.
  const liveDevice = useLogicalDevicesStore((state) => state.devices.find((d) => d.id === draft.id) ?? null)

  async function advanceFromType() {
    const plugin = PLUGIN_CATALOG.find((p) => p.id === draft.pluginId)
    if (!plugin || !draft.capability) return
    if (!installed.some((p) => p.id === plugin.id)) {
      await installPlugin({ ...plugin, enabled: true, installedAt: Date.now() } as PluginInstallation)
    }
    await saveDevice({ id: draft.id, name: draft.name, capability: draft.capability, pluginId: draft.pluginId, executionTarget: draft.executionTarget })
    setStep(3)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-sb border border-line bg-surface shadow-sb">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-ink-muted">Gerät einrichten</h2>
            <p className="text-xs text-ink-faint">
              Schritt {step}/{TOTAL_STEPS} · {STEP_TITLE[step]}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-lg leading-none text-ink-faint hover:text-ink" aria-label="Fenster schließen">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {step === 1 && <NameStep draft={draft} onChange={setDraft} onNext={() => setStep(2)} />}
          {step === 2 && (
            <TypeStep draft={draft} onChange={setDraft} onBack={() => setStep(1)} onNext={advanceFromType} />
          )}
          {step === 3 && (
            <ConnectionStep draft={draft} device={liveDevice} onBack={() => setStep(2)} onNext={() => setStep(4)} />
          )}
          {step === 4 && <VerifyStep draft={draft} device={liveDevice} onBack={() => setStep(3)} onFinish={onClose} />}
        </div>
      </div>
    </div>
  )
}

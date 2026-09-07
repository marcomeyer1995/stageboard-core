import { useEffect, useState } from 'react'
import type { DiscoveryCandidate, HardwareId, PluginInstallation } from 'shared-types'
import { getDeviceId } from '../lib/deviceId'
import { startDiscovery, stopDiscovery } from '../lib/discoveryClient'
import { listenToPortByHardwareKey } from '../lib/webMidi'
import { sendCcSequence } from '../lib/webMidiOutput'
import { useDiscoverySessionStore } from '../store/useDiscoverySessionStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { usePluginsStore } from '../store/usePluginsStore'

const CANDIDATE_STATUS_LABEL: Record<string, string> = {
  unassigned: 'erkannt',
  identifying: 'wartet auf Trigger',
  assigned: 'zugewiesen',
  'needs-manual': 'manuell zuweisen',
}

interface MidiEvent {
  cc: number
  value: number
  t: number
}

/** Last few raw Control Change messages seen on each webmidi candidate's port, keyed by
 * hardwareKey - the wizard's "live incoming data" view. A plain component-local `useEffect`
 * managing one `listenToPortByHardwareKey` subscription per currently-listed webmidi candidate,
 * re-syncing whenever the candidate list's set of hardwareKeys changes (new device shows up,
 * one gets resolved and the list re-renders, etc.). Capped to the last 4 messages per port so a
 * chattering controller doesn't grow this forever. */
function useLiveMidiFeeds(candidates: DiscoveryCandidate[]): Record<string, MidiEvent[]> {
  const [feeds, setFeeds] = useState<Record<string, MidiEvent[]>>({})
  const hardwareKeys = candidates
    .map((c) => c.hardwareKey)
    .filter((key) => key.startsWith('webmidi:'))
    .join(',')

  useEffect(() => {
    let cancelled = false
    const stops: (() => void)[] = []

    for (const hardwareKey of hardwareKeys ? hardwareKeys.split(',') : []) {
      void listenToPortByHardwareKey(hardwareKey, (data) => {
        if (cancelled) return
        const status = data[0] ?? 0
        if ((status & 0xf0) !== 0xb0) return // only Control Change - what every discoveryTrigger uses
        const event: MidiEvent = { cc: data[1] ?? 0, value: data[2] ?? 0, t: Date.now() }
        setFeeds((prev) => ({ ...prev, [hardwareKey]: [...(prev[hardwareKey] ?? []).slice(-3), event] }))
      }).then((stop) => {
        if (stop && !cancelled) stops.push(stop)
        else if (stop) stop()
      })
    }

    return () => {
      cancelled = true
      stops.forEach((stop) => stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hardwareKeys])

  return feeds
}

function FeedLine({ events }: { events: MidiEvent[] | undefined }) {
  if (!events || events.length === 0) {
    return <span className="text-ink-faint/60 italic">wartet auf Daten…</span>
  }
  return (
    <span className="font-mono text-[11px] text-accent">
      {events.map((e) => `CC${e.cc}=${e.value}`).join(' · ')}
    </span>
  )
}

function pluginNameOf(installed: PluginInstallation[], pluginId: string | null): string {
  return (pluginId && installed.find((p) => p.id === pluginId)?.name) || pluginId || '—'
}

function logicalDeviceNameOf(devices: { id: string; name: string }[], logicalDeviceId: string | null): string {
  return (logicalDeviceId && devices.find((d) => d.id === logicalDeviceId)?.name) || logicalDeviceId || '—'
}

function StartStep({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <p className="max-w-sm text-sm text-ink-soft">
        Alle Geräte anschließen (Tablets oder Stage-Server), dann hier starten. Eindeutige Geräte werden automatisch
        zugewiesen; für den Rest wird ein Musiker gebeten, sein Gerät kurz zu bedienen.
      </p>
      <button
        type="button"
        onClick={onStart}
        className="h-11 rounded-sb-sm bg-accent px-6 text-sm font-semibold text-accent-ink hover:bg-accent-hover"
      >
        Geräte-Erkennung starten
      </button>
    </div>
  )
}

function IdentifyingPanel({
  installed,
  feeds,
}: {
  installed: PluginInstallation[]
  feeds: Record<string, MidiEvent[]>
}) {
  const identifying = useDiscoverySessionStore((state) => state.session.identifying)
  const candidates = useDiscoverySessionStore((state) => state.session.candidates)
  const [sendingKey, setSendingKey] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!identifying) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [identifying?.deadline])

  if (!identifying) return null
  const contenders = candidates.filter((c) => c.status === 'identifying' && c.matchedPluginId === identifying.pluginId)
  const secondsLeft = Math.max(0, Math.ceil((identifying.deadline - now) / 1000))
  const plugin = installed.find((p) => p.id === identifying.pluginId)
  const namePattern =
    plugin?.hardwareIds.find(
      (id): id is Extract<HardwareId, { kind: 'webmidi' }> => id.kind === 'webmidi' && !!id.namePattern,
    )?.namePattern ?? null

  async function sendTrigger(hardwareKey: string) {
    if (!namePattern || !identifying) return
    setSendingKey(hardwareKey)
    await sendCcSequence(namePattern, identifying.matchCcSequence)
    setSendingKey(null)
  }

  return (
    <div className="flex flex-col gap-2 rounded-sb-sm border border-accent/40 bg-control px-3 py-3">
      <p className="text-sm font-semibold text-ink">
        Rolle bestätigen: „{identifying.logicalDeviceName}"
        <span className="ml-2 text-xs font-normal text-ink-faint">{secondsLeft}s verbleibend</span>
      </p>
      <p className="text-xs text-ink-soft">{identifying.instruction}</p>
      <div className="flex flex-col gap-1">
        {contenders.map((candidate) => (
          <div
            key={`${candidate.reporterId}:${candidate.hardwareKey}`}
            className="flex items-center justify-between gap-2 rounded-sb-sm bg-control-strong px-2 py-2 text-xs"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-ink-soft">{candidate.name || candidate.hardwareKey}</span>
              <FeedLine events={feeds[candidate.hardwareKey]} />
            </div>
            {namePattern && (
              <button
                type="button"
                onClick={() => void sendTrigger(candidate.hardwareKey)}
                disabled={sendingKey === candidate.hardwareKey}
                className="h-7 shrink-0 rounded-sb-sm bg-accent px-2 text-[11px] font-medium text-accent-ink hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60"
                title="Sendet den Trigger direkt an dieses Gerät - zum Prüfen ohne das Gerät selbst anzufassen."
              >
                {sendingKey === candidate.hardwareKey ? 'sende…' : 'Jetzt senden'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function CandidateList({
  installed,
  logicalDevices,
  feeds,
}: {
  installed: PluginInstallation[]
  logicalDevices: { id: string; name: string }[]
  feeds: Record<string, MidiEvent[]>
}) {
  const candidates = useDiscoverySessionStore((state) => state.session.candidates)

  if (candidates.length === 0) {
    return <p className="text-xs text-ink-faint">Noch keine Geräte erkannt…</p>
  }

  return (
    <div className="flex flex-col gap-1">
      {candidates.map((candidate) => (
        <div
          key={`${candidate.reporterId}:${candidate.hardwareKey}`}
          className="flex items-center justify-between gap-2 rounded-sb-sm bg-control px-3 py-2 text-xs"
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-ink-soft">
              {candidate.name || candidate.hardwareKey}{' '}
              <span className="text-ink-faint">via {pluginNameOf(installed, candidate.matchedPluginId)}</span>
              {candidate.assignedLogicalDeviceId && (
                <span className="text-ink-faint"> → {logicalDeviceNameOf(logicalDevices, candidate.assignedLogicalDeviceId)}</span>
              )}
            </span>
            <FeedLine events={feeds[candidate.hardwareKey]} />
          </div>
          <span className="shrink-0 text-ink-faint">{CANDIDATE_STATUS_LABEL[candidate.status] ?? candidate.status}</span>
        </div>
      ))}
    </div>
  )
}

function DiscoveryWizardModal({ onClose }: { onClose: () => void }) {
  const workspaceId = useDiscoverySessionStore((state) => state.workspaceId)
  const active = useDiscoverySessionStore((state) => state.session.active)
  const candidates = useDiscoverySessionStore((state) => state.session.candidates)
  const installed = usePluginsStore((state) => state.installed)
  const logicalDevices = useLogicalDevicesStore((state) => state.devices)
  const feeds = useLiveMidiFeeds(candidates)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-sb border border-line bg-surface shadow-sb">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-widest text-ink-muted">Geräte-Erkennung</h2>
          <button type="button" onClick={onClose} className="text-lg leading-none text-ink-faint hover:text-ink" aria-label="Fenster schließen">
            ×
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          {!active ? (
            <StartStep onStart={() => void startDiscovery(workspaceId, getDeviceId())} />
          ) : (
            <>
              <IdentifyingPanel installed={installed} feeds={feeds} />
              <CandidateList installed={installed} logicalDevices={logicalDevices} feeds={feeds} />
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          {active && (
            <button
              type="button"
              onClick={() => void stopDiscovery(workspaceId)}
              className="h-9 rounded-sb-sm bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-500"
            >
              Stoppen
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-sb-sm bg-control-strong px-4 text-sm font-medium text-ink-soft hover:bg-control-strong-hover"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Bandwide, admin-initiated hardware detection - the alternative to #106's passive per-tablet
 * "New Device" prompt (still the fallback when nobody's running this). Replaces the old inline
 * Start/Stop-button-plus-list (DiscoverySection) with a step-by-step popup: a plain "start" step
 * while nothing's running, then a live view of what's happening as candidates arrive and roles
 * resolve - including, per role currently awaiting a physical trigger, each contending device's
 * own live raw MIDI feed and a "Jetzt senden" button that fires the trigger sequence for real
 * (webMidiOutput.ts's `sendCcSequence`), so a bandleader can verify the whole path end-to-end
 * without needing another musician physically present to touch their gear.
 */
export function DiscoveryWizard() {
  const [open, setOpen] = useState(false)
  const active = useDiscoverySessionStore((state) => state.session.active)

  return (
    <div className="mb-6 flex items-center justify-between gap-3 rounded-sb border border-line bg-surface p-4 shadow-sb">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-widest text-ink-muted">Geräte-Erkennung</h2>
        <p className="text-xs text-ink-faint">
          Alle anschließen, dann hier starten - eindeutige Geräte werden automatisch zugewiesen, für den Rest wird
          ein Musiker gebeten, sein Gerät kurz zu bedienen.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-10 shrink-0 rounded-sb-sm bg-accent px-4 text-sm font-medium text-accent-ink hover:bg-accent-hover"
      >
        {active ? 'Öffnen' : 'Starten'}
      </button>
      {open && <DiscoveryWizardModal onClose={() => setOpen(false)} />}
    </div>
  )
}

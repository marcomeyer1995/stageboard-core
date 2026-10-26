import { useState } from 'react'
import { CAPABILITIES, PLAYBACK_CUE_TARGET, type LogicalDevice } from 'shared-types'
import { describeCue, commandsFor } from '../lib/deviceCommands'
import { getServerTime } from '../lib/clockSync'
import { ROUTE_LABEL } from '../lib/latencyProfiles'
import { cancelRigCheck, latestRun, openRun, prepareRigCheck, runIsPlayable, runReports, startRigCheck, type RigCheckDeviceReport, type RigCheckRun, type StartResult } from '../lib/rigCheck'
import { runAnalysisCheck, type AnalysisCheck } from '../lib/rigCheckAnalysis'
import { buildRigCheckSong, type RigCheckDeviceCue, type RigCheckKind } from '../lib/rigCheckSong'
import { useNow } from '../lib/useNow'
import { useBandSettingsStore } from '../store/useBandSettingsStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useShowLogStore } from '../store/useShowLogStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { RigCheckAnalysis } from './RigCheckAnalysis'
import { Group, Page } from './SystemSettings'
import { CueDialog } from './timeline/CueDialog'
import { Badge, Button, Section, Segmented } from './ui'

const KIND_OPTIONS: { value: RigCheckKind; label: string }[] = [
  { value: 'quick', label: 'Kurzcheck' },
  { value: 'full', label: 'Voller Lauf' },
]

const START_MESSAGE: Record<Exclude<StartResult, 'started'>, string> = {
  'not-master': 'Nur der Master startet den Rig-Check.',
  'no-run': 'Erst vorbereiten.',
  busy: 'Gerade läuft ein Song - erst stoppen.',
  'not-ready': 'Song oder Track sind auf diesem Gerät noch nicht angekommen - einen Moment.',
}

/** "1:05" for a duration in ms. */
function formatLength(ms: number): string {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** One device's line in the live list and in the result. */
export function RigCheckDeviceRow({ report, showVerdict }: { report: RigCheckDeviceReport; showVerdict: boolean }) {
  const route = ROUTE_LABEL[report.audioRoute as keyof typeof ROUTE_LABEL] ?? report.audioRoute
  return (
    <li className="flex flex-col gap-1 border-b border-line py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-base font-semibold text-ink">{report.deviceName}</span>
        {report.mode === 'practice' && <Badge tone="warning">Solo Üben - folgt nicht</Badge>}
        <Badge tone={report.trackReady ? 'neutral' : 'warning'}>{report.trackReady ? 'Track da' : 'Track lädt …'}</Badge>
        {showVerdict && report.verdict === 'ok' && <Badge tone="accent">OK</Badge>}
        {showVerdict && report.verdict === 'problem' && <Badge tone="danger">Problem</Badge>}
        {showVerdict && report.verdict === null && <Badge>kein Urteil</Badge>}
      </div>
      <p className="text-sm text-ink-soft">
        Uhr {report.clockOffsetMs === null ? 'noch nicht abgeglichen' : `${report.clockOffsetMs > 0 ? '+' : ''}${report.clockOffsetMs} ms zum Server${report.clockJitterMs !== null ? ` (± ${report.clockJitterMs} ms)` : ''}`}
        {' · '}
        {route}
        {report.outputLatencyMs !== null ? `, Latenz ${report.outputLatencyMs} ms` : ', Latenz nicht gemessen'}
      </p>
      {showVerdict && report.note && <p className="text-sm text-ink">„{report.note}“</p>}
    </li>
  )
}

/** The devices with ready-made commands - the same ones the action picker offers. */
function commandDevicesOf(devices: readonly LogicalDevice[]): LogicalDevice[] {
  return devices.filter((d) => d.id !== PLAYBACK_CUE_TARGET && d.capability !== CAPABILITIES.midiController && d.capability !== CAPABILITIES.clickTrack && commandsFor(d.capability).length > 0)
}

/** Geräte-Cues (docs/24 §3): one command per device, band-wide; admins change them. */
function DeviceCues({ editable }: { editable: boolean }) {
  const settings = useBandSettingsStore((state) => state.settings)
  const save = useBandSettingsStore((state) => state.save)
  const devices = commandDevicesOf(useLogicalDevicesStore((state) => state.devices))
  const [editing, setEditing] = useState<LogicalDevice | null>(null)
  const cues = settings.rigCheckCues ?? []
  const setCue = (deviceId: string, cue: RigCheckDeviceCue | null) =>
    void save({ ...settings, rigCheckCues: [...cues.filter((c) => c.targetLogicalDeviceId !== deviceId), ...(cue ? [cue] : [])] })

  if (devices.length === 0)
    return <p className="text-sm text-ink-faint">Kein Gerät mit fertigen Befehlen eingerichtet (Bühnentechnik). Der Rig-Check prüft dann Klick, Track, Bildschirme und Sprung.</p>
  return (
    <>
      <ul className="flex flex-col">
        {devices.map((device) => {
          const cue = cues.find((c) => c.targetLogicalDeviceId === device.id)
          return (
            <li key={device.id} className="flex flex-wrap items-center gap-2 border-b border-line py-2 last:border-b-0">
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold text-ink">{device.name}</span>
                <span className={`block text-sm ${cue ? 'text-ink-soft' : 'text-ink-faint'}`}>{cue ? describeCue(cue, device.capability) : 'nichts - bleibt unberührt'}</span>
              </span>
              {editable && (
                <>
                  <Button onClick={() => setEditing(device)}>{cue ? 'Ändern' : 'Wählen'}</Button>
                  {cue && <Button onClick={() => setCue(device.id, null)}>Entfernen</Button>}
                </>
              )}
            </li>
          )
        })}
      </ul>
      {editing && (
        <CueDialog
          title={`Rig-Check: ${editing.name}`}
          devices={[editing]}
          withPlayback={false}
          initial={cues.find((c) => c.targetLogicalDeviceId === editing.id)}
          onSubmit={(content) => {
            setCue(editing.id, { targetLogicalDeviceId: editing.id, type: content.type, payload: content.payload ?? {} })
            setEditing(null)
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </>
  )
}

/** "Analyse prüfen" (docs/24 §6): the timeline's analysis on the full run's track, on this device -
 * no devices, no playing. A completed full run stores the same in the Nachbericht. */
function AnalysisGroup() {
  const events = useShowLogStore((state) => state.events)
  const [check, setCheck] = useState<AnalysisCheck | null>(null)
  const [state, setState] = useState<'idle' | 'running' | 'failed'>('idle')
  const stored = [...events].reverse().find((e): e is RigCheckRun => e.type === 'rig-check-run' && !!e.analysis)?.analysis ?? null
  const shown = check ?? stored
  const run = async () => {
    setState('running')
    try {
      setCheck(await runAnalysisCheck('full'))
      setState('idle')
    } catch (err) {
      console.error('Rig-Check: analysis check failed', err)
      setState('failed')
    }
  }
  return (
    <Group
      title="Analyse-Prüfung"
      info="Lässt die Analyse des Timeline-Editors („Track analysieren“) auf den Test-Song des vollen Laufs los und vergleicht mit dem, was die App weiß: liegt das Klick-Raster je Abschnitt auf dem Schlagzeug, und zählt es die Takte richtig? Läuft nur auf diesem Gerät, ohne Ton."
    >
      <Button disabled={state === 'running'} onClick={() => void run()}>
        {state === 'running' ? 'Prüft …' : 'Analyse prüfen'}
      </Button>
      {state === 'failed' && <p className="text-sm text-danger">Die Prüfung ist fehlgeschlagen.</p>}
      {shown && <RigCheckAnalysis check={shown} />}
    </Group>
  )
}

function runState(run: RigCheckRun | null, open: RigCheckRun | null): 'none' | 'prepared' | 'running' | 'ended' {
  if (open) return open.startedAt === undefined ? 'prepared' : 'running'
  return run && run.startedAt !== undefined && run.endedAt !== undefined ? 'ended' : 'none'
}

/**
 * System → Rig-Check (#464, docs/24 §3): choose the run, the device cues, prepare, watch every
 * device get ready, start - and the last run's result.
 */
export function RigCheckView() {
  const events = useShowLogStore((state) => state.events)
  const isMaster = useShowStateStore((state) => state.isMaster)
  const playbackStatus = useShowStateStore((state) => state.state.playbackStatus)
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const isAdmin = useWorkspaceStore((state) => state.workspaces.find((w) => w.id === activeWorkspaceId)?.isAdmin ?? false)
  // Not `?? []` inside the selector: a fresh array every call re-renders forever.
  const storedCues = useBandSettingsStore((state) => state.settings.rigCheckCues)
  // Re-renders as the docs arrive, so "Start" enables once everything is here.
  useSongVariantsStore((state) => state.variants)
  useSetlistsStore((state) => state.setlists)
  useNow()
  const [kind, setKind] = useState<RigCheckKind>('quick')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const now = getServerTime()
  const last = latestRun(events)
  const open = openRun(events, now)
  const state = runState(last, open)
  const shown = open ?? (state === 'ended' ? last : null)
  const reports = shown ? runReports(events, shown.showId) : []
  const lengthMs = buildRigCheckSong(kind).durationMs

  const prepare = async () => {
    setBusy(true)
    setMessage('Track wird erzeugt und hochgeladen …')
    const result = await prepareRigCheck(kind, storedCues ?? [])
    setBusy(false)
    setMessage(result.ok ? null : `Vorbereiten fehlgeschlagen: ${result.message}`)
  }
  const start = async () => {
    setBusy(true)
    const result = await startRigCheck()
    setBusy(false)
    setMessage(result === 'started' ? null : START_MESSAGE[result])
  }

  return (
    <Page
      title="Rig-Check"
      info="Ein Test-Song, dessen Timing die App genau kennt. Der Master spielt ihn wie im Gig, alle anderen Geräte folgen. Klick und Beeps sollen zu einem Ton verschmelzen, die Prompter-Zeilen auf dem Schlag wechseln, die Geräte im Takt reagieren. Am Ende fragt jedes Gerät „Alles in Ordnung?“, das Ergebnis steht im Nachbericht."
    >
      <Group title="Lauf" info="Kurzcheck bei jedem Soundcheck; den vollen Lauf nach einem neuen Aufbau - mit Tempowechseln, Dreiviertel, Pause und Wiedereinstieg.">
        <Segmented label="Lauf" value={open?.kind ?? kind} onChange={setKind} options={KIND_OPTIONS.map((o) => ({ ...o, disabled: state === 'prepared' || state === 'running' }))} />
        <p className="text-sm text-ink-soft">
          {kind === 'quick' ? `Einzählen, 8 Takte 120, ein Sprung, 4 Takte 140 - Track ${formatLength(lengthMs)}.` : `Alle Abschnitte des Test-Songs - Track ${formatLength(lengthMs)}.`}
        </p>
        <Section title="Geräte-Cues" info="Was jedes Gerät im Rig-Check bekommt - ein Befehl, gesendet in Takt 5 (Kurzcheck) bzw. an vier Stellen (voller Lauf). Gilt für die ganze Band, nur Admins ändern es. Neu gewählt wirkt es beim nächsten Vorbereiten.">
          <DeviceCues editable={isAdmin} />
        </Section>
      </Group>

      <Group title="Ablauf" info="Vorbereiten erzeugt den Track (nur beim ersten Mal oder nach einem Update) und lädt ihn auf den Stage-Server; die anderen Geräte laden ihn dann. Start schaltet den Master auf den Test-Song und drückt Play; danach kommt die vorige Setliste zurück.">
        {!isMaster && <p className="text-base text-ink-soft">Nur der Master bereitet vor und startet. Dieses Gerät folgt im Gig-Modus.</p>}
        {isMaster && state !== 'prepared' && state !== 'running' && (
          <Button variant="primary" disabled={busy} onClick={() => void prepare()}>
            Vorbereiten
          </Button>
        )}
        {state === 'prepared' && open && (
          <div className="flex flex-wrap gap-2">
            {isMaster && (
              <Button variant="primary" disabled={busy || playbackStatus !== 'stopped' || !runIsPlayable(open)} onClick={() => void start()}>
                Start
              </Button>
            )}
            {isMaster && <Button onClick={() => void cancelRigCheck()}>Abbrechen</Button>}
          </div>
        )}
        {state === 'running' && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">Läuft</Badge>
            {isMaster && <Button onClick={() => void cancelRigCheck()}>Abbrechen</Button>}
          </div>
        )}
        {isMaster && state === 'prepared' && playbackStatus !== 'stopped' && <p className="text-sm text-warn">Gerade läuft ein Song - erst stoppen.</p>}
        {message && <p className="text-sm text-ink-soft">{message}</p>}
      </Group>

      <AnalysisGroup />

      {shown && (
        <Group
          title={state === 'ended' ? (shown.cancelled ? 'Letzter Lauf (abgebrochen)' : 'Letzter Lauf') : 'Geräte'}
          info="Jedes Gerät meldet sich selbst: ob es den Track hat, wie weit seine Uhr vom Stage-Server weg ist, worüber es spielt und welche Latenz dafür gespeichert ist. Fehlt ein Gerät, ist die App dort nicht offen oder nicht in dieser Band."
        >
          {reports.length === 0 ? (
            <p className="text-sm text-ink-faint">Noch kein Gerät gemeldet.</p>
          ) : (
            <ul className="flex flex-col">
              {reports.map((report) => (
                <RigCheckDeviceRow key={report.id} report={report} showVerdict={state === 'ended'} />
              ))}
            </ul>
          )}
        </Group>
      )}
    </Page>
  )
}

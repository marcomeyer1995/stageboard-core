import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { AudioRouteSchema, CAPABILITIES, PLAYBACK_CUE_TARGET, type LogicalDevice } from 'shared-types'
import { describeCue, commandsFor } from '../lib/deviceCommands'
import { getServerTime } from '../lib/clockSync'
import { routeLabel } from '../lib/latencyProfiles'
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
import { RigCheckInputs } from './RigCheckInputs'
import { CueDialog } from './timeline/CueDialog'
import { Badge, Button, Section, Segmented } from './ui'

const KINDS: RigCheckKind[] = ['quick', 'full']

const startMessage = (t: TFunction<'rigcheck'>, result: Exclude<StartResult, 'started'>): string =>
  ({ 'not-master': t('flow.notMasterStart'), 'no-run': t('flow.noRun'), busy: t('flow.songPlaying'), 'not-ready': t('flow.notReady') })[result]

/** "1:05" for a duration in ms. */
function formatLength(ms: number): string {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** One device's line in the live list and in the result. */
export function RigCheckDeviceRow({ report, showVerdict }: { report: RigCheckDeviceReport; showVerdict: boolean }) {
  const { t } = useTranslation('rigcheck')
  const parsedRoute = AudioRouteSchema.safeParse(report.audioRoute)
  const route = parsedRoute.success ? routeLabel(parsedRoute.data) : report.audioRoute
  return (
    <li className="flex flex-col gap-1 border-b border-line py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-base font-semibold text-ink">{report.deviceName}</span>
        {report.mode === 'practice' && <Badge tone="warning">{t('devices.practice')}</Badge>}
        <Badge tone={report.trackReady ? 'neutral' : 'warning'}>{report.trackReady ? t('devices.trackReady') : t('devices.trackLoading')}</Badge>
        {showVerdict && report.verdict === 'ok' && <Badge tone="accent">{t('devices.ok')}</Badge>}
        {showVerdict && report.verdict === 'problem' && <Badge tone="danger">{t('devices.problem')}</Badge>}
        {showVerdict && report.verdict === null && <Badge>{t('devices.noVerdict')}</Badge>}
      </div>
      <p className="text-sm text-ink-soft">
        {report.clockOffsetMs === null
          ? t('devices.clockNotSynced')
          : `${t('devices.clock', { offset: `${report.clockOffsetMs > 0 ? '+' : ''}${report.clockOffsetMs}` })}${report.clockJitterMs !== null ? ` ${t('devices.jitter', { jitter: report.clockJitterMs })}` : ''}`}
        {' · '}
        {route}
        {`, ${report.outputLatencyMs !== null ? t('devices.latency', { ms: report.outputLatencyMs }) : t('devices.latencyNone')}`}
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
  const { t } = useTranslation('rigcheck')
  const settings = useBandSettingsStore((state) => state.settings)
  const save = useBandSettingsStore((state) => state.save)
  const devices = commandDevicesOf(useLogicalDevicesStore((state) => state.devices))
  const [editing, setEditing] = useState<LogicalDevice | null>(null)
  const cues = settings.rigCheckCues ?? []
  const setCue = (deviceId: string, cue: RigCheckDeviceCue | null) =>
    void save({ ...settings, rigCheckCues: [...cues.filter((c) => c.targetLogicalDeviceId !== deviceId), ...(cue ? [cue] : [])] })

  if (devices.length === 0)
    return <p className="text-sm text-ink-faint">{t('cues.none')}</p>
  return (
    <>
      <ul className="flex flex-col">
        {devices.map((device) => {
          const cue = cues.find((c) => c.targetLogicalDeviceId === device.id)
          return (
            <li key={device.id} className="flex flex-wrap items-center gap-2 border-b border-line py-2 last:border-b-0">
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold text-ink">{device.name}</span>
                <span className={`block text-sm ${cue ? 'text-ink-soft' : 'text-ink-faint'}`}>{cue ? describeCue(cue, device.capability) : t('cues.nothing')}</span>
              </span>
              {editable && (
                <>
                  <Button onClick={() => setEditing(device)}>{cue ? t('cues.change') : t('cues.choose')}</Button>
                  {cue && <Button onClick={() => setCue(device.id, null)}>{t('cues.remove')}</Button>}
                </>
              )}
            </li>
          )
        })}
      </ul>
      {editing && (
        <CueDialog
          title={t('cues.dialogTitle', { device: editing.name })}
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
  const { t } = useTranslation('rigcheck')
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
      title={t('analysis.title')}
      info={t('analysis.info')}
    >
      <Button disabled={state === 'running'} onClick={() => void run()}>
        {state === 'running' ? t('analysis.running') : t('analysis.run')}
      </Button>
      {state === 'failed' && <p className="text-sm text-danger">{t('analysis.failed')}</p>}
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
  const { t } = useTranslation('rigcheck')
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
    setMessage(t('flow.preparing'))
    const result = await prepareRigCheck(kind, storedCues ?? [])
    setBusy(false)
    setMessage(result.ok ? null : t('flow.prepareFailed', { message: result.message }))
  }
  const start = async () => {
    setBusy(true)
    const result = await startRigCheck()
    setBusy(false)
    setMessage(result === 'started' ? null : startMessage(t, result))
  }

  return (
    <Page
      title={t('title')}
      info={t('info')}
    >
      <Group title={t('kind.label')} info={t('kind.info')}>
        <Segmented label={t('kind.label')} value={open?.kind ?? kind} onChange={setKind} options={KINDS.map((value) => ({ value, label: t(`kind.${value}`), disabled: state === 'prepared' || state === 'running' }))} />
        <p className="text-sm text-ink-soft">
          {t(kind === 'quick' ? 'kind.quickText' : 'kind.fullText', { length: formatLength(lengthMs) })}
        </p>
        <Section title={t('cues.title')} info={t('cues.info')}>
          <DeviceCues editable={isAdmin} />
        </Section>
      </Group>

      <RigCheckInputs />

      <Group title={t('flow.title')} info={t('flow.info')}>
        {!isMaster && <p className="text-base text-ink-soft">{t('flow.notMaster')}</p>}
        {isMaster && state !== 'prepared' && state !== 'running' && (
          <Button variant="primary" disabled={busy} onClick={() => void prepare()}>
            {t('flow.prepare')}
          </Button>
        )}
        {state === 'prepared' && open && (
          <div className="flex gap-2">
            {isMaster && (
              <Button variant="primary" className="flex-1" disabled={busy || playbackStatus !== 'stopped' || !runIsPlayable(open)} onClick={() => void start()}>
                {t('flow.start')}
              </Button>
            )}
            {isMaster && <Button onClick={() => void cancelRigCheck()}>{t('flow.cancel')}</Button>}
          </div>
        )}
        {state === 'running' && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">{t('flow.running')}</Badge>
            {isMaster && <Button onClick={() => void cancelRigCheck()}>{t('flow.cancel')}</Button>}
          </div>
        )}
        {isMaster && state === 'prepared' && playbackStatus !== 'stopped' && <p className="text-sm text-warn">{t('flow.songPlaying')}</p>}
        {message && <p className="text-sm text-ink-soft">{message}</p>}
      </Group>

      <AnalysisGroup />

      {shown && (
        <Group
          title={state === 'ended' ? (shown.cancelled ? t('devices.lastCancelled') : t('devices.last')) : t('devices.title')}
          info={t('devices.info')}
        >
          {reports.length === 0 ? (
            <p className="text-sm text-ink-faint">{t('devices.none')}</p>
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

import { useEffect, useRef } from 'react'
import { AUDIO_OUTPUT, type Setlist, type ShowLogEvent, type ShowState, type Song, type TrackMeta } from 'shared-types'
import { cacheKey } from './audioCache'
import { getAudioStorageBackend } from './audioStorageBackend'
import { clickTimeline } from './beatGrid'
import { getServerTime } from './clockSync'
import { getDeviceId } from './deviceId'
import { findLatencyProfile } from './latencyProfiles'
import { rememberedDeviceName } from './ownDeviceName'
import { ARMED_TRANSPORT, computeActiveMs, transportOf } from './playbackTransport'
import { playSong, stopSong, transportPatch } from './queue'
import { JUMP_NOTICE_MS, queueSectionJump } from './sectionJump'
import { putSetlist } from './setlistsDb'
import { showSections } from './showSections'
import { deleteTrackFile } from './audioClient'
import { putTrack, putVariant } from './songVariantsDb'
import { runAnalysisCheck } from './rigCheckAnalysis'
import {
  buildRigCheckSong,
  encodeWav,
  RIG_CHECK_SETLIST_ID,
  RIG_CHECK_SONG_ID,
  RIG_CHECK_TRACK_ID,
  RIG_CHECK_VERSION,
  rigCheckCues,
  rigCheckVariant,
  rigCheckVariantId,
  synthesizeRigCheckTrack,
  type RigCheckDeviceCue,
  type RigCheckKind,
} from './rigCheckSong'
import { useAppModeStore } from '../store/useAppModeStore'
import { useAudioRouteStore } from '../store/useAudioRouteStore'
import { useClockSyncStore } from '../store/useClockSyncStore'
import { useDevicesStore } from '../store/useDevicesStore'
import { useLatencyProfilesStore } from '../store/useLatencyProfilesStore'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useShowLogStore } from '../store/useShowLogStore'
import { drivesAutomation, useShowStateStore } from '../store/useShowStateStore'
import { useSongsStore } from '../store/useSongsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'

/**
 * The Rig-Check run (#464, docs/24 §3/§5): the master prepares the hidden test song, starts it like
 * a Gig song, jumps over the skipped section and restores the show afterwards; every device reports
 * its own state and, at the end, the band's eye-and-ear verdict. Everything is in the show log, so
 * every device sees the same run and the Nachbericht shows it.
 */

export type RigCheckRun = Extract<ShowLogEvent, { type: 'rig-check-run' }>
export type RigCheckDeviceReport = Extract<ShowLogEvent, { type: 'rig-check-device' }>

/** A prepared run nobody started closes by itself after this long. */
export const RUN_OPEN_MS = 30 * 60_000
/** How long after the end every device still asks "Alles in Ordnung?". */
export const VERDICT_MS = 15 * 60_000
/** A started run whose song is stopped for this long has ended (Play and the start are one step). */
const END_GRACE_MS = 3000

const isRun = (e: ShowLogEvent): e is RigCheckRun => e.type === 'rig-check-run'
const isDeviceReport = (e: ShowLogEvent): e is RigCheckDeviceReport => e.type === 'rig-check-device'

/** The most recently prepared run, open or not. */
export function latestRun(events: readonly ShowLogEvent[]): RigCheckRun | null {
  let latest: RigCheckRun | null = null
  for (const e of events) if (isRun(e) && (!latest || e.at > latest.at)) latest = e
  return latest
}

/** The run in progress: prepared or playing, not ended, not left lying around. */
export function openRun(events: readonly ShowLogEvent[], now: number): RigCheckRun | null {
  const run = latestRun(events)
  if (!run || run.endedAt !== undefined) return null
  if (run.startedAt === undefined && now - run.at > RUN_OPEN_MS) return null
  return run
}

/** A run that played and ended a moment ago - the one the verdict question is about. */
export function verdictRun(events: readonly ShowLogEvent[], now: number): RigCheckRun | null {
  const run = latestRun(events)
  if (!run || run.startedAt === undefined || run.endedAt === undefined) return null
  return now - run.endedAt <= VERDICT_MS ? run : null
}

/** Every device's report for a run, by name. */
export function runReports(events: readonly ShowLogEvent[], runId: string): RigCheckDeviceReport[] {
  return events.filter((e): e is RigCheckDeviceReport => isDeviceReport(e) && e.showId === runId).sort((a, b) => a.deviceName.localeCompare(b.deviceName))
}

/** The run a show belongs to - a Rig-Check show in the Nachbericht. */
export function runOfShow(events: readonly ShowLogEvent[], showId: string): RigCheckRun | null {
  return events.find((e): e is RigCheckRun => isRun(e) && e.showId === showId) ?? null
}

const runDocId = (runId: string) => `rig-check-run-${runId}`
export const deviceReportId = (runId: string, deviceId: string) => `rig-check-device-${runId}-${deviceId}`

function randomRunId(): string {
  return `rig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function saveRun(run: RigCheckRun): Promise<void> {
  await useShowLogStore.getState().append(run)
}

export type PrepareResult = { ok: true } | { ok: false; message: string }

/**
 * Writes the hidden song, the run's variant (with the generated track - uploaded only when the
 * variant doesn't carry this generator version's track yet) and the one-entry setlist, then opens
 * the run so every device starts loading the track and reporting. Master only.
 */
export async function prepareRigCheck(kind: RigCheckKind, deviceCues: readonly RigCheckDeviceCue[]): Promise<PrepareResult> {
  if (!useShowStateStore.getState().isMaster) return { ok: false, message: 'Nur der Master bereitet den Rig-Check vor.' }
  const song = buildRigCheckSong(kind)
  const variantId = rigCheckVariantId(kind)
  try {
    const songDoc: Song = {
      id: RIG_CHECK_SONG_ID,
      title: 'Rig-Check',
      bpm: song.bpm,
      timeSignature: song.timeSignature,
      clickTrackEnabled: true,
      chordProContent: song.chordPro,
      timecodes: [],
    }
    await useSongsStore.getState().saveSong(songDoc)

    const existing = useSongVariantsStore.getState().variants.find((v) => v.id === variantId)
    const current = existing?.tracks.find((t) => t.id === RIG_CHECK_TRACK_ID)
    const cues = rigCheckCues(song, deviceCues)
    // Older generator versions' tracks go - their beats no longer match the ground truth.
    for (const old of existing?.tracks ?? []) if (old.id !== RIG_CHECK_TRACK_ID) await deleteTrackFile(variantId, old.id)
    await putVariant(rigCheckVariant(song, cues, current ? [current] : []))
    if (!current) {
      const wav = new Blob([encodeWav(synthesizeRigCheckTrack(song))], { type: 'audio/wav' })
      const meta: TrackMeta = {
        id: RIG_CHECK_TRACK_ID,
        kind: 'band-mix',
        label: `Rig-Check v${RIG_CHECK_VERSION}`,
        source: 'upload',
        parentTrackId: null,
        mimeType: 'audio/wav',
        addedAt: Date.now(),
        durationMs: song.durationMs,
      }
      await putTrack(variantId, meta, wav)
    }

    const setlist: Setlist = {
      id: RIG_CHECK_SETLIST_ID,
      name: 'Rig-Check',
      entries: [{ id: `rig-check-entry-${kind}`, songId: RIG_CHECK_SONG_ID, variantId, trackId: null }],
      createdAt: 0,
    }
    await putSetlist(setlist)

    const runId = randomRunId()
    await saveRun({ id: runDocId(runId), showId: runId, type: 'rig-check-run', at: Math.round(getServerTime()), kind, version: RIG_CHECK_VERSION })
    return { ok: true }
  } catch (err) {
    console.error('Rig-Check: preparing failed', err)
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export type StartResult = 'started' | 'not-master' | 'no-run' | 'busy' | 'not-ready'

/** Whether the run's song, variant, track and setlist have all arrived on this device. */
export function runIsPlayable(run: RigCheckRun): boolean {
  const variant = useSongVariantsStore.getState().variants.find((v) => v.id === rigCheckVariantId(run.kind))
  const setlist = useSetlistsStore.getState().setlists.find((s) => s.id === RIG_CHECK_SETLIST_ID)
  const song = useSongsStore.getState().songs.find((s) => s.id === RIG_CHECK_SONG_ID)
  const entry = setlist?.entries[0]
  return !!song && !!variant?.tracks.some((t) => t.id === RIG_CHECK_TRACK_ID) && !!entry && 'songId' in entry && entry.variantId === variant.id
}

/** What the show was on, for the way back. */
function previousOf(state: ShowState): NonNullable<RigCheckRun['previous']> {
  return { activeSetlistId: state.activeSetlistId, activeEntryId: state.activeEntryId, currentShowId: state.currentShowId, lastActivityAt: state.lastActivityAt }
}

/**
 * Starts the prepared run like a Gig song - its own show, count-in, the master plays. Refused while
 * a song plays or is paused: the Rig-Check never cuts into a show.
 */
export async function startRigCheck(): Promise<StartResult> {
  const store = useShowStateStore.getState()
  if (!store.isMaster) return 'not-master'
  const now = getServerTime()
  const run = openRun(useShowLogStore.getState().events, now)
  if (!run || run.startedAt !== undefined) return 'no-run'
  if (store.state.playbackStatus !== 'stopped') return 'busy'
  if (!runIsPlayable(run)) return 'not-ready'
  const at = Math.round(now)
  await saveRun({ ...run, startedAt: at, previous: previousOf(store.state) })
  await useShowLogStore.getState().append({ id: `show-started-${run.showId}`, showId: run.showId, type: 'show-started', at })
  await store.applyPatch({
    activeSetlistId: RIG_CHECK_SETLIST_ID,
    activeEntryId: `rig-check-entry-${run.kind}`,
    activeEntryStartedAt: null,
    ...transportPatch(ARMED_TRANSPORT),
    trackOverride: null,
    liveTempoAdjustPercent: 0,
    clickTrackOverride: null,
    clickExtendMs: 0,
    playbackLoop: null,
    currentShowId: run.showId,
    lastActivityAt: now,
  })
  await playSong()
  return 'started'
}

/** Abbrechen: a prepared run closes; a playing one stops - the driver then restores the show. */
export async function cancelRigCheck(): Promise<void> {
  const run = openRun(useShowLogStore.getState().events, getServerTime())
  if (!run || !useShowStateStore.getState().isMaster) return
  if (run.startedAt === undefined) {
    await saveRun({ ...run, endedAt: Math.round(getServerTime()), cancelled: true })
    return
  }
  if (useShowStateStore.getState().state.activeSetlistId === RIG_CHECK_SETLIST_ID) await stopSong()
}

/** Ends a started run: marks it (cancelled unless the track ran to its end) and puts the show back. */
async function finishRun(run: RigCheckRun, state: ShowState): Promise<void> {
  const completed = state.activeSetlistId === RIG_CHECK_SETLIST_ID && state.trackEnded === true
  await saveRun({ ...run, endedAt: Math.round(getServerTime()), ...(completed ? {} : { cancelled: true }) })
  if (completed && run.kind === 'full') void attachAnalysis(run.showId)
  // Somebody already switched to a real setlist or song - leave that alone.
  if (state.activeSetlistId !== RIG_CHECK_SETLIST_ID) return
  const previous = run.previous
  await useShowStateStore.getState().applyPatch({
    activeSetlistId: previous?.activeSetlistId ?? null,
    activeEntryId: previous?.activeEntryId ?? null,
    activeEntryStartedAt: null,
    ...transportPatch(ARMED_TRANSPORT),
    playbackLoop: null,
    currentShowId: previous?.currentShowId ?? null,
    lastActivityAt: previous?.lastActivityAt ?? null,
  })
}

/** A completed full run gets the analysis check (docs/24 §6), computed in a worker on the device
 * that ran it and stored with the run - the Nachbericht shows it beside the devices. */
async function attachAnalysis(runId: string): Promise<void> {
  if (typeof Worker === 'undefined') return
  try {
    const analysis = await runAnalysisCheck('full')
    const run = useShowLogStore.getState().events.find((e): e is RigCheckRun => isRun(e) && e.showId === runId)
    if (run) await saveRun({ ...run, analysis })
  } catch (err) {
    console.error('Rig-Check: analysis check failed', err)
  }
}

/** The variant's sections and the jump target, from the generated song (the ground truth). */
function jumpPlan(run: RigCheckRun) {
  const song = buildRigCheckSong(run.kind)
  const timeline = clickTimeline({ beatGrid: song.grid, bpm: song.bpm, timeSignature: song.timeSignature, countInBars: 1 })
  const sections = showSections(song.chordPro, timeline, song.durationMs)
  const from = sections.find((s) => s.label === song.jump.from)
  const to = sections.find((s) => s.label === song.jump.to)
  return from && to ? { timeline, sections, from, to } : null
}

/** How often the driver looks at the run. */
const DRIVER_TICK_MS = 250

/**
 * On the device that drives the automatic steps: queues the jump over the skipped section once the
 * song is a bar into the section before it, and ends the run when the song stopped - then the show
 * goes back to what it was on. Mounted once in App.tsx.
 */
export function useRigCheckDriver(): void {
  const jumpedFor = useRef<string | null>(null)
  const finishing = useRef<string | null>(null)
  useEffect(() => {
    const tick = () => {
      const store = useShowStateStore.getState()
      if (!drivesAutomation(store)) return
      const now = getServerTime()
      const run = openRun(useShowLogStore.getState().events, now)
      if (!run || run.startedAt === undefined) return
      const state = store.state
      const onRigCheck = state.activeSetlistId === RIG_CHECK_SETLIST_ID
      if (onRigCheck && state.playbackStatus === 'playing' && !state.playbackJump && jumpedFor.current !== run.showId) {
        const plan = jumpPlan(run)
        const elapsed = computeActiveMs(transportOf(state), now)
        // A bar into the section, and still early enough for the notice every device needs.
        const barMs = plan ? plan.timeline.periodAfter(plan.timeline.beatAtOrBefore(plan.from.startMs)) * 4 : 0
        if (plan && plan.from.endMs !== null && elapsed >= plan.from.startMs + barMs && elapsed < plan.from.endMs - JUMP_NOTICE_MS - 200) {
          jumpedFor.current = run.showId
          void queueSectionJump(plan.to, 'section', plan.sections, plan.timeline).then((result) => {
            if (result !== 'queued') console.warn('Rig-Check: jump not queued', result)
          })
        }
      }
      const stoppedLongEnough = state.playbackStatus === 'stopped' && now - run.startedAt > END_GRACE_MS
      if ((!onRigCheck || stoppedLongEnough) && finishing.current !== run.showId) {
        finishing.current = run.showId
        void finishRun(run, state)
      }
    }
    const id = setInterval(tick, DRIVER_TICK_MS)
    return () => clearInterval(id)
  }, [])
}

/** This device's own state for a run - everything but the verdict. */
export interface OwnRigCheckState {
  deviceName: string
  mode: 'gig' | 'practice'
  trackReady: boolean
  clockOffsetMs: number | null
  clockJitterMs: number | null
  audioRoute: string
  outputLatencyMs: number | null
}

function ownState(trackReady: boolean): OwnRigCheckState {
  const deviceId = getDeviceId()
  const clock = useClockSyncStore.getState()
  const route = useAudioRouteStore.getState().route
  const profile = findLatencyProfile(useLatencyProfilesStore.getState().profiles, deviceId, AUDIO_OUTPUT, route)
  return {
    deviceName: useDevicesStore.getState().devices.find((d) => d.id === deviceId)?.name ?? rememberedDeviceName() ?? 'Dieses Gerät',
    mode: useAppModeStore.getState().mode,
    trackReady,
    clockOffsetMs: clock.lastSyncedAt === null ? null : Math.round(clock.offsetMs),
    clockJitterMs: clock.jitterMs === null ? null : Math.round(clock.jitterMs * 10) / 10,
    audioRoute: route,
    outputLatencyMs: profile ? profile.latencyMs : null,
  }
}

/** Writes this device's report - its state now, keeping a verdict already given. */
export async function writeOwnReport(run: RigCheckRun, trackReady: boolean, verdict?: { verdict: 'ok' | 'problem'; note?: string }): Promise<void> {
  const deviceId = getDeviceId()
  const id = deviceReportId(run.showId, deviceId)
  const before = useShowLogStore.getState().events.find((e): e is RigCheckDeviceReport => e.id === id && isDeviceReport(e))
  const note = verdict ? verdict.note?.trim().slice(0, 300) : before?.note
  await useShowLogStore.getState().append({
    id,
    showId: run.showId,
    type: 'rig-check-device',
    at: Math.round(getServerTime()),
    deviceId,
    ...ownState(trackReady),
    verdict: verdict?.verdict ?? before?.verdict ?? null,
    ...(note ? { note } : {}),
  })
}

/** Whether this device has the run's track in its own cache. */
export async function hasRunTrack(run: RigCheckRun): Promise<boolean> {
  const keys = await getAudioStorageBackend().listKeys()
  return keys.includes(cacheKey(rigCheckVariantId(run.kind), RIG_CHECK_TRACK_ID))
}

/** How often a device looks at its own state while a run is open. */
const REPORT_TICK_MS = 2000

/**
 * Every device, while a run is open: writes its report whenever its state changes (the track
 * arrived, the clock moved, Solo Üben ↔ Gig …) - not on every tick, so the log stays small. The
 * audio reconciler keeps the run's track (useAudioSyncReconciler.ts), so it arrives on its own.
 */
export function useRigCheckReporter(): void {
  const lastWritten = useRef<string | null>(null)
  useEffect(() => {
    let busy = false
    const tick = async () => {
      if (busy) return
      const run = openRun(useShowLogStore.getState().events, getServerTime())
      if (!run) return
      busy = true
      try {
        const ready = await hasRunTrack(run)
        const state = ownState(ready)
        // Clock values move a little all the time - only a change of 5 ms or more is news.
        const key = JSON.stringify({ run: run.showId, ...state, clockOffsetMs: state.clockOffsetMs === null ? null : Math.round(state.clockOffsetMs / 5), clockJitterMs: null })
        if (key !== lastWritten.current) {
          lastWritten.current = key
          await writeOwnReport(run, ready)
        }
      } catch (err) {
        console.error('Rig-Check: report failed', err)
      } finally {
        busy = false
      }
    }
    const id = setInterval(() => void tick(), REPORT_TICK_MS)
    return () => clearInterval(id)
  }, [])
}

/** The cache key the audio reconciler must keep (and fetch) while a run is open, or null. */
export function useRigCheckTrackKey(): string | null {
  return useShowLogStore((state) => {
    const run = openRun(state.events, getServerTime())
    return run ? cacheKey(rigCheckVariantId(run.kind), RIG_CHECK_TRACK_ID) : null
  })
}

/** "Rig-Check · Kurz" for a Rig-Check show in the Nachbericht, null for a real show. */
export function rigCheckLabel(showEvents: readonly ShowLogEvent[]): string | null {
  const run = showEvents.find(isRun)
  if (!run) return null
  return `Rig-Check · ${run.kind === 'quick' ? 'Kurz' : 'Voll'}${run.cancelled ? ' (abgebrochen)' : ''}`
}

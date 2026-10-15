import { useEffect, useState } from 'react'
import { CAPABILITIES, isYoutubeUrl, type AsyncJob, type StemModel, type TrackKind, type TrackMeta } from 'shared-types'
import { measureAudioDurationMs } from '../lib/measureAudioDuration'
import { randomId } from '../lib/id'
import { pluginProviding } from '../lib/capabilities'
import { putAsyncJob, removeAsyncJob } from '../lib/asyncJobsDb'
import { getTrack, putTrack, removeTrack, renameTrack } from '../lib/songVariantsDb'
import { playableTracks, stemsOf } from '../lib/stems'
import { useAsyncJobsStore } from '../store/useAsyncJobsStore'
import { useDialogStore } from '../store/useDialogStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { StemSeparationDialog } from './StemSeparationDialog'
import { INPUT, INPUT_FREE } from './ui/styles'
import { Button } from './ui'

const JOB_LABELS: Record<AsyncJob['type'], string> = { 'youtube-extract': 'YouTube-Extraktion', 'stem-separation': 'Spuren trennen' }

interface TrackManagerFieldProps {
  variantId: string
  tracks: TrackMeta[]
  /** True when the variant hasn't been saved yet - there's no document to attach anything to. */
  disabled: boolean
}

const KIND_LABELS: Record<TrackKind, string> = {
  reference: 'Referenz',
  'band-mix': 'Band-Playback',
  stem: 'Stem',
}

/** Attach/remove any number of named tracks (reference/band-mix/stem) on a song variant - and,
 * with the stem-separation plugin installed (#9), split one into stems on the Stage-Server. */
export function TrackManagerField({ variantId, tracks, disabled }: TrackManagerFieldProps) {
  const [busyTrackId, setBusyTrackId] = useState<string | null>(null)
  const [uploadKind, setUploadKind] = useState<TrackKind>('band-mix')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [youtubeError, setYoutubeError] = useState<string | null>(null)
  // Only this variant's jobs, oldest first - so a stray leftover from another song's editing
  // session never shows here, and multiple queued extractions (rare, but possible) list in the
  // order they were started.
  const variantJobs = useAsyncJobsStore((state) => state.jobs)
    .filter((job) => job.variantId === variantId)
    .sort((a, b) => a.createdAt - b.createdAt)
  const installed = usePluginsStore((state) => state.installed)
  const canSeparate = pluginProviding(installed, CAPABILITIES.stemSeparation) !== null
  const promptFields = useDialogStore((state) => state.promptFields)
  const [separating, setSeparating] = useState<TrackMeta | null>(null)
  // The stem being listened to, as a local object URL (fetched from the Stage-Server on demand).
  const [listening, setListening] = useState<{ trackId: string; url: string } | null>(null)
  useEffect(
    () => () => {
      if (listening) URL.revokeObjectURL(listening.url)
    },
    [listening],
  )

  async function listen(track: TrackMeta) {
    if (listening?.trackId === track.id) {
      setListening(null)
      return
    }
    setBusyTrackId(track.id)
    const blob = await getTrack(variantId, track.id)
    setBusyTrackId(null)
    if (blob) setListening({ trackId: track.id, url: URL.createObjectURL(blob) })
  }

  async function rename(track: TrackMeta) {
    const result = await promptFields('Spur umbenennen', [{ key: 'label', label: 'Name', defaultValue: track.label }], 'Übernehmen')
    if (result?.label?.trim()) await renameTrack(variantId, track.id, result.label)
  }

  /** Queues a #9 stem-separation job - picked up by the Stage-Server like the YouTube one. */
  async function startSeparation(track: TrackMeta, options: { model: StemModel; splitGuitar: boolean }) {
    setSeparating(null)
    await putAsyncJob({
      id: randomId(),
      type: 'stem-separation',
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      variantId,
      sourceTrackId: track.id,
      ...options,
    })
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const id = randomId()
    setBusyTrackId(id)
    const durationMs = await measureAudioDurationMs(file)
    await putTrack(
      variantId,
      {
        id,
        kind: uploadKind,
        label: KIND_LABELS[uploadKind],
        source: 'upload',
        parentTrackId: null,
        mimeType: file.type,
        addedAt: Date.now(),
        ...(durationMs !== null && { durationMs }),
      },
      file,
    )
    setBusyTrackId(null)
  }

  async function handleRemove(trackId: string) {
    setBusyTrackId(trackId)
    await removeTrack(variantId, trackId)
    setBusyTrackId(null)
  }

  /** Queues a #5 YouTube-extraction job - the Stage-Server (`asyncJobWatcher.ts`) picks it up
   * over the same replication every other cross-device command in this app uses (installing a
   * plugin, opening a hardware setup), so nothing here talks to the server directly. */
  async function handleYoutubeSubmit(e: React.FormEvent) {
    e.preventDefault()
    const url = youtubeUrl.trim()
    if (!isYoutubeUrl(url)) {
      setYoutubeError('Bitte einen youtube.com- oder youtu.be-Link einfügen.')
      return
    }
    setYoutubeError(null)
    await putAsyncJob({
      id: randomId(),
      type: 'youtube-extract',
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      variantId,
      url,
      label: 'YouTube Referenz',
    })
    setYoutubeUrl('')
  }

  return (
    <div className="flex flex-col gap-1 text-sm text-ink-muted">
      Tracks
      {/* Capped height, not open-ended - same reasoning as CueListEditor.tsx, applied
          consistently even though this list is usually short (Marco: every dynamically-sized
          list should get this, not just the ones that obviously need it today). */}
      <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {tracks.length === 0 && <span className="text-xs text-ink-faint">Keine Tracks</span>}
        {playableTracks(tracks).map((track) => (
          <div key={track.id} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink-faint">
                {KIND_LABELS[track.kind]}: {track.label}
              </span>
              {canSeparate && (
                <Button onClick={() => setSeparating(track)} disabled={disabled}>
                  Spuren trennen
                </Button>
              )}
              <Button onClick={() => handleRemove(track.id)} disabled={disabled || busyTrackId === track.id}>
                Entfernen
              </Button>
            </div>
            {stemsOf(tracks, track.id).map((stem) => (
              <div key={stem.id} className="ml-4 flex flex-col gap-1 border-l-2 border-line pl-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-ink">{stem.label}</span>
                  <Button variant={listening?.trackId === stem.id ? 'primary' : 'secondary'} aria-pressed={listening?.trackId === stem.id} onClick={() => void listen(stem)} disabled={busyTrackId === stem.id}>
                    Anhören
                  </Button>
                  <Button onClick={() => void rename(stem)} disabled={disabled}>
                    Umbenennen
                  </Button>
                  <Button onClick={() => handleRemove(stem.id)} disabled={disabled || busyTrackId === stem.id}>
                    Entfernen
                  </Button>
                </div>
                {listening?.trackId === stem.id && <audio controls autoPlay src={listening.url} className="w-full" />}
              </div>
            ))}
          </div>
        ))}
      </div>
      {variantJobs.length > 0 && (
        <div className="flex flex-col gap-1">
          {variantJobs.map((job) => (
            <div key={job.id} className="flex items-center gap-2 text-xs">
              {job.status === 'error' ? (
                <span className="text-danger">
                  {JOB_LABELS[job.type]} fehlgeschlagen: {job.error}
                </span>
              ) : job.status === 'done' ? (
                <span className="text-ink-faint">{JOB_LABELS[job.type]} abgeschlossen</span>
              ) : (
                <span className="text-ink-faint">
                  {JOB_LABELS[job.type]} {job.status === 'running' ? `${Math.round(job.progress * 100)} %` : 'wartet…'}
                </span>
              )}
              {(job.status === 'error' || job.status === 'done') && (
                <Button onClick={() => void removeAsyncJob(job.id)}>
                  Ausblenden
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <form onSubmit={handleYoutubeSubmit} className="flex items-center gap-2">
        <input
          type="url"
          value={youtubeUrl}
          onChange={(e) => setYoutubeUrl(e.target.value)}
          placeholder="YouTube-Link für eine Referenzaufnahme"
          disabled={disabled}
          className={`min-w-0 flex-1 min-w-0 px-2 py-1 text-base placeholder:text-ink-faint ${INPUT_FREE}`}
        />
        <Button type="submit" disabled={disabled || youtubeUrl.trim() === ''}>
          Von YouTube laden
        </Button>
      </form>
      {youtubeError && <span className="text-xs text-danger">{youtubeError}</span>}
      <div className="flex items-center gap-2">
        <select
          className={`min-h-form px-3 text-base ${INPUT}`}
          value={uploadKind}
          onChange={(e) => setUploadKind(e.target.value as TrackKind)}
          disabled={disabled}
        >
          {(Object.keys(KIND_LABELS) as TrackKind[]).map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </option>
          ))}
        </select>
        <label
          className={`rounded-control bg-control-strong px-2 py-1 text-xs text-ink [@media(hover:hover)]:hover:bg-control-strong-hover ${
            disabled || busyTrackId !== null ? 'pointer-events-none opacity-40' : 'cursor-pointer'
          }`}
        >
          Hochladen
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            disabled={disabled || busyTrackId !== null}
            onChange={handleFile}
          />
        </label>
      </div>
      {disabled && <span className="text-xs text-ink-faint">Erst speichern, dann Tracks anhängen.</span>}
      {separating && (
        <StemSeparationDialog
          trackLabel={separating.label}
          hasStems={stemsOf(tracks, separating.id).length > 0}
          onStart={(options) => void startSeparation(separating, options)}
          onClose={() => setSeparating(null)}
        />
      )}
    </div>
  )
}

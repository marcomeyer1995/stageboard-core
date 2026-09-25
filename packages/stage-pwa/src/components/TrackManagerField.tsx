import { useState } from 'react'
import { isYoutubeUrl, type TrackKind, type TrackMeta } from 'shared-types'
import { measureAudioDurationMs } from '../lib/measureAudioDuration'
import { randomId } from '../lib/id'
import { putAsyncJob, removeAsyncJob } from '../lib/asyncJobsDb'
import { putTrack, removeTrack } from '../lib/songVariantsDb'
import { useAsyncJobsStore } from '../store/useAsyncJobsStore'

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

/** Attach/remove any number of named tracks (reference/band-mix/stem) on a song variant. */
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
      {/* Capped height, not open-ended - same reasoning as BeatAnchorListEditor.tsx, applied
          consistently even though this list is usually short (Marco: every dynamically-sized
          list should get this, not just the ones that obviously need it today). */}
      <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {tracks.length === 0 && <span className="text-xs text-ink-faint">Keine Tracks</span>}
        {tracks.map((track) => (
          <div key={track.id} className="flex items-center gap-2">
            <span className="text-xs text-ink-faint">
              {KIND_LABELS[track.kind]}: {track.label}
            </span>
            <button
              type="button"
              onClick={() => handleRemove(track.id)}
              disabled={disabled || busyTrackId === track.id}
              className="rounded-sb-sm bg-control-strong px-2 py-0.5 text-xs text-ink hover:bg-control-strong-hover disabled:opacity-40"
            >
              Entfernen
            </button>
          </div>
        ))}
      </div>
      {variantJobs.length > 0 && (
        <div className="flex flex-col gap-1">
          {variantJobs.map((job) => (
            <div key={job.id} className="flex items-center gap-2 text-xs">
              {job.status === 'error' ? (
                <span className="text-red-500">YouTube-Extraktion fehlgeschlagen: {job.error}</span>
              ) : job.status === 'done' ? (
                <span className="text-ink-faint">YouTube-Extraktion abgeschlossen</span>
              ) : (
                <span className="text-ink-faint">
                  YouTube-Extraktion {job.status === 'running' ? `${Math.round(job.progress * 100)} %` : 'wartet…'}
                </span>
              )}
              {(job.status === 'error' || job.status === 'done') && (
                <button
                  type="button"
                  onClick={() => void removeAsyncJob(job.id)}
                  className="rounded-sb-sm bg-control-strong px-2 py-0.5 text-ink hover:bg-control-strong-hover"
                >
                  Ausblenden
                </button>
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
          className="min-w-0 flex-1 rounded-sb-sm bg-control px-2 py-1 text-xs text-ink placeholder:text-ink-faint"
        />
        <button
          type="submit"
          disabled={disabled || youtubeUrl.trim() === ''}
          className="rounded-sb-sm bg-control-strong px-2 py-1 text-xs text-ink hover:bg-control-strong-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          Von YouTube laden
        </button>
      </form>
      {youtubeError && <span className="text-xs text-red-500">{youtubeError}</span>}
      <div className="flex items-center gap-2">
        <select
          className="rounded-sb-sm bg-control px-2 py-1 text-xs text-ink"
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
          className={`rounded-sb-sm bg-control-strong px-2 py-1 text-xs text-ink hover:bg-control-strong-hover ${
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
    </div>
  )
}

import { useState } from 'react'
import type { TrackKind, TrackMeta } from 'shared-types'
import { putTrack, removeTrack } from '../lib/songVariantsDb'
import { randomId } from '../lib/id'

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

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const id = randomId()
    setBusyTrackId(id)
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

  return (
    <div className="flex flex-col gap-1 text-sm text-ink-muted">
      Tracks
      <div className="flex flex-col gap-1">
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

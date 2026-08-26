import { useEffect, useRef, useState } from 'react'
import { ensureDefaultVariant, getTrack } from '../lib/songVariantsDb'
import { useClockStore } from '../store/useClockStore'
import { useSongsStore } from '../store/useSongsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

/**
 * Home-rehearsal backing-track playback (docs/08 Phase 2, "Individuelles Üben"): plays a
 * track from the song's default variant straight out of the tablet/PC's own
 * speakers/headphones, no Stage-Server or audio interface involved. Mirrors playback
 * position into the Master-Clock so Prompter's Section Highlighting and page-turns track
 * the real audio instead of a manually-run stopwatch.
 *
 * Picks its own song independently of useQueue()/ShowState: practicing alone has no "active
 * song" the way a live show does, and defaulting to whatever the live queue happens to be
 * pointed at meant the widget silently showed a different song than the one you just
 * attached a track to.
 */
export function BackingTrackPlayerWidget() {
  const songs = useSongsStore((state) => state.songs)
  const variants = useSongVariantsStore((state) => state.variants)
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null)
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null)
  const song = songs.find((s) => s.id === selectedSongId) ?? songs[0] ?? null
  const variant = variants.find((v) => v.songId === song?.id && v.isDefault) ?? null
  const track = variant?.tracks.find((t) => t.id === selectedTrackId) ?? variant?.tracks[0] ?? null

  const audioRef = useRef<HTMLAudioElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const clockStart = useClockStore((state) => state.start)
  const clockStop = useClockStore((state) => state.stop)
  const clockSeek = useClockStore((state) => state.seek)

  useEffect(() => {
    // Lazily creates the default variant for a song that predates Phase 1's data model - a
    // musician practicing alone may never have opened this song in the editor.
    if (!song) return
    const existing = variants.find((v) => v.songId === song.id && v.isDefault)
    if (existing) return
    void ensureDefaultVariant(song)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id])

  useEffect(() => {
    setSrc(null)
    setIsPlaying(false)
    setPosition(0)
    if (!variant || !track) return

    let cancelled = false
    let objectUrl: string | null = null
    getTrack(variant.id, track.id).then((blob) => {
      if (cancelled || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setSrc(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // Only the ids matter here - re-running on every variant/track object reference change
    // would tear down and re-fetch the attachment on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant?.id, track?.id])

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    // play() returns a promise that rejects with AbortError if pause() interrupts it before
    // it resolves (e.g. a quick double-tap, or switching songs mid-play) - expected, not a bug.
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Number(e.target.value)
  }

  if (!song) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint">
        Keine Songs vorhanden
      </div>
    )
  }

  if (!variant) {
    return <div className="flex h-full items-center justify-center text-ink-faint">Lädt…</div>
  }

  return (
    <div className="flex h-full flex-col justify-center gap-2 text-ink-soft">
      <select
        className="rounded-sb-sm bg-control px-2 py-1 text-sm text-ink"
        value={song.id}
        onChange={(e) => {
          setSelectedSongId(e.target.value)
          setSelectedTrackId(null)
        }}
      >
        {songs.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title || '(ohne Titel)'}
          </option>
        ))}
      </select>

      {variant.tracks.length > 1 && (
        <select
          className="rounded-sb-sm bg-control px-2 py-1 text-xs text-ink"
          value={track?.id ?? ''}
          onChange={(e) => setSelectedTrackId(e.target.value)}
        >
          {variant.tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      )}

      {!track && (
        <div className="flex flex-1 items-center justify-center text-xs text-ink-faint">
          Kein Track angehängt
        </div>
      )}

      {track && (
        <>
          <audio
            ref={audioRef}
            src={src ?? undefined}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onPlay={() => {
              setIsPlaying(true)
              clockStart()
            }}
            onPause={() => {
              setIsPlaying(false)
              clockStop()
            }}
            onEnded={() => {
              setIsPlaying(false)
              clockStop()
            }}
            onTimeUpdate={(e) => {
              setPosition(e.currentTarget.currentTime)
              clockSeek(e.currentTarget.currentTime * 1000)
            }}
            onSeeked={(e) => clockSeek(e.currentTarget.currentTime * 1000)}
          />
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={togglePlay}
              className="rounded-sb-sm bg-control-strong px-3 py-1 text-sm font-medium text-ink hover:bg-control-strong-hover"
            >
              {isPlaying ? 'Pause' : 'Play'}
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-sb-mono">{formatTime(position)}</span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={position}
              onChange={handleSeek}
              className="flex-1"
            />
            <span className="font-sb-mono">{formatTime(duration)}</span>
          </div>
        </>
      )}
    </div>
  )
}

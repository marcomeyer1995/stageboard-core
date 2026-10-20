import { useEffect, useState } from 'react'
import { CAPABILITIES, isYoutubeUrl, StemRoleSchema, type AsyncJob, type StemModel, type StemRole, type TrackKind, type TrackMeta, type YoutubeSearchResult } from 'shared-types'
import { measureAudioDurationMs } from '../lib/measureAudioDuration'
import { randomId } from '../lib/id'
import { pluginProviding } from '../lib/capabilities'
import { putAsyncJob, removeAsyncJob } from '../lib/asyncJobsDb'
import { getTrack, putTrack, removeTrack, updateStem } from '../lib/songVariantsDb'
import { guessStemRole, labelFromFileName, playableTracks, STEM_ROLE_LABELS, stemLengthsDiffer, stemsOf, uploadedStems } from '../lib/stems'
import { formatVideoLength, searchYoutube, youtubeThumbnailUrl } from '../lib/youtubeSearch'
import { useAsyncJobsStore } from '../store/useAsyncJobsStore'
import { useDialogStore } from '../store/useDialogStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { StemSeparationDialog } from './StemSeparationDialog'
import { INPUT } from './ui/styles'
import { AddRow, Button, Dialog, IconButton } from './ui'

const JOB_LABELS: Record<AsyncJob['type'], string> = { 'youtube-extract': 'YouTube-Extraktion', 'stem-separation': 'Spuren trennen' }

interface TrackManagerFieldProps {
  variantId: string
  tracks: TrackMeta[]
  /** True when the variant hasn't been saved yet - there's no document to attach anything to. */
  disabled: boolean
  /** "Titel Band" - what the YouTube search starts with (#618). */
  searchQuery?: string
}

const KIND_LABELS: Record<TrackKind, string> = {
  reference: 'Referenz',
  'band-mix': 'Band-Playback',
  stem: 'Stem',
}

const NO_ROLE = 'none'

/** Attach/remove any number of named tracks (reference/band-mix/stem) on a song variant - and,
 * with the stem-separation plugin installed (#9), split one into stems on the Stage-Server.
 * Stems form sets (docs/22 §2): those split from a track are listed under it, uploaded ones
 * (several files at once, e.g. from the band leader) in a set of their own. */
export function TrackManagerField({ variantId, tracks, disabled, searchQuery = '' }: TrackManagerFieldProps) {
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
  // "Von YouTube laden" only with the YouTube-Download add-on (#546).
  const canDownload = pluginProviding(installed, CAPABILITIES.videoDownload) !== null
  const promptFields = useDialogStore((state) => state.promptFields)
  const confirm = useDialogStore((state) => state.confirm)
  // "+ Track hinzufügen" (#604): kind, then a file or a YouTube link - in a dialog, not squeezed
  // into the section.
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState(searchQuery)
  const [hits, setHits] = useState<YoutubeSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [separating, setSeparating] = useState<TrackMeta | null>(null)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
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

  /** Name and role of a stem - the role may stay empty (band-leader stems have no fixed structure). */
  async function editStem(track: TrackMeta) {
    const result = await promptFields(
      'Spur bearbeiten',
      [
        { key: 'label', label: 'Name', defaultValue: track.label },
        {
          key: 'role',
          label: 'Rolle (optional)',
          type: 'radio',
          defaultValue: track.role ?? NO_ROLE,
          options: [{ value: NO_ROLE, label: 'Keine' }, ...StemRoleSchema.options.map((role) => ({ value: role, label: STEM_ROLE_LABELS[role] }))],
        },
      ],
      'Übernehmen',
    )
    if (!result?.label?.trim()) return
    const role = StemRoleSchema.safeParse(result.role)
    await updateStem(variantId, track.id, result.label, role.success ? role.data : undefined)
  }

  /** ▶ / ✎ / 🗑 as icons (Marco, 2026-10-20: clear enough) - one row per track on the phone (#604). */
  function playButton(track: TrackMeta) {
    const playing = listening?.trackId === track.id
    return (
      <IconButton
        icon={playing ? 'pause' : 'play'}
        label={playing ? `${track.label} anhalten` : `${track.label} anhören`}
        variant={playing ? 'primary' : 'secondary'}
        aria-pressed={playing}
        onClick={() => void listen(track)}
        disabled={busyTrackId === track.id}
      />
    )
  }

  function removeButton(track: TrackMeta) {
    return (
      <IconButton
        icon="delete"
        label={`${track.label} entfernen`}
        // Red like every destructive action - over the button's own ink colour.
        className="!text-danger"
        onClick={() => void handleRemove(track)}
        disabled={disabled || busyTrackId === track.id}
      />
    )
  }

  function stemSet(stems: TrackMeta[]) {
    return (
      <>
        {stemLengthsDiffer(stems) && <span className="ml-4 text-sm text-warn">Die Spuren sind unterschiedlich lang - sie laufen ab 0:00 zusammen, eine passt vielleicht nicht.</span>}
        {stems.map((stem) => (
          <div key={stem.id} className="ml-4 flex flex-col gap-1 border-l-2 border-line pl-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {stem.label}
                {/* The role only where the name doesn't already say it ("Schlagzeug Schlagzeug"). */}
                {stem.role && STEM_ROLE_LABELS[stem.role] !== stem.label && <span className="ml-2 text-xs text-ink-faint">{STEM_ROLE_LABELS[stem.role]}</span>}
              </span>
              {playButton(stem)}
              <IconButton icon="edit" label={`${stem.label} bearbeiten`} onClick={() => void editStem(stem)} disabled={disabled} />
              {removeButton(stem)}
            </div>
            {listening?.trackId === stem.id && <audio controls autoPlay src={listening.url} className="w-full" />}
          </div>
        ))}
      </>
    )
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

  /** One file, or - for stems - several at once, each named after its file with a guessed role. */
  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    const stem = uploadKind === 'stem'
    for (const [i, file] of (stem ? files : files.slice(0, 1)).entries()) {
      const id = randomId()
      setBusyTrackId(id)
      if (stem && files.length > 1) setUploadProgress(`Lade Spur ${i + 1} von ${files.length}…`)
      const durationMs = await measureAudioDurationMs(file)
      const role: StemRole | undefined = stem ? guessStemRole(file.name) : undefined
      try {
        await putTrack(
          variantId,
          {
            id,
            kind: uploadKind,
            label: stem ? labelFromFileName(file.name) : KIND_LABELS[uploadKind],
            source: 'upload',
            parentTrackId: null,
            ...(role && { role }),
            mimeType: file.type,
            addedAt: Date.now(),
            ...(durationMs !== null && { durationMs }),
          },
          file,
        )
      } catch (err) {
        setUploadProgress(`${file.name}: ${err instanceof Error ? err.message : String(err)}`)
        setBusyTrackId(null)
        return
      }
    }
    setUploadProgress(null)
    setBusyTrackId(null)
    setAdding(false)
  }

  /** An icon is quickly tapped by mistake - removing asks first (#604). */
  async function handleRemove(track: TrackMeta) {
    if (!(await confirm(`„${track.label}“ entfernen?`, { confirmLabel: 'Entfernen', danger: true }))) return
    setBusyTrackId(track.id)
    await removeTrack(variantId, track.id)
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
    await queueYoutube(url, 'YouTube Referenz')
  }

  /** Searched by the Stage-Server (#618) - no copying links out of YouTube any more. */
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setYoutubeError(null)
    const result = await searchYoutube(query.trim())
    setSearching(false)
    if (result.status === 'ok') setHits(result.data)
    else {
      setHits(null)
      setYoutubeError(result.message)
    }
  }

  async function queueYoutube(url: string, label: string) {
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
      label,
    })
    setYoutubeUrl('')
    setHits(null)
    setAdding(false)
  }

  return (
    <div className="flex flex-col gap-1 text-sm text-ink-muted">
      Tracks
      {/* Capped height, not open-ended - a long list must not push what follows it down, applied
          consistently even though this list is usually short (Marco: every dynamically-sized
          list should get this, not just the ones that obviously need it today). */}
      <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {tracks.length === 0 && <span className="text-xs text-ink-faint">Keine Tracks</span>}
        {playableTracks(tracks).map((track) => (
          <div key={track.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {track.label}
                <span className="ml-2 text-xs text-ink-faint">{KIND_LABELS[track.kind]}</span>
              </span>
              {playButton(track)}
              {canSeparate && <IconButton icon="split" label="Spuren trennen" onClick={() => setSeparating(track)} disabled={disabled} />}
              {removeButton(track)}
            </div>
            {listening?.trackId === track.id && <audio controls autoPlay src={listening.url} className="w-full" />}
            {stemSet(stemsOf(tracks, track.id))}
          </div>
        ))}
        {uploadedStems(tracks).length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-ink-faint">Hochgeladene Spuren</span>
            {stemSet(uploadedStems(tracks))}
          </div>
        )}
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
      <AddRow label="Track hinzufügen" onClick={() => setAdding(true)} disabled={disabled || busyTrackId !== null} />
      {uploadProgress && <span className="text-xs text-ink-faint">{uploadProgress}</span>}
      {disabled && <span className="text-xs text-ink-faint">Erst speichern, dann Tracks anhängen.</span>}
      {adding && (
        <Dialog title="Track hinzufügen" closeLabel="Abbrechen" onClose={() => setAdding(false)}>
          <div className="flex flex-col gap-3 text-base text-ink">
            <label className="flex flex-col gap-1 text-sm text-ink-muted">
              Art
              <select className={`min-h-form px-3 text-base ${INPUT}`} value={uploadKind} onChange={(e) => setUploadKind(e.target.value as TrackKind)}>
                {(Object.keys(KIND_LABELS) as TrackKind[]).map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>
            {/* A file input behind a button-sized label - the input itself can't be styled. */}
            <label
              className={`inline-flex min-h-form cursor-pointer items-center justify-center rounded-control bg-control-strong px-4 text-base text-ink [@media(hover:hover)]:hover:bg-control-strong-hover ${
                busyTrackId !== null ? 'pointer-events-none opacity-40' : ''
              }`}
            >
              {uploadKind === 'stem' ? 'Dateien wählen' : 'Datei wählen'}
              <input type="file" accept="audio/*" multiple={uploadKind === 'stem'} className="hidden" disabled={busyTrackId !== null} onChange={handleFiles} />
            </label>
            {uploadKind === 'stem' && (
              <span className="text-sm text-ink-faint">Mehrere Dateien auf einmal - alle gleich lang ab 0:00. Name und Rolle kommen aus dem Dateinamen.</span>
            )}
            {canDownload && (
              <div className="flex flex-col gap-2 border-t border-line pt-3">
                <form onSubmit={handleSearch} className="flex flex-col gap-2">
                  <span className="text-sm text-ink-muted">Oder eine Referenz von YouTube</span>
                  {/* Not inside a <label>: its text would become the button's name too. */}
                  <div className="flex gap-2">
                    <input
                      type="search"
                      aria-label="YouTube durchsuchen"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Titel und Band"
                      className={`min-h-form flex-1 min-w-0 px-3 text-base placeholder:text-ink-faint ${INPUT}`}
                    />
                    <Button type="submit" disabled={searching || !query.trim()}>
                      {searching ? 'Suche…' : 'Suchen'}
                    </Button>
                  </div>
                </form>
                {hits && hits.length === 0 && <span className="text-sm text-ink-faint">Nichts gefunden.</span>}
                {hits && hits.length > 0 && (
                  // A tap on a hit loads it - the same job as a pasted link.
                  <ul aria-label="Suchergebnisse" className="flex max-h-80 flex-col gap-1 overflow-y-auto">
                    {hits.map((hit) => {
                      const thumbnail = youtubeThumbnailUrl(hit.id)
                      return (
                        <li key={hit.id}>
                          <button
                            type="button"
                            onClick={() => void queueYoutube(hit.url, hit.title)}
                            className="flex min-h-form w-full items-center gap-3 rounded-control bg-control p-1 text-left [@media(hover:hover)]:hover:bg-control-hover"
                          >
                            {thumbnail && <img src={thumbnail} alt="" loading="lazy" className="h-form w-20 flex-none rounded-control bg-surface object-cover" />}
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="line-clamp-2 text-base text-ink">{hit.title}</span>
                              <span className="truncate text-sm text-ink-faint">
                                {[hit.channel, hit.durationSec !== null && formatVideoLength(hit.durationSec)].filter(Boolean).join(' · ')}
                              </span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
                <form onSubmit={handleYoutubeSubmit} className="flex gap-2">
                  <input
                    type="url"
                    aria-label="YouTube-Link"
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="oder Link einfügen: https://youtu.be/…"
                    className={`min-h-form flex-1 min-w-0 px-3 text-base placeholder:text-ink-faint ${INPUT}`}
                  />
                  <Button type="submit" disabled={youtubeUrl.trim() === ''}>
                    Laden
                  </Button>
                </form>
                {youtubeError && <span className="text-sm text-danger">{youtubeError}</span>}
              </div>
            )}
          </div>
        </Dialog>
      )}
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

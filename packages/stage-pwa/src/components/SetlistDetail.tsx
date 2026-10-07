import { useEffect, useRef, useState } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  DEFAULT_PAUSE_BETWEEN_SONGS_MS,
  DEFAULT_SONG_DURATION_MS,
  DEFAULT_TRANSITION_DELAY_MS,
  isHeadingEntry,
  isSongEntry,
  isTransitionEntry,
  type ItemStyle,
  type Setlist,
  type SongEntry,
  type Song,
  type SongVariant,
  type TransitionEntry,
  type TransitionType,
} from 'shared-types'
import { useQueue } from '../lib/queue'
import { randomId } from '../lib/id'
import { useDialogStore } from '../store/useDialogStore'
import { useBackHandler, useUnsavedChangesWarning } from '../lib/backNavigation'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useSongsStore } from '../store/useSongsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { formatItemSeconds } from '../lib/formatItemDuration'
import { OverflowMenu } from './OverflowMenu'
import { SetlistPreview } from './SetlistPreview'
import { Icon } from './Icon'
import { AddRow, Badge, Dialog, Field, MENU_ROW } from './ui'
import { INPUT, SELECTED } from './ui/styles'

interface SetlistDetailProps {
  setlistId: string
  /** Drives LibraryView's right pane over to SheetEditor for that song - `null` variantId
   * means "the song's default variant", same convention SetlistEntry itself uses. */
  onSelectSong: (songId: string, variantId: string | null) => void
  /** Called after the setlist is actually deleted, so LibraryView can clear a selection
   * that would otherwise point at a setlist that no longer exists. */
  onDeleted: () => void
  /** Whether there are unsaved changes - LibraryView asks before leaving the setlist then. */
  onDirtyChange?: (dirty: boolean) => void
}

/** Same content, regardless of key order or fields set to undefined. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => [key, canonical(record[key])]),
    )
  }
  return value
}

export function sameSetlist(a: Setlist, b: Setlist): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

/**
 * A plain `<select>`'s open popup list is positioned by the browser as part of normal page
 * layout in most desktop Chromium builds (unlike Android, which shows a completely separate
 * OS-level picker instead) - nested inside this row's own scrolling `<ul>` (SetlistDetail's
 * entries list), that popup got clipped in half on a laptop, confirmed working fine on a
 * tablet (Marco, live report). Portal-rendered instead, same escape-any-ancestor pattern
 * `OverflowMenu` already uses, so it can never be clipped by a scroll container again
 * regardless of platform/browser.
 */
function VariantPicker({
  variants,
  selectedId,
  onSelect,
}: {
  variants: SongVariant[]
  selectedId: string
  onSelect: (variantId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selectedLabel = variants.find((v) => v.id === selectedId)?.label ?? ''

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Variante wählen"
        // The whole name, wrapping onto more lines - it used to be cut to "Auto: music-tem…",
        // which left two detected variants of one song indistinguishable (GUI audit 2026-09-26).
        // Under the song title, at its own width (#414): a fixed 144 px in the row left a phone's
        // title 0 px wide.
        className="min-h-form max-w-full self-start whitespace-normal break-words rounded-control bg-control-strong px-3 py-1 text-left text-base leading-tight text-ink [@media(hover:hover)]:hover:bg-control-strong-hover"
      >
        {selectedLabel}
      </button>
      {open && (
        // Choosing one already closes it - so the way out is "Abbrechen" (docs/15 D6).
        <Dialog title="Variante" size="s" closeLabel="Abbrechen" onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-2">
            {variants.map((variant) => (
              <button
                key={variant.id}
                type="button"
                aria-current={variant.id === selectedId ? 'true' : undefined}
                onClick={() => {
                  setOpen(false)
                  onSelect(variant.id)
                }}
                className={`${MENU_ROW} ${variant.id === selectedId ? SELECTED : 'text-ink'}`}
              >
                {variant.label}
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </>
  )
}

const TRANSITION_OPTIONS: { type: TransitionType; label: string; hint: string; itemHint: string }[] = [
  {
    type: 'manual',
    label: 'Manuell',
    hint: 'Wiedergabe stoppt am Ende, der nächste Song wird von Hand gestartet.',
    itemHint: 'Läuft nicht von selbst weiter - mit „Weiter" von Hand.',
  },
  {
    type: 'next-ready',
    label: 'Nächster bereit',
    hint: 'Stoppt am Ende und stellt den nächsten Song bereit - Start von Hand.',
    itemHint: 'Nach Ablauf der Dauer wird der nächste Eintrag bereitgestellt - Start von Hand.',
  },
  {
    type: 'seamless',
    label: 'Nahtlos',
    hint: 'Der nächste Song startet sofort, ohne Pause und ohne Einzähler.',
    itemHint: 'Nach Ablauf der Dauer startet der nächste Eintrag sofort, ohne Einzähler.',
  },
  {
    type: 'delayed',
    label: 'Mit Pause',
    hint: 'Der nächste Song startet nach einer festen Pause, mit Einzähler.',
    itemHint: 'Nach Ablauf der Dauer und einer weiteren Pause startet der nächste Eintrag, mit Einzähler.',
  },
]

/** Per-entry "what happens when this song ends" (#232) - same portal-dialog shape as
 * VariantPicker above, for the same reason (a row-embedded popup gets clipped by the scrolling
 * entries list). The button shows "→" plus a short label only when it isn't the default, so the
 * common all-manual setlist stays uncluttered. */
function TransitionPicker({
  type,
  delayMs,
  isItem = false,
  onChange,
}: {
  type: TransitionType
  delayMs: number
  /** A transition item's type applies after its own countdown rather than at a track's end. */
  isItem?: boolean
  onChange: (type: TransitionType, delayMs: number) => void
}) {
  const [open, setOpen] = useState(false)
  const current = TRANSITION_OPTIONS.find((option) => option.type === type) ?? TRANSITION_OPTIONS[0]!

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Übergang zum nächsten Eintrag: ${current.label}`}
        className={`h-form min-w-form flex-shrink-0 rounded-control px-3 text-base [@media(hover:hover)]:hover:bg-control-strong-hover ${
          type === 'manual' ? 'text-ink-faint' : 'bg-control-strong text-ink'
        }`}
      >
        <span className="flex items-center gap-1">
          <Icon name="forward" />
          {type === 'manual' ? null : current.label}
        </span>
      </button>
      {open && (
        <Dialog title={isItem ? 'Übergang nach der Ansage' : 'Übergang zum nächsten Song'} size="s" onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Übergang">
            {TRANSITION_OPTIONS.map((option) => (
              <button
                key={option.type}
                type="button"
                role="radio"
                aria-checked={option.type === type}
                onClick={() => onChange(option.type, delayMs)}
                className={`${MENU_ROW} !flex-col !items-start py-2 ${option.type === type ? SELECTED : 'text-ink'}`}
              >
                <span className="text-base font-semibold">{option.label}</span>
                <span className="text-sm opacity-80">{isItem ? option.itemHint : option.hint}</span>
              </button>
            ))}
          </div>
          {type === 'delayed' && (
            <Field
              label="Pause (Sekunden)"
              type="number"
              min={0}
              step={1}
              value={Math.round(delayMs / 1000)}
              onChange={(e) => onChange('delayed', Math.max(0, Math.round(Number(e.target.value) || 0)) * 1000)}
            />
          )}
        </Dialog>
      )}
    </>
  )
}

interface EntryRowProps {
  entry: SongEntry
  index: number
  /** Position among the songs only - announcements and section headings aren't numbered. */
  songNumber: number
  song: Song | undefined
  songVariants: SongVariant[]
  onSelectSong: (songId: string, variantId: string | null) => void
  onSetVariant: (entryId: string, variantId: string) => void
  /** Omitted for the last entry - nothing follows it to transition into. */
  onSetTransition?: (entryId: string, type: TransitionType, delayMs: number) => void
  onRemove: (index: number) => void
}

/** A grip handle carries the drag listeners, not the row itself - the song title stays a
 * plain clickable button and the variant picker stays a plain button too, neither fighting
 * a drag gesture that would otherwise be listening on the same element. Drag is the only
 * reorder gesture (Marco, explicit request: the row menu's own "Nach oben"/"Nach unten" from
 * #181 went unused once drag existed, so they were removed rather than kept as a redundant
 * second way to do the same thing) - the ⋯ menu is Entfernen only. */
function EntryRow({
  entry,
  index,
  songNumber,
  song,
  songVariants,
  onSelectSong,
  onSetVariant,
  onSetTransition,
  onRemove,
}: EntryRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
  })
  const selectedVariantId = entry.variantId ?? songVariants.find((v) => v.isDefault)?.id ?? ''
  const title = song?.title ?? '(unbekannter Song)'

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-control bg-control px-3 py-3 text-base ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        style={{ touchAction: 'none' }}
        className="flex h-form w-form flex-shrink-0 cursor-grab items-center justify-center text-ink-faint active:cursor-grabbing"
        aria-label="Ziehen zum Sortieren"
      >
        ⠿
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <button
          type="button"
          onClick={() => onSelectSong(entry.songId, entry.variantId)}
          className="min-h-12 min-w-0 truncate text-left [@media(hover:hover)]:hover:underline"
        >
          {songNumber}. {title}
        </button>
        {songVariants.length > 1 && (
          <VariantPicker
            variants={songVariants}
            selectedId={selectedVariantId}
            onSelect={(variantId) => onSetVariant(entry.id, variantId)}
          />
        )}
      </div>
      {onSetTransition && (
        <TransitionPicker
          type={entry.transitionType ?? 'manual'}
          delayMs={entry.transitionDelayMs ?? DEFAULT_TRANSITION_DELAY_MS}
          onChange={(type, delayMs) => onSetTransition(entry.id, type, delayMs)}
        />
      )}
      {/* flat, not the default boxed pill - same unboxed treatment LibraryView.tsx's own song
          rows already use for their ⋯ (Marco, explicit request: match "the left ones"). */}
      <OverflowMenu
        title={title}
        variant="flat"
        actions={[{ label: 'Entfernen', danger: true, onClick: () => onRemove(index) }]}
      />
    </li>
  )
}

/** Settings for the Festival Clock widget (#28): the curfew and the time assumptions behind its
 * prediction. Collapsed by default - most setlists never need it (progressive disclosure). */
function ScheduleSettings({ setlist, onSave }: { setlist: Setlist; onSave: (next: Setlist) => void }) {
  const inputClass = `h-form !w-24 px-2 text-right ${INPUT}`
  function commitSeconds(field: 'defaultTransitionMs' | 'defaultSongDurationMs', text: string) {
    const seconds = Number(text.trim().replace(',', '.'))
    const value = text.trim() === '' || !Number.isFinite(seconds) || seconds < 0 ? undefined : Math.round(seconds) * 1000
    if (value !== setlist[field]) onSave({ ...setlist, [field]: value })
  }
  return (
    <details className="rounded-container border border-line px-3 py-2 text-base text-ink-soft">
      <summary className="cursor-pointer select-none py-3 font-medium text-ink-muted">
        Zeitplan (Festival-Uhr){setlist.targetEndTime ? ` · Ende ${setlist.targetEndTime}` : ''}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <label className="flex items-center justify-between gap-2">
          Endzeit (Curfew)
          <input
            type="time"
            value={setlist.targetEndTime ?? ''}
            onChange={(e) => onSave({ ...setlist, targetEndTime: e.target.value || undefined })}
            className={`h-form !w-auto px-2 ${INPUT}`}
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          Pause zwischen Songs (Sekunden)
          <input
            key={`pause-${setlist.defaultTransitionMs ?? ''}`}
            type="number"
            min={0}
            placeholder={String(DEFAULT_PAUSE_BETWEEN_SONGS_MS / 1000)}
            defaultValue={setlist.defaultTransitionMs === undefined ? '' : Math.round(setlist.defaultTransitionMs / 1000)}
            onBlur={(e) => commitSeconds('defaultTransitionMs', e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          Songlänge ohne Track (Sekunden)
          <input
            key={`song-${setlist.defaultSongDurationMs ?? ''}`}
            type="number"
            min={0}
            placeholder={String(DEFAULT_SONG_DURATION_MS / 1000)}
            defaultValue={setlist.defaultSongDurationMs === undefined ? '' : Math.round(setlist.defaultSongDurationMs / 1000)}
            onBlur={(e) => commitSeconds('defaultSongDurationMs', e.target.value)}
            className={inputClass}
          />
        </label>
        <p className="text-xs text-ink-faint">
          Grundlage für die voraussichtliche Endzeit. Songs mit hinterlegtem Track zählen mit ihrer echten Länge.
        </p>
      </div>
    </details>
  )
}

/** Whole seconds as text for the dialog field; empty = no duration. */
function secondsText(ms: number | undefined): string {
  return ms ? String(Math.round(ms / 1000)) : ''
}

function parseSeconds(text: string | undefined): number | undefined {
  const seconds = Number((text ?? '').trim().replace(',', '.'))
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) * 1000 : undefined
}

interface TransitionItemRowProps {
  entry: TransitionEntry
  index: number
  onEdit: (entry: TransitionEntry) => void
  onSetTransition?: (entryId: string, type: TransitionType, delayMs: number) => void
  onRemove: (index: number) => void
}

/** A non-song item (#29): announcement/pause. Same drag handle as EntryRow; tapping the title
 * edits it. Shown distinctly (accent text + "Ansage" tag) so it can't be mistaken for a song. */
function TransitionItemRow({ entry, index, onEdit, onSetTransition, onRemove }: TransitionItemRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id })
  const heading = isHeadingEntry(entry)
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 px-3 py-3 text-base ${
        heading ? 'mt-2 border-b-2 border-accent' : 'rounded-control border border-dashed border-line bg-control'
      } ${isDragging ? 'opacity-50' : ''}`}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        style={{ touchAction: 'none' }}
        className="flex h-form w-form flex-shrink-0 cursor-grab items-center justify-center text-ink-faint active:cursor-grabbing"
        aria-label="Ziehen zum Sortieren"
      >
        ⠿
      </button>
      <button type="button" onClick={() => onEdit(entry)} className="min-h-12 min-w-0 flex-1 truncate text-left [@media(hover:hover)]:hover:underline">
        {heading ? (
          <span className="text-sm font-bold uppercase tracking-widest text-accent">{entry.title}</span>
        ) : (
          <>
            <span className="mr-2"><Badge tone="accent">Ansage</Badge></span>
            <span className="italic">{entry.title}</span>
          </>
        )}
        {entry.estimatedDurationMs ? (
          <span className="ml-2 text-xs text-ink-faint">{formatItemSeconds(entry.estimatedDurationMs)}</span>
        ) : null}
      </button>
      {onSetTransition && (
        <TransitionPicker
          isItem
          type={entry.transitionType ?? 'manual'}
          delayMs={entry.transitionDelayMs ?? DEFAULT_TRANSITION_DELAY_MS}
          onChange={(type, delayMs) => onSetTransition(entry.id, type, delayMs)}
        />
      )}
      <OverflowMenu
        title={entry.title}
        variant="flat"
        actions={[
          { label: 'Bearbeiten', onClick: () => onEdit(entry) },
          { label: 'Entfernen', danger: true, onClick: () => onRemove(index) },
        ]}
      />
    </li>
  )
}

/** A plain `<select>` doesn't let you type to filter its own options - this is a small
 * hand-rolled combobox instead (text input + a dropdown of matches below it), same
 * title/artist substring match LibraryView.tsx's own search box already uses. Opening it
 * (focus) shows every song; typing narrows the list; picking one adds it and resets. Closes on
 * Escape or a click outside - `mousedown`, not `click`, so it fires before a dropdown button's
 * own click would otherwise be pre-empted by an intervening blur. */
function AddSongCombobox({ songs, onAdd }: { songs: Song[]; onAdd: (songId: string) => void }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const term = query.trim().toLowerCase()
  const filtered = term
    ? songs.filter((s) => s.title.toLowerCase().includes(term) || s.artist?.toLowerCase().includes(term))
    : songs

  function pick(songId: string) {
    onAdd(songId)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1 text-sm text-ink-muted">
      Song hinzufügen
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder="Songs durchsuchen…"
        className={`h-form px-4 text-base ${INPUT}`}
      />
      {open && (
        // Opens upward, not down (Marco, explicit request) - this control sits at the bottom
        // of the pane, below the entry list, so a downward dropdown pushed itself off-screen
        // and needed a scroll to reach; anchoring to the input's top edge instead opens into
        // the room the entry list already occupies.
        <ul className="absolute inset-x-0 bottom-full z-10 mb-1 max-h-64 overflow-y-auto rounded-container border border-line bg-surface shadow-sb">
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-sm text-ink-faint">Keine Songs gefunden.</li>
          ) : (
            filtered.map((song) => (
              <li key={song.id}>
                <button
                  type="button"
                  onClick={() => pick(song.id)}
                  className="block w-full truncate px-4 py-3 text-left text-base text-ink [@media(hover:hover)]:hover:bg-control-hover"
                >
                  {song.title || '(ohne Titel)'}
                  {song.artist && <span className="text-ink-faint"> — {song.artist}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

/**
 * The management pane for one setlist - reorder (drag), remove entries, pick a per-entry
 * variant, add songs, rename, duplicate, activate. Extracted from the
 * old standalone SetlistManager (#20) so LibraryView's unified tree can reuse it as the
 * right-pane detail view for "click a setlist" - the list-of-all-setlists half of that
 * component lives in LibraryView now.
 */
export function SetlistDetail({ setlistId, onSelectSong, onDeleted, onDirtyChange }: SetlistDetailProps) {
  const songs = useSongsStore((state) => state.songs)
  const variants = useSongVariantsStore((state) => state.variants)
  const setlists = useSetlistsStore((state) => state.setlists)
  const saveSetlist = useSetlistsStore((state) => state.saveSetlist)
  const duplicateSetlist = useSetlistsStore((state) => state.duplicateSetlist)
  const removeSetlist = useSetlistsStore((state) => state.remove)
  const promptText = useDialogStore((state) => state.promptText)
  const confirm = useDialogStore((state) => state.confirm)
  const promptFields = useDialogStore((state) => state.promptFields)
  const { activeSetlist, isMaster } = useQueue()
  const setActiveSetlist = useShowStateStore((state) => state.setActiveSetlist)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const stored = setlists.find((s) => s.id === setlistId) ?? null
  // Edits go to a draft, like in the song editor (Marco, 2026-10-07): "Speichern" takes them
  // over, leaving without saving throws them away (after asking). Activating and deleting stay
  // immediate - they aren't changes to the setlist itself.
  const [draft, setDraft] = useState<Setlist | null>(stored)
  const dirty = draft !== null && stored !== null && !sameSetlist(draft, stored)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  // Follows the stored setlist (another device, or our own save) as long as nothing is pending.
  useEffect(() => {
    if (!dirtyRef.current) setDraft(stored)
  }, [stored])
  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])
  useUnsavedChangesWarning(dirty)
  const setlist = draft
  const update = (next: Setlist) => setDraft(next)
  // Opens as a clean preview (SetlistPreview); "Bearbeiten" switches to the editor below.
  const [editing, setEditing] = useState(false)

  async function handleSave() {
    if (!draft) return
    if (!draft.name.trim()) return
    await saveSetlist({ ...draft, name: draft.name.trim() })
    setEditing(false)
  }

  /** "Abbrechen" / Back in the editor: back to the preview, asking first if something changed. */
  async function leaveEditing() {
    if (dirty && !(await confirm('Ungespeicherte Änderungen verwerfen?', { confirmLabel: 'Verwerfen', danger: true }))) return
    setDraft(stored)
    setEditing(false)
  }
  useBackHandler(editing ? () => void leaveEditing() : null)

  async function handleDuplicate() {
    if (!setlist) return
    const name = await promptText('Setlist duplizieren', {
      label: 'Name der Kopie',
      defaultValue: `${setlist.name} (Kopie)`,
    })
    if (!name?.trim()) return
    // Copies what is shown, unsaved changes included.
    await duplicateSetlist(setlist, name.trim())
  }

  async function handleDelete() {
    if (!stored) return
    const setlist = stored
    const confirmed = await confirm(
      `"${setlist.name}" wirklich löschen? Das kann nicht rückgängig gemacht werden.`,
      { confirmLabel: 'Löschen', danger: true },
    )
    if (!confirmed) {
      return
    }
    // Deleting the active setlist shouldn't leave ShowState pointing at a document that no
    // longer exists - the app already tolerates that (this same file's own "Setlist wurde
    // entfernt" fallback), but clearing it here is the cleaner outcome for whoever's
    // watching the queue elsewhere (e.g. NextSongWidget) right as this happens.
    if (activeSetlist?.id === setlist.id && isMaster) {
      await setActiveSetlist(null)
    }
    await removeSetlist(setlist.id)
    onDeleted()
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!setlist || !event.over || event.active.id === event.over.id) return
    const from = setlist.entries.findIndex((e) => e.id === event.active.id)
    const to = setlist.entries.findIndex((e) => e.id === event.over?.id)
    if (from === -1 || to === -1) return
    update({ ...setlist, entries: arrayMove(setlist.entries, from, to) })
  }

  function removeSong(index: number) {
    if (!setlist) return
    update({ ...setlist, entries: setlist.entries.filter((_, i) => i !== index) })
  }

  /** Adds a new occurrence of a song - deliberately allowed even if the song is already in
   * the setlist, so e.g. a shortened "Kurzfassung" can be added as an encore of a song that
   * already played earlier in its full-length variant. */
  function addSong(songId: string) {
    if (!setlist || !songId) return
    update({
      ...setlist,
      entries: [...setlist.entries, { id: randomId(), songId, variantId: null, trackId: null }],
    })
  }

  const transitionFields = (entry?: TransitionEntry, defaultStyle: ItemStyle = 'announcement') => [
    { key: 'title', label: 'Titel (z. B. "Ansage Merch-Stand" oder "Set 2")', defaultValue: entry?.title ?? '' },
    {
      key: 'style',
      label: 'Darstellung',
      type: 'radio' as const,
      defaultValue: entry?.style ?? defaultStyle,
      options: [
        { value: 'announcement', label: 'Ansage / Pause' },
        { value: 'heading', label: 'Abschnitts-Überschrift (z. B. Set 1)' },
      ],
    },
    { key: 'notes', label: 'Notizen für die Band (optional)', type: 'textarea' as const, defaultValue: entry?.notes ?? '' },
    { key: 'seconds', label: 'Dauer (Sekunden, optional - für automatischen Übergang)', defaultValue: secondsText(entry?.estimatedDurationMs) },
  ]

  /** Adds an announcement/pause between songs (#29) - a real queue position with notes, no audio. */
  async function addTransition(defaultStyle: ItemStyle) {
    if (!setlist) return
    const heading = defaultStyle === 'heading'
    const result = await promptFields(
      heading ? 'Abschnitt hinzufügen' : 'Ansage / Pause hinzufügen',
      transitionFields(undefined, defaultStyle),
      'Hinzufügen',
    )
    if (!result?.title?.trim()) return
    const item: TransitionEntry = {
      id: randomId(),
      kind: 'transition',
      style: result.style === 'heading' ? 'heading' : 'announcement',
      title: result.title.trim(),
      notes: result.notes ?? '',
      estimatedDurationMs: parseSeconds(result.seconds),
    }
    update({ ...setlist, entries: [...setlist.entries, item] })
  }

  async function editTransition(entry: TransitionEntry) {
    if (!setlist) return
    const result = await promptFields('Eintrag bearbeiten', transitionFields(entry), 'Speichern')
    if (!result?.title?.trim()) return
    const updated: TransitionEntry = {
      ...entry,
      style: result.style === 'heading' ? 'heading' : 'announcement',
      title: result.title.trim(),
      notes: result.notes ?? '',
      estimatedDurationMs: parseSeconds(result.seconds),
    }
    update({ ...setlist, entries: setlist.entries.map((e) => (e.id === entry.id ? updated : e)) })
  }

  function setVariant(entryId: string, variantId: string) {
    if (!setlist) return
    update({
      ...setlist,
      entries: setlist.entries.map((entry) =>
        entry.id === entryId && isSongEntry(entry) ? { ...entry, variantId } : entry,
      ),
    })
  }

  function setTransition(entryId: string, transitionType: TransitionType, transitionDelayMs: number) {
    if (!setlist) return
    update({
      ...setlist,
      entries: setlist.entries.map((entry) =>
        entry.id === entryId ? { ...entry, transitionType, transitionDelayMs } : entry,
      ),
    })
  }

  if (!setlist || !stored) {
    return <p className="text-ink-faint">Setlist wurde entfernt.</p>
  }

  if (!editing) {
    return (
      <SetlistPreview
        setlist={stored}
        active={activeSetlist?.id === stored.id}
        canActivate={isMaster}
        onActivate={() => void setActiveSetlist(stored.id)}
        onDeactivate={() => void setActiveSetlist(null)}
        onEdit={() => {
          setDraft(stored)
          setEditing(true)
        }}
        menu={[
          { label: 'Duplizieren', onClick: () => void handleDuplicate() },
          { label: 'Löschen', danger: true, onClick: () => void handleDelete() },
        ]}
        onSelectSong={onSelectSong}
      />
    )
  }

  return (
    // flex-1/min-h-0, not h-full: this sits beside LibraryView's mobile-only "← Bibliothek"
    // button (a sibling in the same flex-col pane, not a fixed-height container of its own),
    // so h-full would claim 100% of the pane and overflow by the button's own height whenever
    // that button is actually visible (Marco: the whole page was scrolling in portrait mode,
    // not just this list) - flex-1 instead claims only what's left after the button.
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Editing (Marco, 2026-10-07): nothing is stored before "Speichern"; "Abbrechen" drops it. */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void leaveEditing()}
          className="h-form rounded-control bg-control-strong px-4 text-base text-ink [@media(hover:hover)]:hover:bg-control-strong-hover"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!setlist.name.trim()}
          className="h-form rounded-control bg-accent px-5 text-base font-semibold text-accent-ink [@media(hover:hover)]:hover:bg-accent-hover disabled:opacity-40"
        >
          Speichern
        </button>
      </div>
      <Field label="Name" value={setlist.name} onChange={(e) => update({ ...setlist, name: e.target.value })} />
      {/* For sorting the Bibliothek by gig (Marco, 2026-10-07) - optional, a plain date. */}
      <div className="max-w-56">
        <Field
          label="Auftrittsdatum"
          type="date"
          value={setlist.performanceDate ?? ''}
          onChange={(e) => update({ ...setlist, performanceDate: e.target.value || undefined })}
        />
      </div>
      <ScheduleSettings setlist={setlist} onSave={update} />
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={setlist.entries.map((e) => e.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-1 flex-col gap-1 overflow-y-auto">
            {setlist.entries.map((entry, index) =>
              isTransitionEntry(entry) ? (
                <TransitionItemRow
                  key={entry.id}
                  entry={entry}
                  index={index}
                  onEdit={(item) => void editTransition(item)}
                  onSetTransition={index < setlist.entries.length - 1 ? setTransition : undefined}
                  onRemove={removeSong}
                />
              ) : (
              <EntryRow
                key={entry.id}
                entry={entry}
                index={index}
                songNumber={setlist.entries.slice(0, index + 1).filter(isSongEntry).length}
                song={songs.find((s) => s.id === entry.songId)}
                songVariants={variants.filter((v) => v.songId === entry.songId)}
                onSelectSong={onSelectSong}
                onSetVariant={setVariant}
                onSetTransition={index < setlist.entries.length - 1 ? setTransition : undefined}
                onRemove={removeSong}
              />
              ),
            )}
          </ul>
        </SortableContext>
      </DndContext>
      {/* Phone (#414): search field across the full width, the two buttons below it - in one row
          the buttons squeezed the search field to "Sor…". Wide screens keep one row. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <AddSongCombobox songs={songs} onAdd={addSong} />
        </div>
        <div className="flex gap-2">
          <AddRow inline label="Ansage / Pause" onClick={() => void addTransition('announcement')} />
          <AddRow inline label="Abschnitt" onClick={() => void addTransition('heading')} />
        </div>
      </div>
    </div>
  )
}

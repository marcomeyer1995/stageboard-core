import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  DEFAULT_TRANSITION_DELAY_MS,
  isHeadingEntry,
  isSongEntry,
  isTransitionEntry,
  type ItemStyle,
  type SongEntry,
  type Song,
  type SongVariant,
  type TransitionEntry,
  type TransitionType,
} from 'shared-types'
import { useQueue } from '../lib/queue'
import { randomId } from '../lib/id'
import { useDialogStore } from '../store/useDialogStore'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useSongsStore } from '../store/useSongsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { formatItemSeconds } from '../lib/formatItemDuration'
import { OverflowMenu } from './OverflowMenu'

interface SetlistDetailProps {
  setlistId: string
  /** Drives LibraryView's right pane over to SheetEditor for that song - `null` variantId
   * means "the song's default variant", same convention SetlistEntry itself uses. */
  onSelectSong: (songId: string, variantId: string | null) => void
  /** Called after the setlist is actually deleted, so LibraryView can clear a selection
   * that would otherwise point at a setlist that no longer exists. */
  onDeleted: () => void
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
        className="h-10 w-32 min-w-0 flex-shrink-0 truncate rounded-sb-sm bg-control-strong px-2 text-left text-sm text-ink hover:bg-control-strong-hover"
      >
        {selectedLabel}
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-3"
            onClick={() => setOpen(false)}
          >
            <div
              className="flex w-full max-w-[min(320px,85vw)] flex-col gap-3 rounded-sb border border-line bg-surface p-3 shadow-sb"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-bold uppercase tracking-widest text-ink-faint">Variante</p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  title="Schließen"
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sb-sm text-ink-muted hover:bg-control-hover hover:text-ink"
                >
                  ✕
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {variants.map((variant) => (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      onSelect(variant.id)
                    }}
                    className={`h-11 w-full rounded-sb px-3 text-left text-base ${
                      variant.id === selectedId
                        ? 'bg-accent text-accent-ink'
                        : 'bg-control text-ink hover:bg-control-hover'
                    }`}
                  >
                    {variant.label}
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body,
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
        className={`h-10 flex-shrink-0 rounded-sb-sm px-2 text-sm hover:bg-control-strong-hover ${
          type === 'manual' ? 'text-ink-faint' : 'bg-control-strong text-accent'
        }`}
      >
        {type === 'manual' ? '→' : `→ ${current.label}`}
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-3"
            onClick={() => setOpen(false)}
          >
            <div
              className="flex w-full max-w-[min(360px,90vw)] flex-col gap-3 rounded-sb border border-line bg-surface p-3 shadow-sb"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-bold uppercase tracking-widest text-ink-faint">
                  {isItem ? 'Übergang nach der Ansage' : 'Übergang zum nächsten Song'}
                </p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  title="Schließen"
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sb-sm text-ink-muted hover:bg-control-hover hover:text-ink"
                >
                  ✕
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {TRANSITION_OPTIONS.map((option) => (
                  <button
                    key={option.type}
                    type="button"
                    onClick={() => onChange(option.type, delayMs)}
                    className={`flex flex-col rounded-sb px-3 py-2 text-left ${
                      option.type === type ? 'bg-accent text-accent-ink' : 'bg-control text-ink hover:bg-control-hover'
                    }`}
                  >
                    <span className="text-base font-semibold">{option.label}</span>
                    <span className="text-xs opacity-80">{isItem ? option.itemHint : option.hint}</span>
                  </button>
                ))}
              </div>
              {type === 'delayed' && (
                <label className="flex items-center justify-between gap-2 text-sm text-ink-soft">
                  Pause (Sekunden)
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={Math.round(delayMs / 1000)}
                    onChange={(e) => onChange('delayed', Math.max(0, Math.round(Number(e.target.value) || 0)) * 1000)}
                    className="h-10 w-20 rounded-sb-sm bg-control px-2 text-right text-ink"
                  />
                </label>
              )}
            </div>
          </div>,
          document.body,
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
      className={`flex items-center gap-2 rounded-sb-sm bg-control px-3 py-3 text-base ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        style={{ touchAction: 'none' }}
        className="flex h-10 w-8 flex-shrink-0 cursor-grab items-center justify-center text-ink-faint active:cursor-grabbing"
        aria-label="Ziehen zum Sortieren"
      >
        ⠿
      </button>
      <button
        type="button"
        onClick={() => onSelectSong(entry.songId, entry.variantId)}
        className="min-w-0 flex-1 truncate text-left hover:underline"
      >
        {songNumber}. {title}
      </button>
      {onSetTransition && (
        <TransitionPicker
          type={entry.transitionType ?? 'manual'}
          delayMs={entry.transitionDelayMs ?? DEFAULT_TRANSITION_DELAY_MS}
          onChange={(type, delayMs) => onSetTransition(entry.id, type, delayMs)}
        />
      )}
      {songVariants.length > 1 && (
        <VariantPicker
          variants={songVariants}
          selectedId={selectedVariantId}
          onSelect={(variantId) => onSetVariant(entry.id, variantId)}
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
        heading ? 'mt-2 border-b-2 border-accent' : 'rounded-sb-sm border border-dashed border-line bg-control'
      } ${isDragging ? 'opacity-50' : ''}`}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        style={{ touchAction: 'none' }}
        className="flex h-10 w-8 flex-shrink-0 cursor-grab items-center justify-center text-ink-faint active:cursor-grabbing"
        aria-label="Ziehen zum Sortieren"
      >
        ⠿
      </button>
      <button type="button" onClick={() => onEdit(entry)} className="min-w-0 flex-1 truncate text-left hover:underline">
        {heading ? (
          <span className="text-sm font-bold uppercase tracking-widest text-accent">{entry.title}</span>
        ) : (
          <>
            <span className="mr-2 text-xs font-bold uppercase tracking-wider text-accent">Ansage</span>
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
        className="h-12 rounded-sb-sm bg-control px-4 text-base text-ink placeholder:text-ink-faint"
      />
      {open && (
        // Opens upward, not down (Marco, explicit request) - this control sits at the bottom
        // of the pane, below the entry list, so a downward dropdown pushed itself off-screen
        // and needed a scroll to reach; anchoring to the input's top edge instead opens into
        // the room the entry list already occupies.
        <ul className="absolute inset-x-0 bottom-full z-10 mb-1 max-h-64 overflow-y-auto rounded-sb border border-line bg-surface shadow-sb">
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-sm text-ink-faint">Keine Songs gefunden.</li>
          ) : (
            filtered.map((song) => (
              <li key={song.id}>
                <button
                  type="button"
                  onClick={() => pick(song.id)}
                  className="block w-full truncate px-4 py-3 text-left text-base text-ink hover:bg-control-hover"
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
export function SetlistDetail({ setlistId, onSelectSong, onDeleted }: SetlistDetailProps) {
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

  const setlist = setlists.find((s) => s.id === setlistId) ?? null

  async function handleRename() {
    if (!setlist) return
    const name = await promptText('Setlist umbenennen', { label: 'Neuer Name', defaultValue: setlist.name })
    if (!name?.trim()) return
    saveSetlist({ ...setlist, name: name.trim() })
  }

  async function handleDuplicate() {
    if (!setlist) return
    const name = await promptText('Setlist duplizieren', {
      label: 'Name der Kopie',
      defaultValue: `${setlist.name} (Kopie)`,
    })
    if (!name?.trim()) return
    await duplicateSetlist(setlist.id, name.trim())
  }

  async function handleDelete() {
    if (!setlist) return
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
    saveSetlist({ ...setlist, entries: arrayMove(setlist.entries, from, to) })
  }

  function removeSong(index: number) {
    if (!setlist) return
    saveSetlist({ ...setlist, entries: setlist.entries.filter((_, i) => i !== index) })
  }

  /** Adds a new occurrence of a song - deliberately allowed even if the song is already in
   * the setlist, so e.g. a shortened "Kurzfassung" can be added as an encore of a song that
   * already played earlier in its full-length variant. */
  function addSong(songId: string) {
    if (!setlist || !songId) return
    saveSetlist({
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
    saveSetlist({ ...setlist, entries: [...setlist.entries, item] })
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
    saveSetlist({ ...setlist, entries: setlist.entries.map((e) => (e.id === entry.id ? updated : e)) })
  }

  function setVariant(entryId: string, variantId: string) {
    if (!setlist) return
    saveSetlist({
      ...setlist,
      entries: setlist.entries.map((entry) =>
        entry.id === entryId && isSongEntry(entry) ? { ...entry, variantId } : entry,
      ),
    })
  }

  function setTransition(entryId: string, transitionType: TransitionType, transitionDelayMs: number) {
    if (!setlist) return
    saveSetlist({
      ...setlist,
      entries: setlist.entries.map((entry) =>
        entry.id === entryId ? { ...entry, transitionType, transitionDelayMs } : entry,
      ),
    })
  }

  if (!setlist) {
    return <p className="text-ink-faint">Setlist wurde entfernt.</p>
  }

  return (
    // flex-1/min-h-0, not h-full: this sits beside LibraryView's mobile-only "← Bibliothek"
    // button (a sibling in the same flex-col pane, not a fixed-height container of its own),
    // so h-full would claim 100% of the pane and overflow by the button's own height whenever
    // that button is actually visible (Marco: the whole page was scrolling in portrait mode,
    // not just this list) - flex-1 instead claims only what's left after the button.
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-ink-muted">
          {setlist.name}
          {activeSetlist?.id === setlist.id && (
            <span className="text-xs font-semibold normal-case text-accent">● Aktiv</span>
          )}
        </h2>
        <span className="flex flex-shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setActiveSetlist(setlist.id)}
            disabled={!isMaster}
            className="h-10 rounded-sb-sm bg-accent-2 px-3 text-sm font-medium text-accent-ink hover:bg-accent-2-hover disabled:opacity-40"
          >
            Aktivieren
          </button>
          {/* Duplizieren/Löschen behind one menu, same pattern as a song row's own ⋯ in
              LibraryView.tsx - harmonizing how a song vs. a setlist gets deleted (Marco,
              explicit request). Aktivieren stays its own always-visible button: it's the one
              action reached for constantly during a show, unlike the other two. */}
          <OverflowMenu
            title={setlist.name}
            actions={[
              { label: 'Umbenennen', onClick: () => void handleRename() },
              { label: 'Duplizieren', onClick: () => void handleDuplicate() },
              { label: 'Löschen', danger: true, onClick: () => void handleDelete() },
            ]}
          />
        </span>
      </div>
      {activeSetlist?.id === setlist.id && (
        <button
          type="button"
          onClick={() => setActiveSetlist(null)}
          disabled={!isMaster}
          className="h-10 self-start rounded-sb-sm bg-control-strong px-3 text-sm hover:bg-control-strong-hover disabled:opacity-40"
        >
          Setlist deaktivieren (alle Songs)
        </button>
      )}
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
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <AddSongCombobox songs={songs} onAdd={addSong} />
        </div>
        <button
          type="button"
          onClick={() => void addTransition('announcement')}
          className="h-12 flex-shrink-0 rounded-sb bg-control-strong px-3 text-sm font-medium text-ink hover:bg-control-strong-hover"
        >
          + Ansage / Pause
        </button>
        <button
          type="button"
          onClick={() => void addTransition('heading')}
          className="h-12 flex-shrink-0 rounded-sb bg-control-strong px-3 text-sm font-medium text-ink hover:bg-control-strong-hover"
        >
          + Abschnitt
        </button>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Dashboard } from 'shared-types'
import { canEditDashboard } from '../lib/dashboardLayout'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useModeDashboards } from '../lib/useModeDashboards'
import { useActiveDashboardStore } from '../store/useActiveDashboardStore'
import { useDashboardMenuStore } from '../store/useDashboardMenuStore'
import { useDashboardsStore } from '../store/useDashboardsStore'
import { useDialogStore } from '../store/useDialogStore'
import { useEditModeStore } from '../store/useEditModeStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { Icon } from './Icon'

/** A tap stays a tap: the fill only starts after this long (Marco: filling on every short tap
 * looked ugly). */
export const FILL_DELAY_MS = 200
/** How long the visible fill then runs until edit mode opens. */
export const FILL_MS = 600
/** Total time an entry is held to edit it. */
export const HOLD_MS = FILL_DELAY_MS + FILL_MS
/** How long the "hold it" hint stays after a tap that was meant as a hold, ms. */
const HINT_MS = 2500

/**
 * The dashboards in the main menu (Marco's dashboard editing redesign, replacing "Dashboards
 * verwalten" and the separate "Bearbeiten" lock):
 * - tap an entry: switch to it;
 * - hold it (it fills up): open it in edit mode - the bar at the top then has everything else;
 * - a template a musician can't change (#16) shows a lock; holding it offers an own copy instead;
 * - "Ordnen": drag to reorder, eye to hide - per device, every musician arranges their own menu;
 * - "+ Neues Dashboard" at the end.
 */
export function DashboardMenuList({ onSelect, onEdit }: { onSelect: (id: string) => void; onEdit: () => void }) {
  const { candidates, listed, hidden, active } = useModeDashboards()
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const setOrder = useDashboardMenuStore((state) => state.setOrder)
  const setHidden = useDashboardMenuStore((state) => state.setHidden)
  const create = useDashboardsStore((state) => state.create)
  const duplicate = useDashboardsStore((state) => state.duplicate)
  const setActive = useActiveDashboardStore((state) => state.setActive)
  const setEditing = useEditModeStore((state) => state.setEditing)
  const promptText = useDialogStore((state) => state.promptText)
  const confirm = useDialogStore((state) => state.confirm)
  const profile = useActiveProfile()
  const roles = profile?.stageRoles ?? []
  const [arranging, setArranging] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function openForEditing(id: string) {
    setActive(workspaceId, id)
    setEditing(true)
    onEdit()
  }

  async function edit(dashboard: Dashboard) {
    if (canEditDashboard(dashboard, roles)) {
      openForEditing(dashboard.id)
      return
    }
    // A template (#16): the musician's own copy instead.
    if (!profile) return
    const ok = await confirm(`„${dashboard.name}“ ist eine Vorlage - nur Admins ändern sie. Eine eigene Kopie anlegen und bearbeiten?`, {
      title: 'Vorlage',
      confirmLabel: 'Eigene Kopie bearbeiten',
    })
    if (!ok) return
    const copy = await duplicate(dashboard.id, `${dashboard.name} Kopie`, profile.id)
    if (copy) openForEditing(copy.id)
  }

  async function createNew() {
    const name = (await promptText('Neues Dashboard', { label: 'Name', submitLabel: 'Anlegen' }))?.trim()
    if (!name) return
    // Private to whoever creates it - shared later via ⋯ in the edit bar.
    const created = await create(name, profile ? { ownerProfileId: profile.id, visibility: 'private' } : undefined)
    openForEditing(created.id)
  }

  function onDragEnd(event: DragEndEvent) {
    const from = listed.findIndex((d) => d.id === event.active.id)
    const to = listed.findIndex((d) => d.id === event.over?.id)
    if (from < 0 || to < 0 || from === to) return
    setOrder(
      workspaceId,
      arrayMove(listed, from, to).map((d) => d.id),
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {arranging ? (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <SortableContext items={listed.map((d) => d.id)} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-1" aria-label="Dashboards ordnen">
              {listed.map((dashboard) => (
                <ArrangeRow
                  key={dashboard.id}
                  dashboard={dashboard}
                  hidden={hidden.includes(dashboard.id)}
                  // The last shown one can't be hidden - the menu would be empty.
                  canHide={!hidden.includes(dashboard.id) && candidates.length > 1}
                  onToggleHidden={(hide) => setHidden(workspaceId, dashboard.id, hide)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        candidates.map((dashboard) => (
          <DashboardEntry
            key={dashboard.id}
            dashboard={dashboard}
            active={dashboard.id === active?.id}
            locked={!canEditDashboard(dashboard, roles)}
            onSelect={() => onSelect(dashboard.id)}
            onHold={() => void edit(dashboard)}
          />
        ))
      )}
      <div className="mt-1 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void createNew()}
          disabled={arranging}
          className="flex h-12 items-center justify-center rounded-sb bg-control px-3 text-base text-ink-soft hover:bg-control-hover disabled:opacity-40"
        >
          + Neues Dashboard
        </button>
        <button
          type="button"
          aria-pressed={arranging}
          onClick={() => setArranging(!arranging)}
          className={`flex h-12 items-center justify-center rounded-sb px-3 text-base font-semibold ${
            arranging ? 'bg-accent text-accent-ink' : 'bg-control text-ink-soft hover:bg-control-hover'
          }`}
        >
          {arranging ? 'Fertig' : 'Ordnen'}
        </button>
      </div>
      {!arranging && <p className="text-xs text-ink-faint">Tippen wechselt, gedrückt halten bearbeitet.</p>}
      {arranging && <p className="text-xs text-ink-faint">Ziehen sortiert, das Auge blendet aus - nur auf diesem Gerät.</p>}
    </div>
  )
}

/** One dashboard in the menu: a tap switches, holding fills it up and opens it for editing. */
function DashboardEntry({ dashboard, active, locked, onSelect, onHold }: { dashboard: Dashboard; active: boolean; locked: boolean; onSelect: () => void; onHold: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fillTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [holding, setHolding] = useState(false)
  const [hint, setHint] = useState(false)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      if (fillTimer.current) clearTimeout(fillTimer.current)
      if (hintTimer.current) clearTimeout(hintTimer.current)
    },
    [],
  )

  function start() {
    setHint(false)
    fillTimer.current = setTimeout(() => setHolding(true), FILL_DELAY_MS)
    timer.current = setTimeout(() => {
      timer.current = null
      setHolding(false)
      onHold()
    }, HOLD_MS)
  }
  /** Released: before the hold completed it was a tap (switch); sliding off cancels (a scroll). */
  function end(asTap: boolean) {
    const wasPending = timer.current !== null
    if (timer.current) clearTimeout(timer.current)
    if (fillTimer.current) clearTimeout(fillTimer.current)
    timer.current = null
    setHolding(false)
    if (wasPending && asTap) onSelect()
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onPointerDown={start}
        onPointerUp={() => end(true)}
        onPointerLeave={() => end(false)}
        onPointerCancel={() => end(false)}
        // Keyboard: Enter/Space switch, like a tap.
        onClick={(e) => {
          if (e.detail === 0) onSelect()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setHint(true)
          if (hintTimer.current) clearTimeout(hintTimer.current)
          hintTimer.current = setTimeout(() => setHint(false), HINT_MS)
        }}
        aria-current={active ? 'true' : undefined}
        className={`relative flex h-12 items-center justify-between overflow-hidden rounded-sb px-4 text-base font-medium ${
          active ? 'bg-accent text-accent-ink' : 'bg-control text-ink-soft hover:bg-control-hover'
        }`}
      >
        {/* Fills over the hold time - the press visibly "loads" towards editing. */}
        <span
          aria-hidden
          data-testid="dashboard-hold-progress"
          className={`absolute inset-y-0 left-0 ${active ? 'bg-black/20' : 'bg-accent'}`}
          style={{ width: holding ? '100%' : '0%', transition: holding ? `width ${FILL_MS}ms linear` : 'none' }}
        />
        <span className={`relative truncate ${holding && !active ? 'text-accent-ink' : ''}`}>{dashboard.name}</span>
        <span className="relative flex items-center gap-2">
          {locked && <Icon name="locked" size="1.1rem" label="Vorlage" />}
          {active && <Icon name="check" size="1.25rem" />}
        </span>
      </button>
      {hint && <p className="text-xs text-accent">Zum Bearbeiten gedrückt halten</p>}
    </div>
  )
}

/** "Ordnen": drag handle, name, eye (hide on this device). */
function ArrangeRow({ dashboard, hidden, canHide, onToggleHidden }: { dashboard: Dashboard; hidden: boolean; canHide: boolean; onToggleHidden: (hide: boolean) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: dashboard.id })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex h-12 items-center gap-2 rounded-sb bg-control pr-1 text-base ${isDragging ? 'opacity-50' : ''}`}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        style={{ touchAction: 'none' }}
        className="flex h-12 w-12 flex-shrink-0 cursor-grab items-center justify-center text-ink-faint active:cursor-grabbing"
        aria-label={`„${dashboard.name}“ ziehen zum Sortieren`}
      >
        ⠿
      </button>
      <span className={`min-w-0 flex-1 truncate ${hidden ? 'text-ink-faint line-through' : 'text-ink-soft'}`}>{dashboard.name}</span>
      <button
        type="button"
        aria-pressed={!hidden}
        disabled={!hidden && !canHide}
        onClick={() => onToggleHidden(!hidden)}
        aria-label={hidden ? `„${dashboard.name}“ einblenden` : `„${dashboard.name}“ ausblenden`}
        className="flex h-10 w-12 flex-shrink-0 items-center justify-center rounded-sb-sm text-ink-soft hover:bg-control-hover disabled:opacity-30"
      >
        <Icon name={hidden ? 'eyeOff' : 'eye'} size="1.3rem" />
      </button>
    </li>
  )
}

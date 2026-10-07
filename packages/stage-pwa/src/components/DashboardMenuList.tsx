import { useState } from 'react'
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
import { Button, IconButton } from './ui'
import { CONTROL, DISABLED, FOCUS, HOVER, SELECTED } from './ui/styles'

/**
 * The dashboards in the main menu (Marco's dashboard editing redesign, replacing "Dashboards
 * verwalten" and the separate "Bearbeiten" lock):
 * - tap an entry: switch to it;
 * - the pen beside it: open it in edit mode - the bar at the top then has everything else (Marco,
 *   2026-10-07: replaces holding until it filled up, which nobody could see and the browser's
 *   long-press kept interrupting);
 * - a template a musician can't change (#16) shows a lock; its pen offers an own copy instead;
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
            onEdit={() => void edit(dashboard)}
          />
        ))
      )}
      <div className="mt-1 grid grid-cols-2 gap-2">
        {/* Just "Neu" under the "Dashboards" heading - the long label wrapped at stage size. */}
        <Button size="stage" icon="add" aria-label="Neues Dashboard" onClick={() => void createNew()} disabled={arranging}>
          Neu
        </Button>
        {/* "Ordnen beenden", not "Fertig": "Fertig" is the menu's own way out (docs/15 D6). */}
        <Button size="stage" variant={arranging ? 'primary' : 'secondary'} aria-pressed={arranging} onClick={() => setArranging(!arranging)}>
          {arranging ? 'Ordnen beenden' : 'Ordnen'}
        </Button>
      </div>
      {!arranging && <p className="text-sm text-ink-faint">Tippen wechselt, der Stift bearbeitet.</p>}
      {arranging && <p className="text-sm text-ink-faint">Ziehen sortiert, das Auge blendet aus - nur auf diesem Gerät.</p>}
    </div>
  )
}

/** One dashboard in the menu: a tap on the name switches, the pen opens it for editing. */
function DashboardEntry({ dashboard, active, locked, onSelect, onEdit }: { dashboard: Dashboard; active: boolean; locked: boolean; onSelect: () => void; onEdit: () => void }) {
  return (
    <div className="flex items-stretch gap-2">
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={`flex h-stage min-w-0 flex-1 items-center gap-2 px-4 text-left text-lg ${CONTROL} ${FOCUS} ${
          active ? SELECTED : `bg-control text-ink-soft ${HOVER}`
        }`}
      >
        <span className="truncate">{dashboard.name}</span>
        {locked && <Icon name="locked" size="1.1rem" label="Vorlage" />}
      </button>
      <IconButton icon="edit" size="stage" variant="secondary" label={`„${dashboard.name}“ bearbeiten`} onClick={onEdit} />
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
      className={`flex h-stage items-center gap-2 bg-control pr-1 text-lg ${CONTROL} ${isDragging ? 'opacity-50' : ''}`}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        style={{ touchAction: 'none' }}
        className="flex h-stage w-stage flex-shrink-0 cursor-grab items-center justify-center text-ink-faint active:cursor-grabbing"
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
        className={`flex h-form w-form flex-shrink-0 items-center justify-center text-ink-soft ${CONTROL} ${FOCUS} ${HOVER} ${DISABLED}`}
      >
        <Icon name={hidden ? 'eyeOff' : 'eye'} size="1.3rem" />
      </button>
    </li>
  )
}

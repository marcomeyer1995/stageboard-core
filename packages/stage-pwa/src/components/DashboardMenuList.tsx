import { useEffect, useState } from 'react'
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
import { AddRow, Button } from './ui'
import { CONTROL, DISABLED, FOCUS, HOVER, SELECTED } from './ui/styles'

/**
 * The dashboards in the main menu (Marco's dashboard editing redesign, replacing "Dashboards
 * verwalten" and the separate "Bearbeiten" lock):
 * - tap an entry: switch to it - that's all the list does normally;
 * - "Bearbeiten" (Marco, 2026-10-07: everything that changes the list behind one barrier,
 *   replacing hold-until-filled and a separate pen button per row): each row then shows a drag
 *   handle (reorder), an eye (hide) - both per device, every musician arranges their own menu -
 *   and a pen that opens it in edit mode; a template a musician can't change (#16) shows a lock
 *   and its pen offers an own copy instead; "Neues Dashboard" appears below.
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
  const alert = useDialogStore((state) => state.alert)
  const profile = useActiveProfile()
  const roles = profile?.stageRoles ?? []
  // Back from editing a dashboard that was opened here: the list comes back in "Bearbeiten".
  const [arranging, setArranging] = useState(() => useEditModeStore.getState().reopenMenuEditing)
  const consumeReopenMenu = useEditModeStore((state) => state.consumeReopenMenu)
  useEffect(() => consumeReopenMenu(), [consumeReopenMenu])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function openForEditing(id: string) {
    setActive(workspaceId, id)
    setEditing(true, { fromMenu: true })
    onEdit()
  }

  async function edit(dashboard: Dashboard) {
    if (canEditDashboard(dashboard, roles)) {
      openForEditing(dashboard.id)
      return
    }
    // A template (#16): the musician's own copy instead.
    // Without a profile there is nobody to own the copy - say so instead of doing nothing (#422 review).
    if (!profile) {
      void alert(`„${dashboard.name}“ ist eine Vorlage. Für eine eigene Kopie zuerst ein Profil wählen (Menü → Band).`)
      return
    }
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
            <ul className="flex flex-col gap-1" aria-label="Dashboards bearbeiten">
              {listed.map((dashboard) => (
                <ArrangeRow
                  key={dashboard.id}
                  dashboard={dashboard}
                  locked={!canEditDashboard(dashboard, roles)}
                  onEdit={() => void edit(dashboard)}
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
          />
        ))
      )}
      {/* Everything that changes the list sits behind one "Bearbeiten" (Marco, 2026-10-07):
          normally the list only switches. "Bearbeiten beenden", not "Fertig" - "Fertig" is the
          menu's own way out (docs/15 D6). */}
      {arranging && (
        <AddRow label="Neues Dashboard" onClick={() => void createNew()} />
      )}
      <Button size="stage" icon={arranging ? undefined : 'edit'} variant={arranging ? 'primary' : 'secondary'} aria-pressed={arranging} fullWidth onClick={() => setArranging(!arranging)} className="mt-1">
        {arranging ? 'Bearbeiten beenden' : 'Bearbeiten'}
      </Button>
      {arranging && <p className="text-sm text-ink-faint">Stift öffnet ein Dashboard zum Bearbeiten. Ziehen sortiert, das Auge blendet aus - beides nur auf diesem Gerät.</p>}
    </div>
  )
}

/** One dashboard in the menu: a tap switches to it - editing sits behind "Bearbeiten". */
function DashboardEntry({ dashboard, active, locked, onSelect }: { dashboard: Dashboard; active: boolean; locked: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className={`flex h-stage min-w-0 items-center gap-2 px-4 text-left text-lg ${CONTROL} ${FOCUS} ${active ? SELECTED : `bg-control text-ink-soft ${HOVER}`}`}
    >
      <span className="truncate">{dashboard.name}</span>
      {locked && <Icon name="locked" size="1.1rem" label="Vorlage" />}
    </button>
  )
}

/** "Bearbeiten": drag handle, name, eye (hide on this device), pen (open it in edit mode). */
function ArrangeRow({ dashboard, locked, hidden, canHide, onToggleHidden, onEdit }: { dashboard: Dashboard; locked: boolean; hidden: boolean; canHide: boolean; onToggleHidden: (hide: boolean) => void; onEdit: () => void }) {
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
      <span className={`flex min-w-0 flex-1 items-center gap-2 ${hidden ? 'text-ink-faint line-through' : 'text-ink-soft'}`}>
        <span className="truncate">{dashboard.name}</span>
        {locked && <Icon name="locked" size="1.1rem" label="Vorlage" />}
      </span>
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
      <button
        type="button"
        onClick={onEdit}
        aria-label={`„${dashboard.name}“ bearbeiten`}
        className={`flex h-form w-form flex-shrink-0 items-center justify-center text-ink-soft ${CONTROL} ${FOCUS} ${HOVER}`}
      >
        <Icon name="edit" size="1.3rem" />
      </button>
    </li>
  )
}

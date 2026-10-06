import { useEffect, useRef, useState } from 'react'
import { useEditModeStore } from '../store/useEditModeStore'
import { Icon } from './Icon'
import { useModeDashboards } from '../lib/useModeDashboards'
import { useActiveProfile } from '../lib/useActiveProfile'
import { canEditDashboard } from '../lib/dashboardLayout'
import { useDashboardsStore } from '../store/useDashboardsStore'
import { useActiveDashboardStore } from '../store/useActiveDashboardStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

const LONG_PRESS_MS = 600
/** How long the "hold it" hint stays after a too-short tap, ms. */
const HINT_MS = 2500

interface EditLockProps {
  /** Fires once the long-press completes and editing actually unlocks - lets AppMenu
   * close itself so the newly-unlocked dashboard is immediately visible. */
  onUnlock?: () => void
}

/**
 * docs/07's "Edit-Lock": unlocking the dashboard takes a deliberate long press, not a tap.
 * On stage a stray finger must not be able to start rearranging widgets. Lives inside
 * AppMenu, not as its own corner button - a corner button sat exactly where a
 * bottom-of-grid widget's resize handle needed to be, and unlocking isn't done often
 * enough to earn permanent screen space anyway (exiting is still one tap: the edit
 * toolbar's own "Bearbeiten beenden" button, shown the whole time editing is unlocked).
 *
 * The button fills up while it is held, and a too-short tap says what to do instead of silently
 * doing nothing - the only hint used to be a tooltip, which never shows on a touchscreen (GUI
 * audit 2026-09-26: a tap "looked broken").
 */
export function EditLock({ onUnlock }: EditLockProps) {
  const { active } = useModeDashboards()
  const profile = useActiveProfile()
  const roles = profile?.stageRoles ?? []
  const duplicate = useDashboardsStore((state) => state.duplicate)
  const setActiveDashboard = useActiveDashboardStore((state) => state.setActive)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const [copying, setCopying] = useState(false)
  const editable = !active || canEditDashboard(active, roles)
  const isEditing = useEditModeStore((state) => state.isEditing)
  const setEditing = useEditModeStore((state) => state.setEditing)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pressing, setPressing] = useState(false)
  const [hint, setHint] = useState(false)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      if (hintTimer.current) clearTimeout(hintTimer.current)
    },
    [],
  )

  function start() {
    if (isEditing) return
    setPressing(true)
    setHint(false)
    timer.current = setTimeout(() => {
      timer.current = null
      setEditing(true)
      setPressing(false)
      onUnlock?.()
    }, LONG_PRESS_MS)
  }

  function cancel(tooShort: boolean) {
    // Still pending = released before the unlock fired.
    if (timer.current && tooShort) {
      setHint(true)
      if (hintTimer.current) clearTimeout(hintTimer.current)
      hintTimer.current = setTimeout(() => setHint(false), HINT_MS)
    }
    setPressing(false)
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  if (isEditing) return null

  // A read-only template (#16): no long-press unlock for non-admins - say why and what to do.
  if (!editable) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex h-12 w-full items-center justify-between rounded-sb bg-control px-4 text-base text-ink-faint" aria-disabled="true">
          Bearbeiten
          <Icon name="locked" size="1.4rem" />
        </div>
        <p className="text-sm text-ink-muted">Vorlage - nur Admins ändern sie.</p>
        {/* The way out even when every dashboard is a template (Marco): without edit mode a
            musician never reached "Dashboards verwalten" and its "Duplizieren". A private copy
            changes nothing for anyone else, so one tap is enough. */}
        <button
          type="button"
          disabled={!profile || copying}
          onClick={async () => {
            if (!active || !profile) return
            setCopying(true)
            const copy = await duplicate(active.id, `${active.name} Kopie`, profile.id)
            setCopying(false)
            if (!copy) return
            setActiveDashboard(workspaceId, copy.id)
            setEditing(true)
            onUnlock?.()
          }}
          className="flex h-12 w-full items-center justify-between rounded-sb bg-control px-4 text-base text-ink hover:bg-control-hover disabled:opacity-40"
        >
          Eigene Kopie bearbeiten
          <Icon name="unlocked" size="1.4rem" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        title="Zum Entsperren gedrückt halten"
        onPointerDown={start}
        onPointerUp={() => cancel(true)}
        onPointerLeave={() => cancel(false)}
        onPointerCancel={() => cancel(false)}
        onContextMenu={(e) => e.preventDefault()}
        className="relative flex h-12 w-full items-center justify-between overflow-hidden rounded-sb bg-control px-4 text-base text-ink-soft hover:bg-control-hover"
      >
        {/* Fills left to right over the hold time - the press visibly "loads". */}
        <span
          aria-hidden
          data-testid="edit-lock-progress"
          className="absolute inset-y-0 left-0 bg-accent"
          style={{
            width: pressing ? '100%' : '0%',
            transition: pressing ? `width ${LONG_PRESS_MS}ms linear` : 'none',
          }}
        />
        <span className={`relative ${pressing ? 'text-accent-ink' : ''}`}>Bearbeiten</span>
        <Icon name="locked" size="1.4rem" className="relative" />
      </button>
      {hint && (
        <p role="status" className="text-sm text-accent">
          Zum Bearbeiten gedrückt halten
        </p>
      )}
    </div>
  )
}

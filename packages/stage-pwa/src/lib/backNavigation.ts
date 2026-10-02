import { useEffect, useRef } from 'react'

/**
 * In-app "Back" (#341). StageBoard has no URL routing - views are component state - so the
 * browser's Back (Android back gesture/button, touchpad swipe, mouse back button, Alt+Left) used
 * to leave the app entirely: mid-gig the show view vanished, an open editor lost its unsaved edits.
 *
 * Now the app keeps one history entry of its own on top (`installBackGuard`). A Back lands on the
 * entry below it, which this module notices (`popstate`), immediately steps forward onto the guard
 * again and closes the current view instead: the topmost registered handler (`useBackHandler`) runs. With
 * no handler (dashboard / show view), Back does nothing.
 *
 * "Topmost" = activated last. The order is taken during render at the moment a handler becomes
 * active: across interactions that is "opened later wins" (a confirm dialog from the app-wide
 * DialogHost, mounted at start, still sits above the editor that opened it), and within one
 * render pass it is parent before child (an editor and its sub-view mounting together - the
 * sub-view wins). Effects can't give that order: they run child before parent.
 */

interface Handler {
  order: number
  onBack: () => void
}

const handlers = new Set<Handler>()
let nextOrder = 0

const GUARD = { stageboardBackGuard: true }

function isGuard(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as Record<string, unknown>).stageboardBackGuard === true
}

/** Runs the topmost handler. Returns false when there is none. Exported for tests. */
export function handleBack(): boolean {
  let top: Handler | null = null
  for (const h of handlers) if (!top || h.order > top.order) top = h
  if (!top) return false
  top.onBack()
  return true
}

/**
 * Registers `onBack` as "close this view" while the component is mounted and `onBack` is not
 * null. Always calls the latest `onBack` (no stale closures).
 */
export function useBackHandler(onBack: (() => void) | null): void {
  const latest = useRef(onBack)
  latest.current = onBack
  const active = onBack !== null
  const order = useRef(0)
  const wasActive = useRef(false)
  if (active && !wasActive.current) order.current = ++nextOrder
  wasActive.current = active
  useEffect(() => {
    if (!active) return
    const handler: Handler = { order: order.current, onBack: () => latest.current?.() }
    handlers.add(handler)
    return () => {
      handlers.delete(handler)
    }
  }, [active])
}

/**
 * Installs the history guard once, at start-up. The guard entry is pushed on the first user
 * interaction, not right away: Chrome skips history entries a page added without a user gesture
 * when going Back, so an entry pushed at load would not catch anything.
 */
export function installBackGuard(win: Window = window): () => void {
  const arm = () => {
    if (!isGuard(win.history.state)) win.history.pushState(GUARD, '')
  }
  const onActivation = () => arm()
  const onPopState = (e: PopStateEvent) => {
    if (isGuard(e.state)) return // Forward onto our own guard entry - nothing to do.
    // Back left the guard entry: step forward onto it again, then close the current view.
    // Forward, not a fresh pushState: an entry pushed here has no user gesture behind it, and
    // Chrome skips such entries on the next Back - two Backs in a row would then leave the app
    // (Android) or do nothing. The original entry was pushed during a tap, so it keeps counting.
    win.history.forward()
    handleBack()
  }
  win.addEventListener('pointerdown', onActivation, true)
  win.addEventListener('keydown', onActivation, true)
  win.addEventListener('popstate', onPopState)
  return () => {
    win.removeEventListener('pointerdown', onActivation, true)
    win.removeEventListener('keydown', onActivation, true)
    win.removeEventListener('popstate', onPopState)
  }
}

/** While `active`, reloading or closing the tab asks first (browser's own "Leave page?"). */
export function useUnsavedChangesWarning(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [active])
}

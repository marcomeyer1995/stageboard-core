/**
 * Live trace for the widget-config write pipeline (slider drag -> debounced commit ->
 * useDashboardsStore.updateWidget -> workspaceCollection's conflict-retry write -> local
 * changes() feed -> (if configured) remote CouchDB sync echo -> re-render). Built to track
 * down a config value visibly oscillating for several seconds after being changed (Marco,
 * 2026-09-14) - same "off by default, flip a localStorage key" pattern as gridDebug.ts's
 * drag/resize trace. Enable from the devtools console with
 * `localStorage.setItem('sb:debug:config', '1')` and reload, disable by removing the key.
 */
const KEY = 'sb:debug:config'

export function configDebugEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** ms since page load, monotonic - easier to eyeball deltas between log lines than wall-clock
 * timestamps, and unaffected by clock-sync offset weirdness. */
function t(): string {
  return `${(performance.now() / 1000).toFixed(3)}s`
}

export function configLog(...args: unknown[]): void {
  if (configDebugEnabled()) console.log(`[config ${t()}]`, ...args)
}

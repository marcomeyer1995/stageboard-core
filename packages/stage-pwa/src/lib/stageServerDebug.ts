/**
 * Live trace for the Stage-Server status fetches (useStageServerStatus.ts) - built to answer "why
 * did Settings sit on 'Lade…' for 30 seconds when the server answers in 3 ms?": for each request
 * it logs the total time and, from the browser's own resource timing, where that time went -
 * `blocked` (queued behind other requests / connecting), `server` (waiting for the answer),
 * `transfer`, and `js-continuation` (how long after the response had fully arrived our own code
 * got to run - a busy main thread shows up here), plus the browser's network estimate, the
 * event-loop lag and any long tasks during the fetch.
 *
 * Off by default. Turn it on with the "Diagnose" switch in Settings (StageServerDiagnostics.tsx) -
 * which sets the `sb:debug:stageServer` localStorage flag this file reads on every call, so no reload
 * is needed - or from a devtools console with `localStorage.setItem('sb:debug:stageServer', '1')`
 * (docs/03 section 1a: same flag pattern as gridDebug.ts, copied per feature on purpose).
 *
 * Lines also go into a small in-memory ring buffer the Settings screen displays, because a tablet
 * without adb debugging has no console to read them from.
 */
const KEY = 'sb:debug:stageServer'
const MAX_LINES = 80

export interface StageServerLogLine {
  id: number
  at: number
  text: string
}

let lines: StageServerLogLine[] = []
let nextId = 1
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((listener) => listener())
}

export function stageServerDebugEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setStageServerDebugEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // Storage unavailable (private mode, blocked): nothing to persist, the switch just won't stick.
  }
  notify()
}

export function stageServerLog(...args: unknown[]): void {
  if (!stageServerDebugEnabled()) return
  console.log('[stageServer]', ...args)
  lines = [...lines, { id: nextId++, at: Date.now(), text: args.map(String).join(' ') }].slice(-MAX_LINES)
  notify()
}

export function getStageServerLogLines(): StageServerLogLine[] {
  return lines
}

export function clearStageServerLog(): void {
  lines = []
  notify()
}

/** For `useSyncExternalStore` - fires on every new line, clear, and on/off toggle. */
export function subscribeStageServerLog(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

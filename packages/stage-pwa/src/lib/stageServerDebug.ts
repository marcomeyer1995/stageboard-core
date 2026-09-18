/**
 * Live trace for the Stage-Server status fetches (useStageServerStatus.ts) - built to answer "why
 * did Settings sit on 'Lade…' for 30 seconds when the server answers in 3 ms?": for each request
 * it logs the total time and, from the browser's own resource timing, where that time went -
 * `blocked` (queued behind other requests / connecting), `server` (waiting for the answer),
 * `transfer`, and `js-continuation` (how long after the response had fully arrived our own code
 * got to run - a busy main thread shows up here). Off by default. Enable from the devtools console
 * with `localStorage.setItem('sb:debug:stageServer', '1')` and reload, disable by removing the key
 * (docs/03 section 1a: same pattern as gridDebug.ts, copied per feature on purpose).
 */
const KEY = 'sb:debug:stageServer'

export function stageServerDebugEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function stageServerLog(...args: unknown[]): void {
  if (stageServerDebugEnabled()) console.log('[stageServer]', ...args)
}

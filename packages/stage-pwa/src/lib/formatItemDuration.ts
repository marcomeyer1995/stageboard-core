/** Transition-item durations are entered and shown in whole seconds (Marco, #29 follow-up). */
export function formatItemSeconds(ms: number): string {
  return `${Math.round(ms / 1000)} s`
}

/** Seconds left of a countdown, never negative. */
export function remainingSeconds(totalMs: number, elapsedMs: number | null): number {
  return Math.max(0, Math.ceil((totalMs - Math.max(0, elapsedMs ?? 0)) / 1000))
}

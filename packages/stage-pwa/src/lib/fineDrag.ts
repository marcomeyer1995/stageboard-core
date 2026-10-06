/**
 * Fine mode for dragging and scrubbing on the timeline (#334), like the fine mode of a touch
 * mixer: the further the finger moves up or down from where the drag started (beyond a dead zone),
 * the less a horizontal movement counts.
 */
export const FINE_DEAD_ZONE_PX = 40
const FINE_SLOPE = 0.05

/** How much a horizontal step counts at vertical distance `dy` from the start: 1 inside the dead
 * zone, then 1 / (1 + beyond * 0.05) - 100 px beyond it is 1/6, 200 px is 1/11. */
export function fineFactor(dy: number): number {
  const beyond = Math.abs(dy) - FINE_DEAD_ZONE_PX
  return beyond <= 0 ? 1 : 1 / (1 + beyond * FINE_SLOPE)
}

/** The next effective x: each step is scaled by the factor at the moment it happens, so moving the
 * finger up or down never makes the dragged thing jump - only the following steps get finer. */
export function fineStep(effectiveX: number, lastRawX: number, rawX: number, factor: number): number {
  return effectiveX + (rawX - lastRawX) * factor
}

/** "1:6" - shown next to the finger while fine mode is on. */
export function fineRatioLabel(factor: number): string {
  return `1:${Math.round(1 / factor)}`
}

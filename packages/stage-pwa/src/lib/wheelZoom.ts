/**
 * How much one wheel event zooms (Marco, 2026-11-07: on the laptop's touchpad pinch and two-finger
 * scroll zoomed far too fast). A touchpad sends dozens of small deltas per gesture where a mouse
 * sends one of ~100 per notch - zoom in proportion to the delta, so a notch stays ~15 % and a
 * touchpad gesture is smooth; one event never more than ~16 %.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  return Math.exp(Math.max(-100, Math.min(100, px)) * 0.0014)
}

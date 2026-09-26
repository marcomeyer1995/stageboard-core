/**
 * Stage size floor for computed font sizes (GUI audit 2026-09-26: everything on screen must be
 * readable on stage at arm's length). Widgets size their text as the device "Textgröße" times a
 * per-element ratio (SizeRatioSlider); small ratios used to produce 9-12px labels. This keeps
 * every such size at or above --sb-text-min (16px) without changing how ratios above it scale.
 * Tailwind's text-xs / text-sm share the same floor (tailwind.config.js).
 */
export const STAGE_MIN_TEXT_PX = 16

export function stageFontSize(px: number): number {
  return Math.max(STAGE_MIN_TEXT_PX, px)
}

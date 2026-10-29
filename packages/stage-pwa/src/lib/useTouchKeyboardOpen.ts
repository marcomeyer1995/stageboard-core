import { useSettledVisualViewport, useVisualViewport, type VisualViewportBox } from './useVisualViewport'

/** Below this share of the screen height the visible area counts as squeezed by a keyboard. */
const KEYBOARD_SHARE = 0.75

/**
 * An on-screen keyboard is up on a touchscreen (#606): the visible area is clearly shorter than
 * the screen. Shared by the ChordPro key bar and the editor, which leaves the bar its room.
 */
export function useTouchKeyboardOpen(): boolean {
  return keyboardOpenIn(useVisualViewport())
}

/** The same once the visible area held still (useSettledVisualViewport) - for the key bar. */
export function useSettledTouchKeyboardOpen(): boolean {
  return keyboardOpenIn(useSettledVisualViewport())
}

function keyboardOpenIn(visible: VisualViewportBox | null): boolean {
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  return touch && visible !== null && visible.height < window.screen.height * KEYBOARD_SHARE
}

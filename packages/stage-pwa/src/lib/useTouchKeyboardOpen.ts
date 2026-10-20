import { useVisualViewport } from './useVisualViewport'

/** Below this share of the screen height the visible area counts as squeezed by a keyboard. */
const KEYBOARD_SHARE = 0.75

/**
 * An on-screen keyboard is up on a touchscreen (#606): the visible area is clearly shorter than
 * the screen. Shared by the ChordPro key bar and the editor, which leaves the bar its room.
 */
export function useTouchKeyboardOpen(): boolean {
  const visible = useVisualViewport()
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  return touch && visible !== null && visible.height < window.screen.height * KEYBOARD_SHARE
}

import { create } from 'zustand'

/**
 * Device-local base text size (px) for list/scrolling-content widgets (Prompter,
 * Live-Queue, Show-Notizen, System-Status) - unlike the glanceable "single value" widgets
 * (NextSongWidget etc.), these show a variable amount of content where "shrink to fit
 * everything on screen" would make a short song's lyrics huge and a long song's tiny
 * (Marco, 2026-09-14: wanted a settable default instead of auto-fit for this shape of
 * widget - see the widget-font-autofit memory). Content that keeps scrolling is the point,
 * not something to eliminate by shrinking text.
 *
 * A single global default, overridable per widget instance via that widget's own
 * `fontSize` config field (contentFontSizeConfig.ts) - same "set once, rarely touched
 * again" device preference as useThemeStore.ts, same localStorage pattern.
 */
export const DEFAULT_CONTENT_FONT_SIZE = 18
export const MIN_CONTENT_FONT_SIZE = 12
export const MAX_CONTENT_FONT_SIZE = 48

const STORAGE_KEY = 'stageboard-content-font-size'

function readStored(): number {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY))
    if (Number.isFinite(stored) && stored >= MIN_CONTENT_FONT_SIZE && stored <= MAX_CONTENT_FONT_SIZE) {
      return stored
    }
    return DEFAULT_CONTENT_FONT_SIZE
  } catch {
    return DEFAULT_CONTENT_FONT_SIZE
  }
}

interface ContentFontSizeState {
  baseFontSize: number
  setBaseFontSize: (size: number) => void
}

export const useContentFontSizeStore = create<ContentFontSizeState>((set) => ({
  baseFontSize: readStored(),
  setBaseFontSize: (size) => {
    const clamped = Math.min(MAX_CONTENT_FONT_SIZE, Math.max(MIN_CONTENT_FONT_SIZE, Math.round(size)))
    try {
      localStorage.setItem(STORAGE_KEY, String(clamped))
    } catch {
      // Private mode / blocked storage: the setting still works for this session.
    }
    set({ baseFontSize: clamped })
  },
}))

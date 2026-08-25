import { create } from 'zustand'

export type ThemeId = 'default' | 'stage-console' | 'soft-cards' | 'high-contrast' | 'neon-live'
export type LightDark = 'dark' | 'light'

export interface ThemeOption {
  id: ThemeId
  label: string
}

/** The five visual languages from "StageBoard Look and Feel" - see docs/07 section 8. */
export const THEMES: ThemeOption[] = [
  { id: 'default', label: 'Klassisch' },
  { id: 'stage-console', label: 'Stage Console' },
  { id: 'soft-cards', label: 'Soft Cards' },
  { id: 'high-contrast', label: 'High Contrast' },
  { id: 'neon-live', label: 'Neon Live' },
]

const THEME_KEY = 'stageboard-theme-id'
/** Unchanged from before themes existed, so an upgrade keeps a user's light/dark choice. */
const LIGHT_DARK_KEY = 'stageboard-theme'

function readStoredThemeId(): ThemeId {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return THEMES.some((theme) => theme.id === stored) ? (stored as ThemeId) : 'default'
  } catch {
    return 'default'
  }
}

/** Dark is StageBoard's default (stage lighting); light is the explicit opt-in. */
function readStoredLightDark(): LightDark {
  try {
    return localStorage.getItem(LIGHT_DARK_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/**
 * Only the `default` theme has a light variant - the other four were designed for the
 * stage and a light Neon Live or High Contrast was never explored, so they always render
 * dark regardless of the stored light/dark preference.
 */
function applyTheme(themeId: ThemeId, lightDark: LightDark): void {
  const root = document.documentElement
  root.setAttribute('data-theme', themeId)
  root.classList.toggle('light', themeId === 'default' && lightDark === 'light')
  try {
    localStorage.setItem(THEME_KEY, themeId)
    localStorage.setItem(LIGHT_DARK_KEY, lightDark)
  } catch {
    // Private mode / blocked storage: the toggle still works for this session.
  }
}

interface ThemeState {
  themeId: ThemeId
  lightDark: LightDark
  setThemeId: (themeId: ThemeId) => void
  toggleLightDark: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  themeId: readStoredThemeId(),
  lightDark: readStoredLightDark(),
  setThemeId: (themeId) => {
    applyTheme(themeId, get().lightDark)
    set({ themeId })
  },
  toggleLightDark: () => {
    const next: LightDark = get().lightDark === 'dark' ? 'light' : 'dark'
    applyTheme(get().themeId, next)
    set({ lightDark: next })
  },
}))

/** Applies the stored theme before the first render, so the app never flashes the wrong one. */
export function initTheme(): void {
  const { themeId, lightDark } = useThemeStore.getState()
  document.documentElement.setAttribute('data-theme', themeId)
  document.documentElement.classList.toggle('light', themeId === 'default' && lightDark === 'light')
}

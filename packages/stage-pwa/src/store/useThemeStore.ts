import { create } from 'zustand'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'stageboard-theme'

/** Dark is StageBoard's default (stage lighting); light is the explicit opt-in. */
function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('light', theme === 'light')
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Private mode / blocked storage: the toggle still works for this session.
  }
}

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggle: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  },
  toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}))

/** Applies the stored theme before the first render, so the app never flashes the wrong one. */
export function initTheme(): void {
  document.documentElement.classList.toggle('light', useThemeStore.getState().theme === 'light')
}

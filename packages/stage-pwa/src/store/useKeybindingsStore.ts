import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { assignKey, DEFAULT_KEYBINDINGS, removeKey, type FootswitchAction, type Keybindings } from '../lib/keybindings'

interface KeybindingsState {
  bindings: Keybindings
  assign: (action: FootswitchAction, key: string) => void
  remove: (action: FootswitchAction, key: string) => void
  reset: () => void
}

/** Foot switch / keyboard mapping (#27) - per device, like the pedal paired to it. */
export const useKeybindingsStore = create<KeybindingsState>()(
  persist(
    (set) => ({
      bindings: DEFAULT_KEYBINDINGS,
      assign: (action, key) => set((state) => ({ bindings: assignKey(state.bindings, action, key) })),
      remove: (action, key) => set((state) => ({ bindings: removeKey(state.bindings, action, key) })),
      reset: () => set({ bindings: DEFAULT_KEYBINDINGS }),
    }),
    {
      name: 'stageboard-keybindings',
      merge: (persisted, current) => ({
        ...current,
        bindings: { ...DEFAULT_KEYBINDINGS, ...((persisted as Partial<KeybindingsState>)?.bindings ?? {}) },
      }),
    },
  ),
)

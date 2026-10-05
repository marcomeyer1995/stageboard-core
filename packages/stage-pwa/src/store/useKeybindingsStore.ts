import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_KEYBINDINGS, removeBinding, upsertBinding, type KeyBinding, type Keybindings } from '../lib/keybindings'

interface KeybindingsState {
  bindings: Keybindings
  /** Adds or replaces a mapping; `replacesKey` when an edited mapping got a different key. */
  save: (binding: KeyBinding, replacesKey?: string) => void
  remove: (key: string) => void
  clear: () => void
}

/** Foot switch / keyboard mapping (#27) - per device, like the pedal paired to it. */
export const useKeybindingsStore = create<KeybindingsState>()(
  persist(
    (set) => ({
      bindings: DEFAULT_KEYBINDINGS,
      save: (binding, replacesKey) => set((state) => ({ bindings: upsertBinding(state.bindings, binding, replacesKey) })),
      remove: (key) => set((state) => ({ bindings: removeBinding(state.bindings, key) })),
      clear: () => set({ bindings: [] }),
    }),
    {
      name: 'stageboard-keybindings',
      // Version 2: a list of mappings (fixed or per song state) instead of keys per action, and
      // nothing pre-assigned - the old per-action defaults are not carried over.
      version: 2,
      migrate: () => ({ bindings: DEFAULT_KEYBINDINGS }),
    },
  ),
)

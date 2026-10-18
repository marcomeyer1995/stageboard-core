import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { bindingFromV2, DEFAULT_KEYBINDINGS, removeBinding, upsertBinding, type KeyAction, type KeyBinding, type Keybindings } from '../lib/keybindings'

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
      // Version 3 (docs/23): each mapping an action with press/release behaviour - version 2
      // mappings are converted, so a pedal keeps working.
      // Version 4: the named "Abläufe" are gone (Marco, 2026-10-18: not used productively) - a
      // mapping that started one is dropped, everything else stays.
      version: 4,
      migrate: (persisted, version) => {
        if (version === 3) {
          const bindings = (persisted as { bindings?: KeyBinding[] } | null)?.bindings ?? []
          return { bindings: bindings.filter((b) => !JSON.stringify(b.behavior).includes('"kind":"sequence"')) }
        }
        if (version === 2) {
          const old = (persisted as { bindings?: { key: string; action: KeyAction }[] } | null)?.bindings ?? []
          return { bindings: old.filter((b) => b && typeof b.key === 'string' && b.action).map(bindingFromV2) }
        }
        return { bindings: DEFAULT_KEYBINDINGS }
      },
    },
  ),
)

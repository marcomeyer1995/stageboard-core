import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_STATUS_BAR_ORDER, normalizeStatusBarOrder, type StatusBarItem } from '../lib/statusBarItems'

interface StatusBarPrefs {
  /** Most important first - the bar gives items up from the end when room runs out. */
  order: StatusBarItem[]
  /** Never shown on this device, room or not. */
  hidden: StatusBarItem[]
  move: (item: StatusBarItem, by: -1 | 1) => void
  setShown: (item: StatusBarItem, shown: boolean) => void
  reset: () => void
}

/** The status bar's ranking on this device (lib/statusBarItems.ts) - a per-device view setting. */
export const useStatusBarPrefsStore = create<StatusBarPrefs>()(
  persist(
    (set, get) => ({
      order: [...DEFAULT_STATUS_BAR_ORDER],
      hidden: [],
      move: (item, by) => {
        const order = [...get().order]
        const from = order.indexOf(item)
        const to = from + by
        if (from < 0 || to < 0 || to >= order.length) return
        order.splice(from, 1)
        order.splice(to, 0, item)
        set({ order })
      },
      setShown: (item, shown) => {
        const hidden = get().hidden.filter((h) => h !== item)
        set({ hidden: shown ? hidden : [...hidden, item] })
      },
      reset: () => set({ order: [...DEFAULT_STATUS_BAR_ORDER], hidden: [] }),
    }),
    {
      name: 'stageboard-status-bar',
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<Pick<StatusBarPrefs, 'order' | 'hidden'>>
        return { ...current, order: normalizeStatusBarOrder(stored.order), hidden: (stored.hidden ?? []).filter((h) => normalizeStatusBarOrder([]).includes(h)) }
      },
    },
  ),
)

import { createContext, useContext, type ReactNode } from 'react'

/** One piece of information a widget can leave out ("Anzeigen" in its ⋯ menu). */
export interface WidgetPart {
  id: string
  label: string
}

const HiddenParts = createContext<readonly string[]>([])

/** Set by WidgetFrame around a widget's content: the parts switched off for this instance. */
export function WidgetPartsProvider({ hidden, children }: { hidden: readonly string[]; children: ReactNode }) {
  return <HiddenParts.Provider value={hidden}>{children}</HiddenParts.Provider>
}

/**
 * Whether a widget shows one of its parts (Marco, 2026-10-17: every widget can declutter, all the
 * same way - one "Anzeigen" chip group in the ⋯ menu, built from the registry's `parts`).
 */
export function useShowPart(id: string): boolean {
  return !useContext(HiddenParts).includes(id)
}

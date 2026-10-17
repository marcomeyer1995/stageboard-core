import { createContext, useContext, type ReactNode } from 'react'
import { COMPACT_TOUCH, STAGE_TOUCH, type TouchSizes } from '../../lib/gigWidgetLayout'
import type { ControlSize } from './styles'

const PrepContext = createContext(false)

/**
 * The Vorbereitung size tier (docs/15 D10, Marco 2026-10-16): Bibliothek, editors, System, dialogs
 * and wizards - what is set up before the gig, not touched on stage. Inside it, controls without
 * an explicit size are 40 px (hit area still 48) and secondary lines 14 px, so more fits without
 * squeezing. `on={false}` switches back to stage sizes inside (the ☰ drawer).
 */
export function PrepTier({ on = true, className = 'contents', children }: { on?: boolean; className?: string; children: ReactNode }) {
  return (
    <PrepContext.Provider value={on}>
      <div className={on ? `sb-prep ${className}` : className}>{children}</div>
    </PrepContext.Provider>
  )
}

/** A control's size: what the caller asked for, else the tier's default. */
export function useControlSize(size: ControlSize | undefined): ControlSize {
  const prep = useContext(PrepContext)
  return size ?? (prep ? 'prep' : 'form')
}

/** Whether this part of the screen is in the Vorbereitung tier. */
export function useIsPrepTier(): boolean {
  return useContext(PrepContext)
}

const CompactContext = createContext(false)

/**
 * A widget switched to "Kompakt" in its ⋯ menu (docs/15 D10, Marco 2026-10-17): its stage controls
 * are 48 px instead of 56 / 72 (the .sb-compact variables), and it lays itself out for 48
 * (useTouchSizes). Chosen per widget, visibly - not derived from where the dashboard is offered.
 */
export function CompactTier({ on, className, children }: { on: boolean; className: string; children: ReactNode }) {
  return (
    <CompactContext.Provider value={on}>
      <div className={on ? `sb-compact ${className}` : className}>{children}</div>
    </CompactContext.Provider>
  )
}

/** The control sizes widgets here lay themselves out for. */
export function useTouchSizes(): TouchSizes {
  return useContext(CompactContext) ? COMPACT_TOUCH : STAGE_TOUCH
}

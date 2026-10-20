import { useEffect, useState } from 'react'
import { isTyping } from './useKeyboardSteadyHeight'

function computeIsPanelLayout(): boolean {
  return (
    window.matchMedia('(min-width: 1024px)').matches ||
    (window.matchMedia('(min-width: 768px)').matches && window.matchMedia('(orientation: landscape)').matches)
  )
}

/**
 * Shared "is there room for a real two-pane layout" threshold - true at plain desktop widths
 * (min-width: 1024px) or once a landscape screen is at least tablet-width (min-width: 768px +
 * landscape), since a landscape tablet already has the width for two panes well below 1024px.
 * First used by SheetEditor.tsx's own three-way screen-class split (#177) as its 'panel' tier
 * (kept local there at the time, deliberately, per that hook's own doc comment) - Bibliothek's
 * single-focus-vs-two-pane switch (#178) is the second consumer that justified extracting this
 * one threshold out into its own shared hook.
 */
export function useIsPanelLayout(): boolean {
  const [isPanel, setIsPanel] = useState(computeIsPanelLayout)

  useEffect(() => {
    const queries = [
      window.matchMedia('(min-width: 1024px)'),
      window.matchMedia('(min-width: 768px)'),
      window.matchMedia('(orientation: landscape)'),
    ]
    let width = window.innerWidth
    const update = () => {
      // The on-screen keyboard makes the page shorter - a portrait tablet then reads as landscape
      // and the editor jumped to two columns mid-typing, its text field gone (#606, Fire). Only a
      // new width (rotation) counts while a text field has the focus; leaving it re-checks.
      if (isTyping() && window.innerWidth === width) return
      width = window.innerWidth
      setIsPanel(computeIsPanelLayout())
    }
    const recheck = () => setTimeout(update, 0)
    queries.forEach((q) => q.addEventListener('change', update))
    document.addEventListener('focusout', recheck)
    return () => {
      queries.forEach((q) => q.removeEventListener('change', update))
      document.removeEventListener('focusout', recheck)
    }
  }, [])

  return isPanel
}

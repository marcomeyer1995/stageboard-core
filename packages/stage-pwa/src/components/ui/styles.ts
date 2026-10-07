/**
 * The UI system's shared class names (docs/15): one height per role, one corner per kind of
 * element, one meaning per colour. Components read from here; nothing outside `ui/` should spell
 * these out by hand (phase 5 adds a guard for that).
 */
export type ControlSize = 'show' | 'stage' | 'form'

/** Height (and matching horizontal padding / text size) of every control. */
export const SIZE: Record<ControlSize, string> = {
  show: 'min-h-show px-6 text-xl',
  stage: 'min-h-stage px-5 text-lg',
  form: 'min-h-form px-4 text-base',
}

/** Square icon-only controls, same heights. */
export const SQUARE: Record<ControlSize, string> = {
  show: 'h-show w-show',
  stage: 'h-stage w-stage',
  form: 'h-form w-form',
}

/** D1: every control takes the small "control" corner. */
export const CONTROL = 'rounded-control'
/** D1: cards, dialogs and menus take the "container" corner. */
export const CONTAINER = 'rounded-container'

/** Focus ring shared by all controls. */
export const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export const DISABLED = 'disabled:cursor-not-allowed disabled:opacity-40'

/** Yellow = chosen / on, in every choice element (D7). */
export const SELECTED = 'bg-accent text-accent-ink font-semibold'

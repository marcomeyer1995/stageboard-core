/**
 * Bluetooth foot switches (#27): AirTurn, PageFlip and similar pedals pair as a keyboard and send
 * plain keystrokes (PageUp/PageDown, arrow keys, Space, Enter). Each device maps keys to show
 * actions itself (useKeybindingsStore) - a pedal is a per-musician thing.
 */
export type FootswitchAction = 'next' | 'previous' | 'play-pause' | 'stop' | 'prompter-down' | 'prompter-up'

export const FOOTSWITCH_ACTIONS: Array<{ id: FootswitchAction; label: string }> = [
  { id: 'next', label: 'Nächster Song (Weiter)' },
  { id: 'previous', label: 'Vorheriger Song (Zurück)' },
  { id: 'play-pause', label: 'Play / Pause' },
  { id: 'stop', label: 'Stop' },
  { id: 'prompter-down', label: 'Prompter weiterblättern' },
  { id: 'prompter-up', label: 'Prompter zurückblättern' },
]

export type Keybindings = Record<FootswitchAction, string[]>

/** Most page-turner pedals send PageDown/PageUp out of the box; nothing else is pre-assigned, so
 * a laptop keyboard doesn't trigger anything by accident. */
export const DEFAULT_KEYBINDINGS: Keybindings = {
  next: ['PageDown'],
  previous: ['PageUp'],
  'play-pause': [],
  stop: [],
  'prompter-down': [],
  'prompter-up': [],
}

/** Keys that never become a binding: modifiers alone and keys the app/OS needs. */
const UNBINDABLE = new Set(['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Escape', 'CapsLock', 'Dead', 'Unidentified'])

export function isBindableKey(key: string): boolean {
  return key.length > 0 && !UNBINDABLE.has(key)
}

/** Which action a key triggers, if any. */
export function actionForKey(bindings: Keybindings, key: string): FootswitchAction | null {
  for (const { id } of FOOTSWITCH_ACTIONS) {
    if (bindings[id]?.includes(key)) return id
  }
  return null
}

/** Assigns `key` to `action`, taking it away from any other action (one key, one meaning). */
export function assignKey(bindings: Keybindings, action: FootswitchAction, key: string): Keybindings {
  const next = {} as Keybindings
  for (const { id } of FOOTSWITCH_ACTIONS) {
    const keys = (bindings[id] ?? []).filter((k) => k !== key)
    next[id] = id === action ? [...keys, key] : keys
  }
  return next
}

export function removeKey(bindings: Keybindings, action: FootswitchAction, key: string): Keybindings {
  return { ...bindings, [action]: (bindings[action] ?? []).filter((k) => k !== key) }
}

const KEY_LABEL: Record<string, string> = {
  ' ': 'Leertaste',
  PageDown: 'Bild ↓',
  PageUp: 'Bild ↑',
  ArrowDown: 'Pfeil ↓',
  ArrowUp: 'Pfeil ↑',
  ArrowLeft: 'Pfeil ←',
  ArrowRight: 'Pfeil →',
  Enter: 'Enter',
  Backspace: 'Rücktaste',
  Home: 'Pos1',
  End: 'Ende',
}

export function keyLabel(key: string): string {
  return KEY_LABEL[key] ?? (key.length === 1 ? key.toUpperCase() : key)
}

/** Keystrokes typed into a field belong to the field, never to the pedal. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type
    return !['checkbox', 'radio', 'button', 'range'].includes(type)
  }
  return false
}

/** Event the prompter listens for to page up/down (the pedal isn't wired to a widget directly). */
export const PROMPTER_SCROLL_EVENT = 'stageboard:prompter-scroll'
export type PrompterScrollDetail = { direction: 1 | -1 }

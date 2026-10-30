import i18n from '../i18n'
import type { Action, Behavior } from './actions'
/**
 * Bluetooth foot switches (#27): AirTurn, PageFlip and similar pedals pair as a keyboard and send
 * plain keystrokes (PageUp/PageDown, arrow keys, Space, Enter). Each device maps keys to show
 * actions itself (useKeybindingsStore) - a pedal is a per-musician thing. A key has either one
 * fixed meaning or one per song state ("Je nach Zustand"), so a single pedal can run the show.
 */
/** A key with one fixed meaning. */
export type FixedAction = 'next' | 'previous' | 'play-pause' | 'stop' | 'prompter-down' | 'prompter-up'

export const FIXED_ACTIONS: Array<{ id: FixedAction; label: string }> = [
  { id: 'next', get label() { return i18n.t('actions:fixed.next') } },
  { id: 'previous', get label() { return i18n.t('actions:fixed.previous') } },
  { id: 'play-pause', get label() { return i18n.t('actions:fixed.play-pause') } },
  { id: 'stop', get label() { return i18n.t('actions:fixed.stop') } },
  { id: 'prompter-down', get label() { return i18n.t('actions:fixed.prompter-down') } },
  { id: 'prompter-up', get label() { return i18n.t('actions:fixed.prompter-up') } },
]

/** The five states a song can be in - the same the status bar shows (#27). */
export type SongState = 'ready' | 'count-in' | 'playing' | 'paused' | 'finished'

export const SONG_STATES: Array<{ id: SongState; label: string }> = [
  { id: 'ready', get label() { return i18n.t('actions:state.ready') } },
  { id: 'count-in', get label() { return i18n.t('actions:state.count-in') } },
  { id: 'playing', get label() { return i18n.t('actions:state.playing') } },
  { id: 'paused', get label() { return i18n.t('actions:state.paused') } },
  { id: 'finished', get label() { return i18n.t('actions:state.finished') } },
]

/** What a state-dependent key does in one state. */
export type StepAction = 'play' | 'pause' | 'resume' | 'stop' | 'stop-next' | 'next' | 'next-play' | 'none'

export const STEP_LABEL: Record<StepAction, string> = {
  get play() {
    return i18n.t('actions:step.play')
  },
  get pause() {
    return i18n.t('actions:step.pause')
  },
  get resume() {
    return i18n.t('actions:step.resume')
  },
  get stop() {
    return i18n.t('actions:step.stop')
  },
  get ['stop-next']() {
    return i18n.t('actions:step.stop-next')
  },
  get next() {
    return i18n.t('actions:step.next')
  },
  get ['next-play']() {
    return i18n.t('actions:step.next-play')
  },
  get none() {
    return i18n.t('actions:step.none')
  },
}

/** The choices per state - only what makes sense there (no "Pause" for a song that isn't running). */
export const STEP_CHOICES: Record<SongState, StepAction[]> = {
  ready: ['play', 'next', 'none'],
  'count-in': ['none', 'stop', 'next'],
  playing: ['stop-next', 'stop', 'pause', 'next', 'none'],
  paused: ['resume', 'stop-next', 'stop', 'none'],
  finished: ['next-play', 'next', 'play', 'none'],
}

/** "Ein-Tasten-Show": one pedal runs the whole show - press = start, press = end + next song
 * ready, … A press during the count-in does nothing, so a double tap can't cancel the start. */
export const ONE_BUTTON_SHOW: Record<SongState, StepAction> = {
  ready: 'play',
  'count-in': 'none',
  playing: 'stop-next',
  paused: 'resume',
  finished: 'next-play',
}

/** The mapping before actions (docs/23): one fixed show action or one per song state. Kept to
 * convert stored mappings - `bindingFromV2`. */
export type KeyAction = { kind: 'fixed'; action: FixedAction } | { kind: 'by-state'; steps: Record<SongState, StepAction> }

/** A key and what pressing (and letting go of) it does (docs/23 §4a). */
export interface KeyBinding {
  key: string
  behavior: Behavior
}

/** A stored mapping of the earlier form, as the same behaviour in the new one - nobody has to set
 * up their pedal again (docs/23 §8). */
export function bindingFromV2(old: { key: string; action: KeyAction }): KeyBinding {
  const press: Action = old.action.kind === 'fixed' ? { kind: 'show', op: old.action.action } : { kind: 'by-state', steps: old.action.steps }
  return { key: old.key, behavior: { kind: 'momentary', press, release: { kind: 'none' } } }
}

export type Keybindings = KeyBinding[]

/** Nothing pre-assigned (Marco): each mapping is set up on purpose, so no key - not a laptop's
 * PageDown either - triggers anything by accident. */
export const DEFAULT_KEYBINDINGS: Keybindings = []

export function bindingForKey(bindings: Keybindings, key: string): KeyBinding | null {
  return bindings.find((binding) => binding.key === key) ?? null
}

/** Adds or replaces the mapping of `binding.key` (one key, one meaning); `replacesKey` is the key
 * an edited mapping had before, if it changed. */
export function upsertBinding(bindings: Keybindings, binding: KeyBinding, replacesKey?: string): Keybindings {
  const rest = bindings.filter((b) => b.key !== binding.key && b.key !== replacesKey)
  const index = bindings.findIndex((b) => b.key === (replacesKey ?? binding.key))
  const next = [...rest]
  next.splice(index >= 0 ? Math.min(index, next.length) : next.length, 0, binding)
  return next
}

export function removeBinding(bindings: Keybindings, key: string): Keybindings {
  return bindings.filter((b) => b.key !== key)
}

/** The song's state from what the transport knows. */
export function songStateFor(input: { playbackStatus: 'playing' | 'paused' | 'stopped'; isCountIn: boolean; trackEnded: boolean }): SongState {
  if (input.playbackStatus === 'playing') return input.isCountIn ? 'count-in' : 'playing'
  if (input.playbackStatus === 'paused') return 'paused'
  return input.trackEnded ? 'finished' : 'ready'
}

/** Keys that never become a binding: modifiers alone and keys the app/OS needs. */
const UNBINDABLE = new Set(['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Escape', 'CapsLock', 'Dead', 'Unidentified'])

export function isBindableKey(key: string): boolean {
  return key.length > 0 && !UNBINDABLE.has(key)
}

const KEY_LABEL: Record<string, string> = {
  get [' ']() {
    return i18n.t('actions:key.space')
  },
  get PageDown() {
    return i18n.t('actions:key.PageDown')
  },
  get PageUp() {
    return i18n.t('actions:key.PageUp')
  },
  get ArrowDown() {
    return i18n.t('actions:key.ArrowDown')
  },
  get ArrowUp() {
    return i18n.t('actions:key.ArrowUp')
  },
  get ArrowLeft() {
    return i18n.t('actions:key.ArrowLeft')
  },
  get ArrowRight() {
    return i18n.t('actions:key.ArrowRight')
  },
  get Enter() {
    return i18n.t('actions:key.Enter')
  },
  get Backspace() {
    return i18n.t('actions:key.Backspace')
  },
  get Home() {
    return i18n.t('actions:key.Home')
  },
  get End() {
    return i18n.t('actions:key.End')
  },
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

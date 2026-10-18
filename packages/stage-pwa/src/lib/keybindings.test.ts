import { describe, expect, it } from 'vitest'
import {
  bindingForKey,
  DEFAULT_KEYBINDINGS,
  isBindableKey,
  isTypingTarget,
  keyLabel,
  ONE_BUTTON_SHOW,
  removeBinding,
  songStateFor,
  STEP_CHOICES,
  upsertBinding,
  bindingFromV2,
  type KeyBinding,
} from './keybindings'
import { describeAction, type Action } from './actions'

const next: KeyBinding = bindingFromV2({ key: 'PageDown', action: { kind: 'fixed', action: 'next' } })
const show: KeyBinding = bindingFromV2({ key: 'b', action: { kind: 'by-state', steps: ONE_BUTTON_SHOW } })
const pressOf = (b: KeyBinding): Action => (b.behavior.kind === 'momentary' ? b.behavior.press : b.behavior.kind === 'latching' ? b.behavior.on : ({} as Action))

describe('keybindings (#27)', () => {
  it('starts empty - nothing triggers by accident', () => {
    expect(DEFAULT_KEYBINDINGS).toEqual([])
  })

  it('one key, one meaning: saving a key again replaces its mapping, editing can change the key', () => {
    let bindings = upsertBinding([], next)
    bindings = upsertBinding(bindings, show)
    bindings = upsertBinding(bindings, bindingFromV2({ key: 'PageDown', action: { kind: 'fixed', action: 'stop' } }))
    expect(bindings.map((b) => { const a = pressOf(b); return [b.key, a.kind === 'show' ? a.op : 'by-state'] })).toEqual([
      ['PageDown', 'stop'],
      ['b', 'by-state'],
    ])
    bindings = upsertBinding(bindings, { ...show, key: 'PageUp' }, 'b')
    expect(bindings.map((b) => b.key)).toEqual(['PageDown', 'PageUp'])
    expect(bindingForKey(removeBinding(bindings, 'PageUp'), 'PageUp')).toBeNull()
  })

  it('the five song states, as the status bar shows them', () => {
    expect(songStateFor({ playbackStatus: 'stopped', isCountIn: false, trackEnded: false })).toBe('ready')
    expect(songStateFor({ playbackStatus: 'playing', isCountIn: true, trackEnded: false })).toBe('count-in')
    expect(songStateFor({ playbackStatus: 'playing', isCountIn: false, trackEnded: false })).toBe('playing')
    expect(songStateFor({ playbackStatus: 'paused', isCountIn: false, trackEnded: false })).toBe('paused')
    expect(songStateFor({ playbackStatus: 'stopped', isCountIn: false, trackEnded: true })).toBe('finished')
  })

  it('the "Ein-Tasten-Show" preset only uses choices offered in each state', () => {
    for (const [state, step] of Object.entries(ONE_BUTTON_SHOW)) {
      expect(STEP_CHOICES[state as keyof typeof STEP_CHOICES]).toContain(step)
    }
  })

  it('converts a stored mapping of the earlier form, and describes it in one line (docs/23 §8)', () => {
    expect(next.behavior).toEqual({ kind: 'momentary', press: { kind: 'show', op: 'next' }, release: { kind: 'none' } })
    expect(describeAction(pressOf(next))).toBe('Nächster Song')
    expect(describeAction(pressOf(show))).toBe('Bereit → Play · Spielt → Stop & nächster Song · Pause → Fortsetzen · Beendet → Nächster Song und starten')
  })

  it('labels keys and leaves out modifiers and typing targets', () => {
    expect(keyLabel('PageDown')).toBe('Bild ↓')
    expect(keyLabel('a')).toBe('A')
    expect(isBindableKey('Shift')).toBe(false)
    expect(isBindableKey('PageUp')).toBe(true)
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true)
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    expect(isTypingTarget(checkbox)).toBe(false)
  })
})

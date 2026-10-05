import { describe, expect, it } from 'vitest'
import { actionForKey, assignKey, DEFAULT_KEYBINDINGS, isBindableKey, isTypingTarget, keyLabel, removeKey } from './keybindings'

describe('foot switch keybindings (#27)', () => {
  it('page-turner defaults: PageDown = next, PageUp = previous, nothing else', () => {
    expect(actionForKey(DEFAULT_KEYBINDINGS, 'PageDown')).toBe('next')
    expect(actionForKey(DEFAULT_KEYBINDINGS, 'PageUp')).toBe('previous')
    expect(actionForKey(DEFAULT_KEYBINDINGS, ' ')).toBeNull()
  })

  it('one key has one meaning - assigning moves it from its old action', () => {
    const b = assignKey(DEFAULT_KEYBINDINGS, 'play-pause', 'PageDown')
    expect(actionForKey(b, 'PageDown')).toBe('play-pause')
    expect(b.next).toEqual([])
  })

  it('removes a key and labels keys readably', () => {
    expect(removeKey(DEFAULT_KEYBINDINGS, 'next', 'PageDown').next).toEqual([])
    expect(keyLabel(' ')).toBe('Leertaste')
    expect(keyLabel('PageDown')).toBe('Bild ↓')
    expect(keyLabel('a')).toBe('A')
  })

  it('never binds modifiers or Escape; ignores keys typed into fields', () => {
    expect(isBindableKey('Shift')).toBe(false)
    expect(isBindableKey('Escape')).toBe(false)
    expect(isBindableKey('ArrowDown')).toBe(true)
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true)
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    expect(isTypingTarget(checkbox)).toBe(false)
    expect(isTypingTarget(document.createElement('input'))).toBe(true)
    expect(isTypingTarget(document.createElement('button'))).toBe(false)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'

describe('useKeybindingsStore migration', () => {
  beforeEach(() => localStorage.clear())

  it('version 3 -> 4: a mapping that started a removed "Ablauf" is dropped, the others stay (Marco, 2026-10-18)', async () => {
    const keep = { key: 'PageUp', behavior: { kind: 'momentary', press: { kind: 'show', op: 'next' }, release: { kind: 'none' } } }
    const old = { key: 'PageDown', behavior: { kind: 'momentary', press: { kind: 'sequence', sequenceId: 'x' }, release: { kind: 'none' } } }
    localStorage.setItem('stageboard-keybindings', JSON.stringify({ state: { bindings: [keep, old] }, version: 3 }))
    const { useKeybindingsStore } = await import('./useKeybindingsStore')
    await useKeybindingsStore.persist.rehydrate()
    expect(useKeybindingsStore.getState().bindings).toEqual([keep])
  })
})

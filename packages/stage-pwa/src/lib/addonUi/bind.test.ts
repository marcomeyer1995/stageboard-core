import { describe, expect, it } from 'vitest'
import { resolveBind } from './bind'

const sources = { jobs: { abc: { progress: 0.4, status: 'running' } }, state: { 'qlc-1': { scene: 'a', level: 0.5 } } }

describe('resolveBind (#964, docs/36 §6)', () => {
  it('reads a job field and a device state value', () => {
    expect(resolveBind('job:abc.progress', sources)).toBe(0.4)
    expect(resolveBind('job:abc.status', sources)).toBe('running')
    expect(resolveBind('state:qlc-1.scene', sources)).toBe('a')
    expect(resolveBind('state:qlc-1.level', sources)).toBe(0.5)
  })

  it('is undefined for anything unknown - never a throw, never a prototype property', () => {
    for (const path of ['job:nope.progress', 'job:abc.nope', 'state:qlc-1.nope', 'x:abc.progress', 'garbage', 'job:__proto__.x', 'job:abc.__proto__', 'job:abc.constructor', 'state:constructor.name']) {
      expect(resolveBind(path, sources), path).toBeUndefined()
    }
  })
})

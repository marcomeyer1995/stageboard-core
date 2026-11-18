import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createHostRoleStore } from './hostRoleStore.js'

describe('createHostRoleStore (#920)', () => {
  it('starts as not active with no epoch of its own', () => {
    expect(createHostRoleStore(mkdtempSync(join(tmpdir(), 'role-'))).load()).toEqual({ epoch: 0, active: false })
  })

  it('keeps what was saved across a restart (a new store on the same folder)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'role-'))
    createHostRoleStore(dir).save({ epoch: 3, active: true })
    expect(createHostRoleStore(dir).load()).toEqual({ epoch: 3, active: true })
  })

  it('treats a missing or broken file as the start state, never throws', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'role-'))
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'host-role.json'), '{nonsense')
    expect(createHostRoleStore(dir).load()).toEqual({ epoch: 0, active: false })
    writeFileSync(join(dir, 'host-role.json'), JSON.stringify({ epoch: -4, active: 'yes' }))
    expect(createHostRoleStore(dir).load()).toEqual({ epoch: 0, active: false })
  })

  it('does not throw when the folder cannot be written', async () => {
    const { writeFileSync } = await import('node:fs')
    const dir = mkdtempSync(join(tmpdir(), 'role-'))
    writeFileSync(join(dir, 'a-file'), 'x')
    // A folder below a regular file can never be created.
    expect(() => createHostRoleStore(join(dir, 'a-file', 'sub')).save({ epoch: 2, active: true })).not.toThrow()
  })
})

import { pbkdf2Sync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createHostLogin, type HostAccount } from './hostLogin.js'

const account = (name: string, password: string, roles = ['member'], prf: 'sha256' | 'sha' = 'sha256'): HostAccount => {
  const salt = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  const derived_key = pbkdf2Sync(password, salt, 1000, prf === 'sha' ? 20 : 32, prf === 'sha' ? 'sha1' : 'sha256').toString('hex')
  return { name, roles, iterations: 1000, salt, derived_key, pbkdf2_prf: prf }
}
const basic = (user: string, password: string) => 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64')

const band = 'stageboard-band'
const bands: Record<string, HostAccount[]> = {
  [band]: [account(`${band}-p~redmi`, 'secret-1', ['member', 'admin']), account(`${band}-p~old`, 'secret-2', ['member'], 'sha')],
  'stageboard-other': [account('stageboard-other-p~phone', 'secret-3')],
}

describe('host login over host-accounts (docs/25 §6b, C)', () => {
  it('a listed device gets in with its roles; a wrong password, an unknown user and no login do not', async () => {
    const login = createHostLogin({ accounts: async (db) => bands[db] ?? [] })
    expect(await login(basic(`${band}-p~redmi`, 'secret-1'), band)).toEqual({ name: `${band}-p~redmi`, roles: ['member', 'admin'] })
    expect(await login(basic(`${band}-p~redmi`, 'wrong'), band)).toBeNull()
    expect(await login(basic(`${band}-p~ghost`, 'secret-1'), band)).toBeNull()
    expect(await login(undefined, band)).toBeNull()
  })

  it('a device of another band is turned away', async () => {
    const login = createHostLogin({ accounts: async (db) => bands[db] ?? [] })
    expect(await login(basic('stageboard-other-p~phone', 'secret-3'), band)).toBeNull()
    expect(await login(basic('stageboard-other-p~phone', 'secret-3'), 'stageboard-other')).not.toBeNull()
  })

  it('older CouchDB accounts (SHA-1) still work', async () => {
    const login = createHostLogin({ accounts: async (db) => bands[db] ?? [] })
    expect(await login(basic(`${band}-p~old`, 'secret-2'), band)).not.toBeNull()
  })

  it('a checked login is remembered for a while, then checked again (a removed device stops working)', async () => {
    let t = 0
    const accounts = vi.fn(async (db: string) => bands[db] ?? [])
    const login = createHostLogin({ accounts, rememberMs: 1000, now: () => t })
    const auth = basic(`${band}-p~redmi`, 'secret-1')
    await login(auth, band)
    await login(auth, band)
    expect(accounts).toHaveBeenCalledTimes(1)
    t = 1500
    accounts.mockResolvedValueOnce([])
    expect(await login(auth, band)).toBeNull()
  })
})

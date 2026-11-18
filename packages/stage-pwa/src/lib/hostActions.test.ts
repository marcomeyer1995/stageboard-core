import { afterEach, describe, expect, it, vi } from 'vitest'
import { hostAction } from './hostActions'

const ADMIN = { adminUsername: 'stageboard-band-admin~dev', adminPassword: 'pw' }

afterEach(() => vi.unstubAllGlobals())

describe('hostAction (#943)', () => {
  it('POSTs the admin\'s login to the host\'s take-over / hand-back route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    expect(await hostAction('https://10.0.0.2:8443/', 'take-over', ADMIN)).toBe('done')
    expect(fetchMock).toHaveBeenCalledWith('https://10.0.0.2:8443/host/take-over', expect.objectContaining({ method: 'POST', body: JSON.stringify(ADMIN) }))
    await hostAction('https://10.0.0.1:8443', 'hand-back', ADMIN)
    expect(fetchMock.mock.calls[1]![0]).toBe('https://10.0.0.1:8443/host/hand-back')
  })

  it('tells apart: the host refused the change (409), did not accept the login (403), or could not be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409 }))
    expect(await hostAction('https://h', 'take-over', ADMIN)).toBe('refused')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    expect(await hostAction('https://h', 'take-over', ADMIN)).toBe('denied')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    expect(await hostAction('https://h', 'take-over', ADMIN)).toBe('unreachable')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    expect(await hostAction('https://h', 'take-over', ADMIN)).toBe('unreachable')
  })
})

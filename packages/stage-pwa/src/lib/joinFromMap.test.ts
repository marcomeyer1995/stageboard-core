import { afterEach, describe, expect, it, vi } from 'vitest'
import { askBackupToJoin, type JoinInviteInput } from './joinFromMap'

const FP = 'a'.repeat(64)
const input: JoinInviteInput = {
  workspaceId: 'leasetest',
  accessCode: '12345678',
  primaryUrl: 'https://10.0.0.1:8443',
  primaryHostId: 'laptop',
  targetHostId: 'stage-pc',
  targetUrl: 'https://10.0.0.2:8443',
  fingerprint: FP,
  sentAt: 1_000,
}

afterEach(() => vi.unstubAllGlobals())

describe('askBackupToJoin (#945)', () => {
  it('POSTs the signed invite to the BACKUP, not the primary, with a rising sentAt', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    expect(await askBackupToJoin(input)).toBe('done')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://10.0.0.2:8443/host/join-band-from-map')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ workspaceId: 'leasetest', accessCode: '12345678', targetHostId: 'stage-pc', primaryHostId: 'laptop', sentAt: 1_000 })
    expect(body.sentAt).toBeGreaterThan(0)
  })

  it('reports: bad code (403), stale invite (409), not for this host (400), no answer', async () => {
    for (const [status, want] of [[403, 'code-refused'], [409, 'refused'], [400, 'refused'], [502, 'unreachable']] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }))
      expect(await askBackupToJoin(input)).toBe(want)
    }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    expect(await askBackupToJoin(input)).toBe('unreachable')
  })

  it('does not send anything without a band id or a code', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await askBackupToJoin({ ...input, workspaceId: '' })
    await askBackupToJoin({ ...input, accessCode: '' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

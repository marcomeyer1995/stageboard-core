import { describe, expect, it, vi } from 'vitest'
import { createLookupRoutes, type LookupPorts } from './lookupRoutes.js'
import { matchHostRoute } from './routes.js'

function ports(over: Partial<LookupPorts> = {}): LookupPorts & { search: ReturnType<typeof vi.fn>; fetchDetail: ReturnType<typeof vi.fn> } {
  return {
    search: vi.fn(async () => [{ id: '1', title: 'Wonderwall' }]),
    fetchDetail: vi.fn(async () => ({ id: '1', body: 'chords' })),
    refusal: async () => null,
    errorBody: (err) => ({ status: 'error', code: 'failed', message: String(err) }),
    log: { error: vi.fn() },
    ...over,
  } as never
}

async function call(p: LookupPorts, path: string, query: Record<string, string> = {}) {
  const hit = matchHostRoute(createLookupRoutes(p), 'GET', path)
  if (!hit) throw new Error(`no route ${path}`)
  return hit.route.handle({ method: 'GET', path, params: hit.params, query })
}

describe('the look-up routes, with no provider (#964)', () => {
  it('answers a search and a detail with what the provider gives, asked by its decoded name', async () => {
    const p = ports()
    expect(await call(p, '/lookup/fake-lookup/search', { q: 'wonderwall' })).toEqual({ status: 200, body: [{ id: '1', title: 'Wonderwall' }] })
    expect(p.search).toHaveBeenCalledWith('fake-lookup', 'wonderwall')
    expect(await call(p, '/lookup/my%20provider/detail', { resultId: 'https://x/y?z=1' })).toEqual({ status: 200, body: { id: '1', body: 'chords' } })
    expect(p.fetchDetail).toHaveBeenCalledWith('my provider', 'https://x/y?z=1')
  })

  it('says 400 for a missing query or result id - before any provider or refusal is asked', async () => {
    const p = ports({ refusal: vi.fn(async () => null) })
    expect(await call(p, '/lookup/x/search')).toEqual({ status: 400, body: { status: 'error', message: 'Missing query parameter q' } })
    expect(await call(p, '/lookup/x/detail')).toEqual({ status: 400, body: { status: 'error', message: 'Missing query parameter resultId' } })
    expect(p.refusal).not.toHaveBeenCalled()
    expect(p.search).not.toHaveBeenCalled()
  })

  it('says 403 with the reason when the band may not use the provider (its add-on is missing) - and does not ask the provider', async () => {
    const p = ports({ refusal: async (provider, workspace) => (provider === 'ug' && workspace !== 'band-a' ? { message: 'Add-on missing', messageCode: 'ug.addonMissing' } : null) as never })
    expect(await call(p, '/lookup/ug/search', { q: 'x', workspace: 'band-b' })).toMatchObject({ status: 403, body: { status: 'error', message: 'Add-on missing', messageCode: 'ug.addonMissing' } })
    expect(p.search).not.toHaveBeenCalled()
    expect((await call(p, '/lookup/ug/search', { q: 'x', workspace: 'band-a' })).status).toBe(200)
  })

  it('says 404 for a provider nobody knows, search and detail alike', async () => {
    const p = ports({ search: vi.fn(async () => null), fetchDetail: vi.fn(async () => null) } as never)
    expect(await call(p, '/lookup/nobody/search', { q: 'x' })).toEqual({ status: 404, body: { status: 'error', message: 'Unknown provider: nobody' } })
    expect((await call(p, '/lookup/nobody/detail', { resultId: '1' })).status).toBe(404)
  })

  it('says 502 with the provider\'s own error body when it fails, and logs which look-up failed', async () => {
    const boom = new Error('site is down')
    const p = ports({ search: vi.fn(async () => { throw boom }), fetchDetail: vi.fn(async () => { throw boom }) } as never)
    expect(await call(p, '/lookup/x/search', { q: 'q' })).toEqual({ status: 502, body: { status: 'error', code: 'failed', message: 'Error: site is down' } })
    expect((await call(p, '/lookup/x/detail', { resultId: '1' })).status).toBe(502)
    expect(p.log?.error).toHaveBeenCalledWith(expect.objectContaining({ provider: 'x' }), 'Lookup search failed')
    expect(p.log?.error).toHaveBeenCalledWith(expect.objectContaining({ provider: 'x' }), 'Lookup detail failed')
  })

  it('does not swallow a refusal check that throws - it is the port\'s to catch (the laptop\'s turns a database error into "not installed"), as before', async () => {
    const p = ports({ refusal: async () => { throw new Error('database gone') } })
    await expect(call(p, '/lookup/ug/search', { q: 'x' })).rejects.toThrow('database gone')
  })
})

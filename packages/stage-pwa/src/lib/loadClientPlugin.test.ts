import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchClientBundle, resolveClientBundleUrl } from './loadClientPlugin'

describe('resolveClientBundleUrl', () => {
  it('is null when the plugin has no clientSource at all', () => {
    expect(resolveClientBundleUrl({ id: 'kemper' }, 'https://stage.local')).toBeNull()
  })

  it('prefers the Stage-Server local mirror when one is configured', () => {
    expect(resolveClientBundleUrl({ id: 'kemper', clientSource: 'https://cdn.example/kemper.js' }, 'https://stage.local')).toBe(
      'https://stage.local/plugins/kemper/client.js',
    )
  })

  it('falls back to clientSource directly for the solo/no-Stage-Server case', () => {
    expect(resolveClientBundleUrl({ id: 'kemper', clientSource: 'https://cdn.example/kemper.js' }, null)).toBe(
      'https://cdn.example/kemper.js',
    )
  })
})

describe('fetchClientBundle', () => {
  const cacheMatch = vi.fn()
  const cachePut = vi.fn()
  const fetchMock = vi.fn()

  beforeEach(() => {
    cacheMatch.mockReset()
    cachePut.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue({ match: cacheMatch, put: cachePut }) })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is null with no clientSource, never touching the cache or network', async () => {
    const result = await fetchClientBundle({ id: 'kemper', version: '1.0.0' }, null)
    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the cached blob on a hit, without fetching again', async () => {
    const cachedBlob = new Blob(['cached'])
    cacheMatch.mockResolvedValue({ blob: () => Promise.resolve(cachedBlob) })

    const result = await fetchClientBundle({ id: 'kemper', version: '1.0.0', clientSource: 'https://cdn.example/kemper.js' }, null)

    expect(result).toBe(cachedBlob)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches and caches on a miss, keyed by a real URL containing id@version', async () => {
    cacheMatch.mockResolvedValue(undefined)
    const fetchedBlob = new Blob(['fresh'])
    const response = { ok: true, clone: () => response, blob: () => Promise.resolve(fetchedBlob) }
    fetchMock.mockResolvedValue(response)

    const result = await fetchClientBundle({ id: 'kemper', version: '1.0.0', clientSource: 'https://cdn.example/kemper.js' }, null)

    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example/kemper.js')
    const [cacheKey, cachedResponse] = cachePut.mock.calls[0]
    // The Cache API rejects a plain opaque string ("Request scheme '...' is unsupported",
    // confirmed live) - it must parse as a real URL. Same key used for the match() call above.
    expect(() => new URL(cacheKey)).not.toThrow()
    expect(cacheKey).toContain('kemper@1.0.0')
    expect(cacheMatch).toHaveBeenCalledWith(cacheKey)
    expect(cachedResponse).toBe(response)
    expect(result).toBe(fetchedBlob)
  })

  it('is null when the fetch fails, and never caches a failed response', async () => {
    cacheMatch.mockResolvedValue(undefined)
    fetchMock.mockResolvedValue({ ok: false })

    const result = await fetchClientBundle({ id: 'kemper', version: '1.0.0', clientSource: 'https://cdn.example/kemper.js' }, null)

    expect(result).toBeNull()
    expect(cachePut).not.toHaveBeenCalled()
  })
})

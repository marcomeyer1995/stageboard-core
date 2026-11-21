import { describe, expect, it } from 'vitest'
import { BAND_SETTINGS_DOC_ID, listedHostIds } from './hostRole.js'

describe('which devices the band lists as its hosts', () => {
  it('are the ids in the band settings, primary and backup', () => {
    expect(BAND_SETTINGS_DOC_ID).toBe('band-settings:band')
    expect(
      listedHostIds({ _id: 'band-settings:band', hosts: [{ hostId: 'laptop', url: 'https://10.0.0.1:8443', priority: 1 }, { hostId: 'tablet', url: 'https://10.0.0.2:8443', priority: 2 }] }),
    ).toEqual(['laptop', 'tablet'])
  })

  it('are none for settings without hosts, for no settings, and for something that is not settings', () => {
    expect(listedHostIds({ _id: 'band-settings:band' })).toEqual([])
    expect(listedHostIds(null)).toEqual([])
    expect(listedHostIds('hosts')).toEqual([])
    expect(listedHostIds({ hosts: 'laptop' })).toEqual([])
  })

  it('skips an entry that is not a host entry instead of trusting it - a hand-made one must not make a device a host', () => {
    expect(listedHostIds({ hosts: [{ hostId: 'laptop', url: 'https://10.0.0.1:8443', priority: 1 }, { hostId: '' }, { name: 'x' }, null, 'fire'] })).toEqual(['laptop'])
  })
})

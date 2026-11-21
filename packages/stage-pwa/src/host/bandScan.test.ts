import { describe, expect, it } from 'vitest'
import { bandIdsFromDatabases } from './bandScan'

describe('bandIdsFromDatabases (#962)', () => {
  it('lists the bands a device holds, and not the placeholders a fresh app keeps', () => {
    expect(bandIdsFromDatabases(['_pouch_stageboard-', '_pouch_stageboard-default', 'stageboard-audio-cache', 'stageboard-timeline-cache'])).toEqual([])
    expect(bandIdsFromDatabases(['_pouch_stageboard-', '_pouch_stageboard-default', '_pouch_stageboard-leasetest', '_pouch_stageboard-665e69d9'])).toEqual(['leasetest', '665e69d9'])
  })

  it('leaves out the copies kept of deleted bands, and does not repeat a band', () => {
    expect(bandIdsFromDatabases(['_pouch_stageboard-deleted-leasetest-2026-11-19_2300', '_pouch_stageboard-a', '_pouch_stageboard-a', undefined])).toEqual(['a'])
  })
})

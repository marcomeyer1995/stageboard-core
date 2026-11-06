import { describe, expect, it } from 'vitest'
import { defaultStageMap, type StageMap } from 'shared-types'
import { stageMapDefaults } from './stageMapDefaults'

const DAY = 24 * 60 * 60 * 1000
const now = 100 * DAY

describe('stage map defaults (docs/31 decision 6)', () => {
  it('a band without a map gets the default map of its current devices', () => {
    const writes = stageMapDefaults({ equipment: [], setups: [] }, [
      { id: 'redmi', name: 'Redmi', lastSeenAt: now },
      { id: 'old', name: 'Alt', lastSeenAt: now - 30 * DAY },
      { id: 'gone', name: 'Gesperrt', lastSeenAt: now, revoked: true },
    ], 'redmi', now)
    expect(writes.newSetups.map((s) => s.links.map((l) => l.id))).toEqual([['default:redmi']])
    expect(writes.equipment.map((e) => e.id)).toEqual(['device:redmi', 'listener:redmi'])
  })

  it('a new device gets its speaker cable in every setup, without touching what the band changed', () => {
    const base = defaultStageMap([{ id: 'redmi', name: 'Redmi' }])
    const map: StageMap = { ...base, setups: [...base.setups, { id: 'club', name: 'Club', positions: {}, links: [], routing: {} }] }
    const writes = stageMapDefaults(map, [{ id: 'redmi', name: 'Redmi', lastSeenAt: now }, { id: 'fire', name: 'Fire', lastSeenAt: now }], 'redmi', now)
    expect(writes.equipment.map((e) => e.id)).toEqual(['device:fire', 'listener:fire'])
    const club = writes.addTo.find((w) => w.setupId === 'club')!.apply(map.setups[1]!)
    expect(club.links.map((l) => l.id)).toEqual(['default:fire'])
    // Applied twice (two tablets at once): still one cable.
    expect(writes.addTo.find((w) => w.setupId === 'club')!.apply(club)).toBe(club)
  })

  it('nothing to write when every device is on the map', () => {
    const map = defaultStageMap([{ id: 'redmi', name: 'Redmi' }])
    expect(stageMapDefaults(map, [{ id: 'redmi', name: 'Redmi', lastSeenAt: now }], 'redmi', now)).toEqual({ equipment: [], newSetups: [], addTo: [] })
  })
})

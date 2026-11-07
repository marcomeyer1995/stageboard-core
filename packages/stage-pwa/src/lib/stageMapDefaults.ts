import { addDeviceToMap, appsOf, defaultStageMap, type StageEquipment, type StageMap, type StageSetup } from 'shared-types'

/** A device not seen for this long is no longer added to the map (an old tablet cluttered the
 * path list, 2026-11-05). */
const STALE_MS = 14 * 24 * 60 * 60 * 1000

export interface StageMapDefaultWrites {
  equipment: StageEquipment[]
  /** Whole setups to create - only when the band has none yet. */
  newSetups: StageSetup[]
  /** Existing setups that get a device's default cable - applied to the freshly read setup. */
  addTo: { setupId: string; apply: (current: StageSetup) => StageSetup }[]
}

/**
 * What to write so every current device is on the map the default way (docs/31 §0a, decision 6):
 * a band without a map gets the default map; a device new to the map gets its speaker cable (its
 * matrix routes Klick, Track and Ansagen there) in every setup. A device already on the map is left as the band set it.
 */
export function stageMapDefaults(map: StageMap, devices: readonly { id: string; name: string; lastSeenAt?: number; revoked?: boolean }[], ownDeviceId: string, now = Date.now()): StageMapDefaultWrites {
  const current = devices.filter((d) => !d.revoked && (d.id === ownDeviceId || d.lastSeenAt === undefined || now - d.lastSeenAt <= STALE_MS))
  if (map.setups.length === 0) {
    const fresh = defaultStageMap(current)
    const known = new Set(map.equipment.map((e) => e.id))
    return { equipment: fresh.equipment.filter((e) => !known.has(e.id)), newSetups: fresh.setups, addTo: [] }
  }
  const missing = current.filter((d) => !map.equipment.some((e) => appsOf(e).includes(d.id)))
  let grown = map
  const addTo: StageMapDefaultWrites['addTo'] = []
  for (const device of missing) {
    const before = grown
    grown = addDeviceToMap(grown, device)
    const added = grown.equipment.slice(before.equipment.length)
    for (const setup of map.setups) {
      const target = grown.setups.find((s) => s.id === setup.id)!
      const link = target.links[target.links.length - 1]!
      const positions = Object.fromEntries(added.map((e) => [e.id, target.positions[e.id]!]))
      addTo.push({
        setupId: setup.id,
        apply: (fresh) =>
          fresh.links.some((l) => l.id === link.id)
            ? fresh
            : { ...fresh, positions: { ...positions, ...fresh.positions }, links: [...fresh.links, link] },
      })
    }
  }
  return { equipment: grown.equipment.slice(map.equipment.length), newSetups: [], addTo }
}

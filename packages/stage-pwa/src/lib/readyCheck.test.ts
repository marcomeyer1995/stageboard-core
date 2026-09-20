import { describe, expect, it } from 'vitest'
import { PRESENCE_TIMEOUT_MS, type Presence } from 'shared-types'
import { computeReadyStatus, hasAnswered } from './readyCheck'

const NOW = 1_000_000

function presence(devices: Record<string, { profileId: string; ageMs: number }>, readyCheck?: Presence['readyCheck']): Presence {
  return {
    devices: Object.fromEntries(
      Object.entries(devices).map(([id, device]) => [id, { profileId: device.profileId, lastSeenAt: NOW - device.ageMs }]),
    ),
    readyCheck,
  }
}

describe('computeReadyStatus', () => {
  it('counts each online profile once, however many devices it has', () => {
    const snapshot = presence({ d1: { profileId: 'anna', ageMs: 0 }, d2: { profileId: 'anna', ageMs: 0 }, d3: { profileId: 'ben', ageMs: 0 } })
    expect(computeReadyStatus(snapshot, 'c1', NOW)).toMatchObject({ total: 2, ready: 0, allReady: false })
  })

  it('counts a profile as ready once it answered this check, from any device', () => {
    const snapshot = presence(
      { d1: { profileId: 'anna', ageMs: 0 }, d2: { profileId: 'ben', ageMs: 0 } },
      { checkId: 'c1', readyProfileIds: ['anna'] },
    )
    expect(computeReadyStatus(snapshot, 'c1', NOW)).toEqual({ total: 2, ready: 1, missingProfileIds: ['ben'], allReady: false })
  })

  it('is all ready when every online profile answered', () => {
    const snapshot = presence(
      { d1: { profileId: 'anna', ageMs: 0 }, d2: { profileId: 'ben', ageMs: 0 } },
      { checkId: 'c1', readyProfileIds: ['anna', 'ben'] },
    )
    expect(computeReadyStatus(snapshot, 'c1', NOW)).toMatchObject({ ready: 2, total: 2, allReady: true })
  })

  it('ignores devices not seen within the presence timeout - they are not waiting anywhere', () => {
    const snapshot = presence({ d1: { profileId: 'anna', ageMs: 0 }, d2: { profileId: 'ben', ageMs: PRESENCE_TIMEOUT_MS + 1 } })
    expect(computeReadyStatus(snapshot, 'c1', NOW)).toMatchObject({ total: 1 })
  })

  it('ignores answers that belong to another check', () => {
    const snapshot = presence({ d1: { profileId: 'anna', ageMs: 0 } }, { checkId: 'old', readyProfileIds: ['anna'] })
    expect(computeReadyStatus(snapshot, 'new', NOW)).toMatchObject({ ready: 0, allReady: false })
  })

  it('never reports an empty band as all ready', () => {
    expect(computeReadyStatus(presence({}), 'c1', NOW)).toEqual({ total: 0, ready: 0, missingProfileIds: [], allReady: false })
  })
})

describe('hasAnswered', () => {
  const snapshot = presence({}, { checkId: 'c1', readyProfileIds: ['anna'] })

  it('is true only for a profile that answered this very check', () => {
    expect(hasAnswered(snapshot, 'c1', 'anna')).toBe(true)
    expect(hasAnswered(snapshot, 'c1', 'ben')).toBe(false)
    expect(hasAnswered(snapshot, 'c2', 'anna')).toBe(false)
    expect(hasAnswered(snapshot, 'c1', undefined)).toBe(false)
  })
})

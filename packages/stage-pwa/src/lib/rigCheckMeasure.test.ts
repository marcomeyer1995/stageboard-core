import { describe, expect, it, vi } from 'vitest'
import type { ShowLogEvent } from 'shared-types'

vi.mock('pouchdb-browser', () => ({ default: class {} }))

const { currentSlot, MEASURE_SLOT_MS, measuredVerdict, measureRoundEnd, measureRoundRunning, startMeasureRound } = await import('./rigCheckMeasure')
const { useShowStateStore } = await import('../store/useShowStateStore')
const { useShowLogStore } = await import('../store/useShowLogStore')

type Run = Extract<ShowLogEvent, { type: 'rig-check-run' }>
type Report = Extract<ShowLogEvent, { type: 'rig-check-device' }>

const run: Run = { id: 'rig-check-run-r1', showId: 'r1', type: 'rig-check-run', at: 1000, kind: 'quick', version: 3 }
const report = (deviceId: string, mode: 'gig' | 'practice' = 'gig'): Report => ({
  id: `rig-check-device-r1-${deviceId}`,
  showId: 'r1',
  type: 'rig-check-device',
  at: 1000,
  deviceId,
  deviceName: deviceId,
  mode,
  trackReady: true,
  clockOffsetMs: 0,
  clockJitterMs: 1,
  audioRoute: 'speaker',
  outputLatencyMs: 80,
  verdict: null,
})
const measured = (extra: Partial<NonNullable<Report['measured']>> = {}): NonNullable<Report['measured']> => ({
  at: 0, input: 'mic', audioRoute: 'speaker', storedMs: 80, offsetMs: 3, jitterMs: 1, matched: 12, total: 12, reliable: true, ...extra,
})

describe('the measuring round (#662)', () => {
  it('gives every device that follows the run a slot, one after the other - Solo Üben is left out', async () => {
    const written: Run[] = []
    useShowStateStore.setState({ isMaster: true })
    useShowLogStore.setState({ append: async (e) => void written.push(e as Run) })
    const count = await startMeasureRound(run, [report('Fire'), report('Redmi'), report('Xiaomi', 'practice')])
    expect(count).toBe(2)
    const slots = written[0]!.measure!.slots
    expect(slots.map((s) => s.deviceId)).toEqual(['Fire', 'Redmi'])
    expect(slots[1]!.at - slots[0]!.at).toBe(MEASURE_SLOT_MS)

    const withRound = written[0]!
    expect(measureRoundRunning(withRound, slots[0]!.at)).toBe(true)
    expect(currentSlot(withRound, slots[1]!.at + 1)).toEqual({ deviceName: 'Redmi', index: 1, count: 2 })
    expect(measureRoundEnd(withRound)).toBe(slots[1]!.at + MEASURE_SLOT_MS)
    expect(measureRoundRunning(withRound, slots[1]!.at + MEASURE_SLOT_MS)).toBe(false)
  })

  it('only the master starts it', async () => {
    useShowStateStore.setState({ isMaster: false })
    expect(await startMeasureRound(run, [report('Fire')])).toBe(0)
  })

  it('green within ±15 ms and ±5 ms with every click heard, red otherwise', () => {
    expect(measuredVerdict(undefined)).toBeNull()
    expect(measuredVerdict(measured())).toBe('ok')
    expect(measuredVerdict(measured({ offsetMs: -15 }))).toBe('ok')
    expect(measuredVerdict(measured({ offsetMs: 40 }))).toBe('problem')
    expect(measuredVerdict(measured({ jitterMs: 6 }))).toBe('problem')
    expect(measuredVerdict(measured({ matched: 11 }))).toBe('problem')
    expect(measuredVerdict(measured({ offsetMs: null, reliable: false }))).toBe('problem')
    expect(measuredVerdict(measured({ error: 'kein Mikrofon' }))).toBe('problem')
  })
})

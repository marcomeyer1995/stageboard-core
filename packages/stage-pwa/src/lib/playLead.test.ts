import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SHOW_STATE, type ShowState } from 'shared-types'

const serverNow = vi.fn(() => 10_000)
const nativeDelay = vi.fn((): number | null => 483)
vi.mock('./clockSync', () => ({ getServerTime: () => serverNow() }))
vi.mock('./nativeOutput', () => ({ nativeOutputDelayMs: () => nativeDelay() }))
vi.mock('../store/useShowStateStore', async () => {
  const { create } = await import('zustand')
  return { useShowStateStore: create(() => ({ state: DEFAULT_SHOW_STATE as ShowState })) }
})

const { freshStartMs, leadNeeded, LEAD_RESERVE_MS, playLeadMs, setPlayLead, suggestedLead } = await import('./playLead')
const { startLeadCheck, useLeadNeededStore } = await import('./leadCheck')
const { useShowStateStore } = await import('../store/useShowStateStore')

afterEach(() => setPlayLead(undefined))

describe('playLead', () => {
  it('is 1000 ms without a band setting, the band value otherwise - clamped to 200-3000', () => {
    expect(playLeadMs()).toBe(1000)
    setPlayLead(1200)
    expect(playLeadMs()).toBe(1200)
    setPlayLead(50)
    expect(playLeadMs()).toBe(200)
    setPlayLead(99_999)
    expect(playLeadMs()).toBe(3000)
  })

  it('puts the lead before the count-in, not only before song time 0 (2026-11-06)', () => {
    // A 2-bar count-in at 120 BPM starts 4 s before 0: its first click lies the lead after Play.
    expect(freshStartMs(-4000, 800)).toBe(-4800)
    expect(freshStartMs(0, 800)).toBe(-800)
  })

  it('a device needed the way the Play took, its output delay and the reserve', () => {
    // The Fire: Play arrived 120 ms after it was pressed, native output 483 ms.
    expect(leadNeeded(1000, 1120, 483)).toBe(120 + 483 + LEAD_RESERVE_MS)
  })

  it('suggests the next full 100 ms', () => {
    expect(suggestedLead(943)).toBe(1000)
    expect(suggestedLead(1000)).toBe(1000)
  })

  it('measures each fresh Play seen live - not the state found at app start, not a resume', () => {
    useShowStateStore.setState({ state: { ...DEFAULT_SHOW_STATE, playbackStatus: 'playing', playbackStartedAt: 1, playbackAccumulatedMs: -800 } })
    startLeadCheck()
    expect(useLeadNeededStore.getState().neededMs).toBeNull()

    serverNow.mockReturnValue(9_150)
    useShowStateStore.setState({ state: { ...DEFAULT_SHOW_STATE, playbackStatus: 'playing', playbackStartedAt: 9_000, playbackAccumulatedMs: -4800 } })
    expect(useLeadNeededStore.getState().neededMs).toBe(150 + 483 + LEAD_RESERVE_MS)

    // Resumed from Pause in the middle of the song: no lead to measure.
    serverNow.mockReturnValue(20_000)
    useShowStateStore.setState({ state: { ...DEFAULT_SHOW_STATE, playbackStatus: 'playing', playbackStartedAt: 19_000, playbackAccumulatedMs: 30_000 } })
    expect(useLeadNeededStore.getState().neededMs).toBe(150 + 483 + LEAD_RESERVE_MS)
  })
})

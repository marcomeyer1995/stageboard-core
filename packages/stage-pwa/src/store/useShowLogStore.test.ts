import { beforeEach, describe, expect, it, vi } from 'vitest'

const getAllShowLogEvents = vi.fn()
const putShowLogEvent = vi.fn()
const showLogChanges = vi.fn()
const switchShowLogWorkspace = vi.fn()
vi.mock('../lib/showLogDb', () => ({
  getAllShowLogEvents: (...args: unknown[]) => getAllShowLogEvents(...args),
  putShowLogEvent: (...args: unknown[]) => putShowLogEvent(...args),
  showLogChanges: (...args: unknown[]) => showLogChanges(...args),
  switchShowLogWorkspace: (...args: unknown[]) => switchShowLogWorkspace(...args),
}))

const { useShowLogStore } = await import('./useShowLogStore')

beforeEach(() => {
  getAllShowLogEvents.mockReset().mockResolvedValue([])
  putShowLogEvent.mockReset().mockResolvedValue(undefined)
  showLogChanges.mockReset().mockReturnValue({ on: vi.fn(), cancel: vi.fn() })
  switchShowLogWorkspace.mockReset()
})

describe('init - events with fractional times (2026-10-05)', () => {
  it('keeps them with the times rounded instead of dropping them', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    getAllShowLogEvents.mockResolvedValue([
      // Exactly the shapes the Live-Debug-Console showed on the Fire: server-clock timestamps.
      { id: 's', showId: 's1', type: 'show-started', at: 1791099820556.1738 },
      { id: 'p', showId: 's1', type: 'song-played', songId: 'x', songTitle: 'All the small things', at: 1791058578696, endedAt: 1791058631992.2031, activeMs: 51860 },
      { id: 'q', showId: 's1', type: 'song-played', songId: 'y', songTitle: 'Song', at: 200, endedAt: 300, activeMs: 25_468.75 },
    ])

    await useShowLogStore.getState().init('band-a')

    const events = useShowLogStore.getState().events
    expect(events).toHaveLength(3)
    expect(events.find((e) => e.id === 's')?.at).toBe(1791099820556)
    expect(events.find((e) => e.id === 'p')).toMatchObject({ endedAt: 1791058631992 })
    expect(events.find((e) => e.id === 'q')).toMatchObject({ activeMs: 25_469 })
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe('init', () => {
  it('loads every well-formed event, sorted by time', async () => {
    getAllShowLogEvents.mockResolvedValue([
      { id: 'b', showId: 's1', type: 'show-started', at: 200 },
      { id: 'a', showId: 's1', type: 'show-started', at: 100 },
    ])

    await useShowLogStore.getState().init('band-a')

    expect(useShowLogStore.getState().events.map((e) => e.at)).toEqual([100, 200])
    expect(useShowLogStore.getState().loaded).toBe(true)
  })

  it('drops a malformed event instead of crashing the whole load - a single bad historical document must not take the app down (graceful degradation)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    getAllShowLogEvents.mockResolvedValue([
      { id: 'good', showId: 's1', type: 'show-started', at: 100 },
      // Genuinely broken (no songId, a text where a number belongs) - rounding can't save it.
      {
        id: 'bad',
        showId: 's1',
        type: 'song-played',
        songTitle: 'Song',
        at: 'yesterday',
        endedAt: 300,
        activeMs: 25_000,
      },
    ])

    await expect(useShowLogStore.getState().init('band-a')).resolves.toBeUndefined()

    expect(useShowLogStore.getState().events).toHaveLength(1)
    expect(useShowLogStore.getState().events[0]?.at).toBe(100)
    expect(useShowLogStore.getState().loaded).toBe(true)
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

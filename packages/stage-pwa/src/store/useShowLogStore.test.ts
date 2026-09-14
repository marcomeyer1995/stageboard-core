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
      // A fractional activeMs, exactly the real-world shape that used to throw uncaught out
      // of Array.map (found live, 2026-09-14: a count-in-seeded activeMs was never rounded
      // before being persisted, see showLogTracking.ts's finalizeSongPlay).
      {
        id: 'bad',
        showId: 's1',
        type: 'song-played',
        songId: 'song-1',
        songTitle: 'Song',
        at: 200,
        endedAt: 300,
        activeMs: 25_468.75,
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

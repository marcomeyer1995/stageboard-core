import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Setlist, Song } from 'shared-types'

// queue.ts -> workspaceDb.ts constructs a real PouchDB at load time (see queueShowLog.test.ts).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { pauseSong, setLiveTempoAdjustPercent, advanceToNextSong } = await import('./queue')
const { setShowLogOff } = await import('./showLogPolicy')
const { useShowStateStore } = await import('../store/useShowStateStore')
const { useShowLogStore } = await import('../store/useShowLogStore')
const { useSongsStore } = await import('../store/useSongsStore')
const { useSetlistsStore } = await import('../store/useSetlistsStore')

const song = (id: string): Song => ({ id, title: id.toUpperCase(), bpm: 120, timeSignature: '4/4', chordProContent: '' }) as Song

/** A master playing song "a" of a two-song setlist in show "show-1"; `append` keeps the store's
 * category check and replaces only the database write, so the switch is part of what is tested. */
function playing(entries: Setlist['entries'] = [{ id: 'e1', songId: 'a', variantId: null, trackId: null }, { id: 'e2', songId: 'b', variantId: null, trackId: null }]) {
  useSongsStore.setState({ songs: [song('a'), song('b')] })
  useSetlistsStore.setState({ setlists: [{ id: 'sl', name: 'Gig', createdAt: 0, entries }] })
  const written: unknown[] = []
  useShowLogStore.setState({
    append: async (event) => {
      // The real append minus the database: it still drops switched-off categories.
      const { isShowLogTypeRecorded } = await import('./showLogPolicy')
      if (isShowLogTypeRecorded(event.type)) written.push(event)
    },
  })
  const base = useShowStateStore.getState().state
  useShowStateStore.setState({
    isMaster: true,
    applyPatch: vi.fn(async () => {}),
    state: { ...base, activeSetlistId: 'sl', activeEntryId: entries[0]!.id, activeEntryStartedAt: 1000, currentShowId: 'show-1', playbackStatus: 'playing', playbackStartedAt: Date.now() - 30_000, playbackAccumulatedMs: 0, liveTempoAdjustPercent: 0 },
  })
  return written
}

afterEach(() => setShowLogOff(undefined))

describe('everything into the Nachbericht (#673)', () => {
  it('Pause is recorded with the song and where in it the band stood', async () => {
    const written = playing()
    await pauseSong()
    await vi.waitFor(() => expect(written).toHaveLength(1))
    expect(written[0]).toMatchObject({ type: 'playback', action: 'pause', showId: 'show-1', songId: 'a', songTitle: 'A' })
    expect((written[0] as { positionMs: number }).positionMs).toBeGreaterThanOrEqual(29_000)
  })

  it('a tempo correction is recorded with its new value', async () => {
    const written = playing()
    await setLiveTempoAdjustPercent(3)
    await vi.waitFor(() => expect(written).toHaveLength(1))
    expect(written[0]).toMatchObject({ type: 'sound', what: 'tempo', value: '3', songTitle: 'A' })
  })

  it('a category the band switched off is not recorded', async () => {
    const written = playing()
    setShowLogOff(['playback'])
    await pauseSong()
    await setLiveTempoAdjustPercent(2)
    await vi.waitFor(() => expect(written).toHaveLength(1))
    expect(written[0]).toMatchObject({ type: 'sound' })
  })

  it('an announcement between songs is recorded with how long it really took', async () => {
    const written = playing([
      { id: 't1', kind: 'transition', style: 'announcement', title: 'Merch', notes: '', estimatedDurationMs: 30_000 } as Setlist['entries'][number],
      { id: 'e2', songId: 'b', variantId: null, trackId: null },
    ])
    useShowStateStore.setState({ state: { ...useShowStateStore.getState().state, activeEntryStartedAt: Date.now() - 45_000 } })
    await advanceToNextSong()
    await vi.waitFor(() => expect(written.some((e) => (e as { type: string }).type === 'item-played')).toBe(true))
    const item = written.find((e) => (e as { type: string }).type === 'item-played') as { title: string; plannedMs: number; activeMs: number }
    expect(item.title).toBe('Merch')
    expect(item.plannedMs).toBe(30_000)
    expect(item.activeMs).toBeGreaterThanOrEqual(44_000)
  })
})
